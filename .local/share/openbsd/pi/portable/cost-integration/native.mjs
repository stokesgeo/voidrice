// Observed-ending accounting, NOT a request-start or crash-durable spend journal.
import { randomUUID } from 'node:crypto';
import { nativeReceipt, validate, identity } from './ledger.mjs';
import { safeAggregateUsage } from './select.mjs';
export { safeAggregateUsage };
const outcome = m => m.stopReason === 'aborted' ? 'cancelled' : m.stopReason === 'error' ? 'error' : 'ok';
export function captureEnding(event, sessionId) {
  if (event.type !== 'message_end' || event.message?.role !== 'assistant') return;
  const m = event.message;
  // Preserve even conflicting metadata for fail-closed selector validation.
  // Do not silently regenerate a different identity on replay or fork.
  if (Object.hasOwn(m, 'costReceipt')) return;
  const owned = process.env.VERTRICE_PI_CHILD === '1' && process.env.PI_COST_ORIGIN && process.env.PI_COST_INVOCATION;
  m.costReceipt = nativeReceipt({ origin: owned ? process.env.PI_COST_ORIGIN : sessionId,
    invocation: owned ? process.env.PI_COST_INVOCATION : 'native-ending', attempt: randomUUID(), lane: owned ? 'child' : 'parent',
    usage: m.usage, provider: m.provider, model: m.model, responseProvider: m.responseProvider, responseModel: m.responseModel, responseId: m.responseId,
    timestamp: new Date(m.timestamp ?? Date.now()).toISOString(), outcome: outcome(m) });
}
// One atomic existing entry append is the sink. Fork copies carry receipts WITH refs.
// No extra custom-entry write that could strand a receipt or alter context ancestry.
export function accountEntry(entry, origin) {
  if (entry.costAccounting) return;
  const m = entry.type === 'message' ? entry.message : undefined;
  const receipts = [];
  if (m?.role === 'assistant') {
    captureEnding({ type: 'message_end', message: m }, origin);
    receipts.push(validate(m.costReceipt));
  } else if (m?.role === 'toolResult' && m.toolName === 'subagent' && Array.isArray(m.details?.results)) {
    // Only the actual execution results, never presentation/overview aliases.
    for (const child of m.details.results) for (const msg of child.messages ?? []) {
      if (msg.role === 'assistant' && msg.costReceipt) receipts.push(validate(msg.costReceipt));
    }
    if (receipts.length) {
      // Selector owns canonical receipts, not the lossy per-result usage subtotal.
      // Preserve supplied owned evidence: selector checks conflicts and parity.
      if (m.details.accounting === undefined)
        m.details = { ...m.details, accounting: { version: 1, complete: false, receipts } };
    }
  } else if (entry.usage && ['usage', 'compaction', 'branch_summary'].includes(entry.type)) {
    receipts.push(nativeReceipt({ origin, invocation: `carrier:${entry.id}`, attempt: 'persisted',
      lane: entry.type === 'usage' ? (entry.kind === 'cache_warm' ? 'warming' : 'nested') : 'summary',
      usage: entry.usage, provider: entry.provider, model: entry.model, timestamp: entry.timestamp }));
  }
  if (receipts.length && m?.toolName !== 'subagent') {
    entry.costAccounting = { version: 1, receipts };
  }
  if (receipts.length) {
    entry.costReceiptIds = [...new Set(receipts.map(identity))];
    entry.costOrigin = origin;
  }
}
export function aggregateSession(manager) {
  const entries = manager.getEntries();
  return safeAggregateUsage(entries, { origin: manager.getSessionId(), fork: Boolean(manager.getHeader()?.parentSession || manager.getHeader()?.costLineageIncomplete), legacyChildPolicy: 'exclude-unidentified',
    entryOrigins: Object.fromEntries(entries.filter(e => e.costOrigin).map(e => [e.id, e.costOrigin])) });
}
export function aggregateText(a) {
  if (!a || a.coverage === 'invalid') return 'Aggregate reported usage: INVALID accounting; subtotal unavailable; coverage incomplete';
  const t = a.tokens;
  return `Aggregate reported usage: $${Number(a.knownCost.toPrecision(12))} known subtotal · ↑${t.input} ↓${t.output} R${t.cacheRead} W${t.cacheWrite} · coverage INCOMPLETE · unknown price ${a.unknownPrice} · no usage ${a.noUsage} · unfinished ${a.unfinished} · unresolved lineage ${a.unresolvedLegacyCarriers} · missing summaries/cache/labels/transport possible`;
}
// Keep coverage visible even on a narrow native footer. No silent ellipsis of caveats.
export function aggregateLines(a, width) {
  const words = aggregateText(a).split(' '), lines = []; let line = '';
  for (const word of words) { if (line && line.length + 1 + word.length > Math.max(1, width)) { lines.push(line); line = ''; } line += (line ? ' ' : '') + word; }
  if (line) lines.push(line); return lines;
}
