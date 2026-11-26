// Observation only: Crew retains spawning, ownership, cancellation and concurrency.
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { nativeReceipt, validateAssistantReceipt, identity, CUSTOM_TYPE } from './native-ledger.mjs';
const handles = new WeakMap();
const rows = new Map(), listeners = new Set();
let sink, origin;
const changed = () => { for (const fn of listeners) fn(); };
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const snapshot = () => structuredClone([...rows.values()]);
export const liveCount = () => [...rows.values()].filter(r => r.processActive).length;
export function bindReceiptSink(sessionId, append) { origin = sessionId; sink = append; }
export function unbindReceiptSink() { sink = undefined; origin = undefined; }
export function crewReceiptEnvironment() { return { PI_COST_ORIGIN: origin ?? randomUUID(), PI_COST_INVOCATION: 'crew:' + randomUUID() }; }
export function cancelCrew(proc) {
 const r = handles.get(proc); if (r?.processActive) { r.cancellationPending = true; changed(); }
}
export function crewKill(proc, signal) { cancelCrew(proc); return proc.kill(signal); }
export function assignCrew(proc, task, taskId) {
 const r = handles.get(proc); if (r) { r.task = task; r.taskId = taskId; changed(); }
}
export function observeCrew(proc, meta, signal) {
 if (handles.has(proc)) throw Error('Crew handle already observed');
 const sessionOrigin = origin, append = sink;
 const r = { id: randomUUID(), ...meta, messages: [], processActive: false, cancellationPending: false,
  start: null, exit: null, captureIncomplete: true, coverage: 'captured endings only; missing tail and side calls unknown', accounting: append ? 'native receipt sink' : 'aggregate unknown: native receipt sink unavailable' };
 handles.set(proc, r); rows.set(r.id, r);
 const decoder = new StringDecoder('utf8');
 let buffer = '', sequence = 0, ended = false;
 const seen = new Map();
 const event = e => {
  if (e.type !== 'message_end' || e.message?.role !== 'assistant') return;
  const m = structuredClone(e.message);
  r.messages.push(m); // Captured usage remains visible even if accounting fails closed.
  // One owned Crew carrier per observed ending. Existing native identities survive replay.
  let receipt;
  if (m.costReceipt) {
   receipt = validateAssistantReceipt(m.costReceipt, m);
   if (receipt.origin !== sessionOrigin || receipt.invocation !== r.costInvocation || receipt.lane !== 'child') throw Error('unowned Crew receipt');
  }
  else receipt = nativeReceipt({ origin: sessionOrigin ?? r.id, invocation: r.costInvocation ?? 'crew:' + r.id, attempt: 'ending', sequence: sequence++, lane: 'child', usage: m.usage,
   provider: m.provider, model: m.model, responseProvider: m.responseProvider, responseModel: m.responseModel, responseId: m.responseId,
   timestamp: new Date(m.timestamp ?? Date.now()).toISOString(), outcome: m.stopReason === 'error' ? 'error' : m.stopReason === 'aborted' ? 'cancelled' : 'ok' });
  const key = identity(receipt), encoded = JSON.stringify(receipt);
  if (seen.has(key)) { if (seen.get(key) !== encoded) throw Error('conflicting Crew receipt'); r.messages.pop(); return; }
  // Existing native custom-entry sink, NOT a journal or tool Usage subtotal.
  if (append) append(CUSTOM_TYPE, receipt);
  seen.set(key, encoded); m.costReceipt = receipt; changed();
 };
 const line = text => { if (!text.trim()) return; try { event(JSON.parse(text)); } catch (e) { r.errorMessage = 'Capture/receipt gap: ' + e.message; r.accounting = 'aggregate unknown: capture/receipt gap'; changed(); } };
 proc.once('spawn', () => {
  r.start = { pid: proc.pid, observedAt: Date.now(), event: 'spawn' };
  r.processActive = true; if (signal?.aborted) r.cancellationPending = true; changed();
 });
 const abort = () => cancelCrew(proc); signal?.addEventListener('abort', abort, { once: true });
 proc.stdout?.on('data', data => { buffer += decoder.write(data); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const text of lines) line(text); });
 proc.stderr?.on('data', data => { r.stderr = (r.stderr ?? '') + data.toString(); });
 proc.on('error', e => {
  r.errorMessage = e.message;
  // A post-spawn kill/send error is NOT an exit observation.
  if (!r.start) { r.processActive = false; r.exit = { event: 'spawn-error', observedAt: Date.now(), error: e.message }; }
  changed();
 });
 proc.once('exit', (code, signal) => {
  r.processActive = false; r.exit = { event: 'exit', code, signal, observedAt: Date.now() }; changed();
 });
 proc.once('close', (code, signal) => {
  if (ended) return; ended = true;
  try { buffer += decoder.end(); if (buffer) line(buffer); } finally {
   r.processActive = false; r.cancellationPending = false;
   r.close = { code, signal, observedAt: Date.now() };
   signal && (r.errorMessage ??= 'Child terminated by ' + signal);
   changed();
  }
 });
 proc.once('close', () => signal?.removeEventListener('abort', abort));
 return r; // real spawn/exit data is populated by events, never PID probing.
}
export function workerState(r) {
 if (r.processActive) return r.cancellationPending ? 'cancellation pending' : 'running';
 if (!r.exit) return 'starting';
 if (r.exit.event === 'spawn-error') return 'failed';
 return r.exit.code === 0 ? 'done' : r.exit.signal ? 'cancelled' : 'failed';
}
