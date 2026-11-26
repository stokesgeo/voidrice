import assert from 'node:assert/strict';
import { CUSTOM_TYPE, Ledger, nativeReceipt, identity, validateAssistantReceipt } from './ledger.mjs';
// details is arbitrary tool output. Only the owned subagent carrier uses this
// accounting namespace; bookkeeping from unrelated tools is opaque.
const toolAccounting = m => m?.role === 'toolResult' && m.toolName === 'subagent' ? m.details?.accounting : undefined;
export function safeAggregateUsage(entries, options) {
  try { return selectAggregateUsage(entries, options); }
  catch { return { version: 1, label: 'Aggregate reported request usage', coverage: 'invalid', knownCost: null, tokens: null, gaps: ['invalid-accounting-data'] }; }
}
export const carrierKey = (origin, entryId, suffix = '') => JSON.stringify([origin, entryId, suffix]);
// Raw ALL entries, never a model context projection. Does not mutate entries or context.
// Canonical receipts own their aliases. Legacy recovery is explicitly incomplete.
export function selectAggregateUsage(entries, { origin, fork = false, entryOrigins = {}, legacyChildPolicy = 'recover' }) {
  const ledger = new Ledger(), gaps = new Set(['provider-internal-retries-not-observable', 'failed-summary-attempts-not-observable', 'unhooked-side-calls-not-observable', 'ending-only:no-request-start-or-missing-tail-proof', 'child-summary-warming-label-usage-not-transported']);
  const aliases = new Map(), forkAliases = new Map();
  let unresolvedLegacyCarriers = 0;
  const add = r => ledger.ingest(r);
  for (const e of entries) {
    if (e.type === 'custom' && e.customType === CUSTOM_TYPE) add(e.data);
    if (e.costAccounting) {
      assert.equal(e.costAccounting.version, 1);
      assert(Array.isArray(e.costAccounting.receipts) && e.costAccounting.receipts.length <= 4096);
      for (const r of e.costAccounting.receipts) add(r);
    }
    const accounting = e.type === 'message' ? toolAccounting(e.message) : undefined;
    if (accounting !== undefined) {
      assert.equal(accounting.version, 1);
      assert(Array.isArray(accounting.receipts) && accounting.receipts.length <= 4096);
      for (const r of accounting.receipts) add(r);
    }
  }
  const checkMessage = (m, refs) => {
    if (Object.hasOwn(m, 'costReceipt')) {
      const r = validateAssistantReceipt(m.costReceipt, m), id = identity(r);
      assert(ledger.records.has(id), 'assistant receipt has no canonical owner');
      add(r); // detects conflicting copies, not just schema-valid matching IDs
      if (refs !== undefined) assert.deepEqual(refs, [id], 'assistant receipt/reference mismatch');
    }
    if (refs !== undefined) {
      assert(Array.isArray(refs) && refs.length === 1, 'assistant requires one ending receipt');
      const r = ledger.records.get(refs[0]);
      assert(r, 'carrier refers to missing canonical receipt');
      validateAssistantReceipt(r, m);
    }
  };
  for (const e of entries) {
    const m = e.type === 'message' ? e.message : undefined;
    if (m?.role === 'assistant') {
      const refs = e.costReceiptIds ?? m.costReceiptIds;
      if (e.costAccounting !== undefined) assert(refs !== undefined, 'owned assistant carrier missing receipt refs');
      checkMessage(m, refs);
      if (e.costReceiptIds !== undefined && m.costReceiptIds !== undefined) checkMessage(m, m.costReceiptIds);
    }
    if (m?.role === 'toolResult' && m.toolName === 'subagent') {
      for (const child of m.details?.results ?? []) for (const msg of child.messages ?? [])
        if (msg.role === 'assistant' && (Object.hasOwn(msg, 'costReceipt') || msg.costReceiptIds !== undefined))
          checkMessage(msg, msg.costReceiptIds);
    }
  }
  for (const e of entries) if (e.costReceiptIds !== undefined) {
    assert(Array.isArray(e.costReceiptIds) && e.costReceiptIds.length > 0 && e.costReceiptIds.length <= 4096);
    assert.equal(new Set(e.costReceiptIds).size, e.costReceiptIds.length);
    for (const id of e.costReceiptIds) assert(ledger.records.has(id), 'carrier refers to missing canonical receipt');
  }
  for (const r of ledger.values()) for (const a of r.aliases) {
    assert(!aliases.has(a) || aliases.get(a) === JSON.stringify([r.origin, r.invocation, r.attempt, r.sequence]), 'multiple accounting owners for carrier');
    aliases.set(a, JSON.stringify([r.origin, r.invocation, r.attempt, r.sequence]));
    // Copied entry IDs/suffixes survive forks, but the current session origin does not.
    // This index is only used for suppression, never to invent legacy lineage.
    let parts;
    try { parts = JSON.parse(a); } catch { continue; }
    if (Array.isArray(parts) && parts.length === 3 && parts.every(x => typeof x === 'string')) {
      const key = JSON.stringify(parts.slice(1));
      const owners = forkAliases.get(key) ?? new Set();
      owners.add(aliases.get(a)); forkAliases.set(key, owners);
    }
  }
  const recover = (e, suffix, lane, usage, meta = {}) => {
    const o = entryOrigins[e.id] ?? origin;
    const refs = suffix === '' ? (e.costReceiptIds ?? e.message?.costReceiptIds ??
      (e.message?.role === 'assistant' && Object.hasOwn(e.message, 'costReceipt') ? [identity(e.message.costReceipt)] : undefined)) : undefined;
    if (refs !== undefined) {
      assert(Array.isArray(refs) && refs.length > 0 && refs.length <= 4096);
      assert.equal(new Set(refs).size, refs.length);
      for (const id of refs) assert(ledger.records.has(id), 'carrier refers to missing canonical receipt');
      return; // receipt identity assigned before execution, no late entry-ID alias needed
    }
    if (aliases.has(carrierKey(o, e.id, suffix))) return;
    if (fork && !Object.hasOwn(entryOrigins, e.id)) {
      const owners = forkAliases.get(JSON.stringify([e.id, suffix]));
      if (owners?.size === 1) return; // canonical evidence owns this copied carrier
      gaps.add('legacy-fork-origin-ambiguous:not-campaign-deduplicable');
      gaps.add(owners ? 'fork-carrier-alias-ownership-unresolved' : 'legacy-fork-carrier-excluded:lineage-unresolved');
      unresolvedLegacyCarriers++;
      return; // do not fabricate new spend or a reliable inherited/new split
    }
    add(nativeReceipt({ origin: o, invocation: `legacy:${e.id}`, attempt: suffix || 'native', lane, usage, timestamp: e.timestamp,
      provider: meta.provider, model: meta.model, responseProvider: meta.responseProvider, responseModel: meta.responseModel, responseId: meta.responseId,
      outcome: meta.stopReason === 'aborted' ? 'cancelled' : meta.stopReason === 'error' ? 'error' : 'ok' }));
  };
  for (const e of entries) {
    const m = e.type === 'message' ? e.message : undefined;
    if (m?.role === 'assistant') recover(e, '', 'parent', m.usage, m);
    else if (e.type === 'usage') recover(e, '', e.kind === 'cache_warm' ? 'warming' : 'nested', e.usage, e);
    else if ((e.type === 'compaction' || e.type === 'branch_summary') && e.usage) recover(e, '', 'summary', e.usage);
    else if (m?.role === 'toolResult') {
      const results = m.toolName === 'subagent' ? m.details?.results : undefined;
      const accounting = toolAccounting(m);
      if (accounting !== undefined) {
        // New producers MUST NOT also return an aggregate top-level tool Usage.
        assert(!m.usage, 'canonical child receipts plus top-level usage would double count');
        if (accounting.complete !== true) gaps.add('child-producer-incomplete');
        continue;
      }
      if (m.usage) {
        recover(e, '', 'nested', m.usage);
        if (results) gaps.add('child-top-level-usage-owned:no-details-recovery');
        continue;
      }
      if (!Array.isArray(results)) continue;
      if (legacyChildPolicy === 'exclude-unidentified') {
        gaps.add('legacy-child-carriers-excluded:no-canonical-request-identity');
        unresolvedLegacyCarriers += results.reduce((n, r) => n + (r.messages ?? []).filter(m => ['assistant', 'toolResult'].includes(m.role) && m.usage).length, 0);
        continue;
      }
      gaps.add('legacy-child-capture:summary-warming-label-and-transport-gaps');
      for (const [slot, child] of results.entries()) {
        // Source messages are finer-grained than the lossy child subtotal; never add both.
        if (!Array.isArray(child.messages)) { gaps.add('child-messages-unavailable'); continue; }
        if (child.captureIncomplete || child.processActive || child.exitCode !== 0) gaps.add('child-failure-or-incomplete-capture');
        const seen = new Set();
        for (const [i, msg] of child.messages.entries()) {
          if (!['assistant', 'toolResult'].includes(msg.role) || !msg.usage) continue;
          // Native JSON lacks universal attempt ID. responseId is supplementary only;
          // do NOT collapse identical payloads or timestamps. Replay vulnerability stays visible.
          if (msg.responseId) {
            const key = JSON.stringify([msg.provider, msg.responseId]);
            if (seen.has(key)) gaps.add('legacy-child-repeated-responseId:identity-ambiguous');
            seen.add(key);
          }
          gaps.add('legacy-child-request-identity-unavailable');
          recover(e, `child:${slot}:message:${i}`, msg.role === 'assistant' ? 'child' : 'nested', msg.usage, msg);
          if (msg.role === 'toolResult' && msg.details?.results) gaps.add('nested-child-details-unavailable:not-recursively-guessed');
        }
      }
    }
  }
  return { ...ledger.totals(origin), gaps: [...gaps].sort(), identityScope: fork ? 'session-with-inherited;legacy-lineage-may-be-ambiguous' : 'session-all-branches', receiptCount: ledger.records.size, unresolvedLegacyCarriers };
}
