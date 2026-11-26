// Candidate-only accounting core. No provider, transcript, environment or model-catalog access.
import assert from 'node:assert/strict';
export const CUSTOM_TYPE = 'pi.cost.receipt.v1';
export const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const lanes = ['parent', 'child', 'summary', 'warming', 'label', 'nested'];
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, fields) => { assert(plain(x)); assert(Object.keys(x).every(k => fields.includes(k)), 'unexpected field'); };
const text = (s, max = 160) => assert(typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f]/.test(s), 'invalid bounded string');
const count = n => assert(Number.isSafeInteger(n) && n >= 0, 'invalid token/sequence count');
const canonical = x => JSON.stringify(x, (_, v) => plain(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const identity = r => JSON.stringify([r.origin, r.invocation, r.attempt, r.sequence]);
// Native ending receipts are metadata, not independent provider evidence. Preserve
// identity on replay/fork, but never let metadata override the containing message.
export function validateAssistantReceipt(record, message) {
  assert.equal(message.role, 'assistant');
  const r = validate(record);
  const expected = nativeReceipt({ origin: r.origin, invocation: r.invocation, attempt: r.attempt,
    sequence: r.sequence, lane: r.lane, usage: message.usage, provider: message.provider,
    model: message.model, responseProvider: message.responseProvider, responseModel: message.responseModel,
    responseId: message.responseId, timestamp: r.timestamp,
    outcome: message.stopReason === 'aborted' ? 'cancelled' : message.stopReason === 'error' ? 'error' : 'ok' });
  for (const k of ['provider', 'model', 'responseProvider', 'responseModel', 'responseId', 'usage', 'price', 'final', 'outcome'])
    assert.equal(canonical(r[k]), canonical(expected[k]), `assistant receipt/message mismatch: ${k}`);
  return r;
}
export function validate(record) {
  assert(Buffer.byteLength(JSON.stringify(record)) <= 16384, 'receipt too large');
  const r = structuredClone(record);
  exact(r, ['version', 'origin', 'invocation', 'attempt', 'sequence', 'revision', 'lane', 'provider', 'model', 'responseProvider', 'responseModel', 'responseId', 'timestamp', 'usage', 'price', 'final', 'outcome', 'aliases']);
  assert.equal(r.version, 1);
  for (const k of ['origin', 'invocation', 'attempt']) { text(r[k]); assert(/^[A-Za-z0-9._:-]+$/.test(r[k]), 'identity syntax'); }
  count(r.sequence); count(r.revision); assert(lanes.includes(r.lane));
  for (const k of ['provider', 'model', 'timestamp']) text(r[k]);
  for (const k of ['responseProvider', 'responseModel', 'responseId']) if (r[k] !== undefined) text(r[k]);
  assert(Number.isFinite(Date.parse(r.timestamp)), 'timestamp');
  assert.equal(typeof r.final, 'boolean');
  assert(['running', 'ok', 'error', 'cancelled', 'lost', 'not-started'].includes(r.outcome));
  assert.equal(r.final, r.outcome !== 'running');
  if (r.usage !== null) {
    exact(r.usage, [...TOKEN_FIELDS, 'totalTokens', 'reasoning', 'cacheWrite1h']);
    for (const k of TOKEN_FIELDS) count(r.usage[k]);
    for (const k of ['totalTokens', 'reasoning', 'cacheWrite1h']) if (r.usage[k] !== undefined) count(r.usage[k]);
    assert((r.usage.reasoning ?? 0) <= r.usage.output);
    assert((r.usage.cacheWrite1h ?? 0) <= r.usage.cacheWrite);
  }
  exact(r.price, ['status', 'total', 'currency', 'provenance']);
  assert(['unknown', 'estimated', 'provider-reported', 'explicit-free'].includes(r.price.status));
  assert.equal(r.price.currency, 'USD');
  assert.equal(r.price.total === null, r.price.status === 'unknown');
  if (r.price.total !== null) {
    assert(r.usage !== null, 'priced without usage');
    assert(Number.isFinite(r.price.total) && r.price.total >= 0);
    text(r.price.provenance, 256);
    if (r.price.status === 'explicit-free') assert.equal(r.price.total, 0);
  } else assert(r.price.provenance === null);
  assert(Array.isArray(r.aliases) && r.aliases.length <= 32);
  for (const a of r.aliases) text(a, 256);
  assert.equal(new Set(r.aliases).size, r.aliases.length);
  return r;
}
export class Ledger {
  records = new Map();
  revisions = new Map();
  ingest(record) {
    const r = validate(record), key = identity(r), old = this.records.get(key);
    const revisionKey = JSON.stringify([key, r.revision]), encoded = canonical(r);
    if (this.revisions.has(revisionKey)) assert.equal(this.revisions.get(revisionKey), encoded, 'conflicting historical receipt revision');
    if (old) {
      // Identity attribution and carrier aliases are immutable even across revisions.
      for (const k of ['lane', 'provider', 'model', 'origin', 'invocation', 'attempt', 'sequence', 'aliases'])
        assert.equal(canonical(old[k]), canonical(r[k]), `identity mutation: ${k}`);
      if (r.revision < old.revision) { this.revisions.set(revisionKey, encoded); return 'stale'; }
      if (r.revision === old.revision) { assert.equal(canonical(r), canonical(old), 'conflicting receipt'); return 'duplicate'; }
      assert(!old.final, 'final receipt cannot change');
      // Launch provider/model are requested routing identity. The first usage-bearing
      // observation fixes actual charge attribution; later snapshots cannot relabel it.
      if (old.usage !== null) for (const k of ['responseProvider', 'responseModel'])
        assert.equal(old[k] ?? old[k === 'responseProvider' ? 'provider' : 'model'], r[k] ?? r[k === 'responseProvider' ? 'provider' : 'model'], `charge attribution mutation: ${k}`);
    }
    this.revisions.set(revisionKey, encoded);
    this.records.set(key, r);
    return old ? 'replace' : 'new';
  }
  values() { return [...this.records.values()].map(x => structuredClone(x)); }
  clone() {
    const copy = new Ledger();
    copy.records = new Map([...this.records].map(([key, r]) => [key, structuredClone(r)]));
    copy.revisions = new Map(this.revisions);
    return copy;
  }
  totals(currentOrigin) {
    const result = { version: 1, label: 'Aggregate reported request usage', tokens: Object.fromEntries(TOKEN_FIELDS.map(k => [k, 0])), reportedTotalTokens: 0, reportedTotalMissing: 0, reasoningSubset: 0, cacheWrite1hSubset: 0, knownCost: 0, currency: 'USD', unknownPrice: 0, noUsage: 0, unfinished: 0, inheritedKnownCost: 0, newKnownCost: 0, priceKinds: {}, byLane: {}, byModel: {}, coverage: 'incomplete' };
    for (const r of this.records.values()) {
      if (r.usage) {
        for (const k of TOKEN_FIELDS) result.tokens[k] += r.usage[k];
        result.reasoningSubset += r.usage.reasoning ?? 0;
        result.cacheWrite1hSubset += r.usage.cacheWrite1h ?? 0;
        if (r.usage.totalTokens === undefined) result.reportedTotalMissing++;
        else result.reportedTotalTokens += r.usage.totalTokens;
      } else result.noUsage++;
      if (!r.final || ['lost', 'cancelled'].includes(r.outcome)) result.unfinished++;
      if (r.price.total === null) result.unknownPrice++;
      else {
        result.knownCost += r.price.total;
        result[r.origin === currentOrigin ? 'newKnownCost' : 'inheritedKnownCost'] += r.price.total;
      }
      result.priceKinds[r.price.status] = (result.priceKinds[r.price.status] ?? 0) + 1;
      for (const [group, key] of [['byLane', r.lane], ['byModel', JSON.stringify([r.responseProvider ?? r.provider, r.responseModel ?? r.model])]]) {
        const row = result[group][key] ??= { knownCost: 0, unknownPrice: 0, requests: 0 };
        row.requests++; row.knownCost += r.price.total ?? 0; row.unknownPrice += r.price.total === null ? 1 : 0;
      }
    }
    result.disjointRequestTokens = TOKEN_FIELDS.reduce((n, k) => n + result.tokens[k], 0);
    for (const value of [...Object.values(result.tokens), result.reportedTotalTokens, result.disjointRequestTokens]) count(value);
    assert(Number.isFinite(result.knownCost), 'cost overflow');
    return result;
  }
}
// Preserve historical native totals. Never reprice with a selected/current parent model.
export function nativePrice(usage) {
  const n = usage?.cost?.total;
  if (Number.isFinite(n) && n >= 0 && usage.cost.totalFromProvider === true)
    return { status: 'provider-reported', total: n, currency: 'USD', provenance: 'native:cost.totalFromProvider' };
  if (Number.isFinite(n) && n > 0)
    return { status: 'estimated', total: n, currency: 'USD', provenance: 'native:persisted-estimate;rate-version-unavailable' };
  return { status: 'unknown', total: null, currency: 'USD', provenance: null };
}
export function nativeReceipt({ origin, invocation, attempt, sequence = 0, lane, usage, provider = 'unattributed', model = 'unattributed', responseProvider, responseModel, responseId, timestamp = '1970-01-01T00:00:00.000Z', aliases = [], outcome = 'ok' }) {
  return validate({ version: 1, origin, invocation, attempt, sequence, revision: 0, lane, provider, model,
    ...(responseProvider ? { responseProvider } : {}), ...(responseModel ? { responseModel } : {}), ...(responseId ? { responseId } : {}), timestamp,
    usage: usage ? Object.fromEntries([...TOKEN_FIELDS, 'totalTokens', 'reasoning', 'cacheWrite1h'].filter(k => usage[k] !== undefined).map(k => [k, usage[k]])) : null,
    price: nativePrice(usage), final: outcome !== 'running', outcome, aliases });
}
