// Shared compact UI helper only; no native subagent execution framework.
import { wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { inspectorLines } from './compact-ui.ts';
import { bindReceiptSink, unbindReceiptSink, subscribe, snapshot, liveCount, workerState } from './lifecycle.mjs';
export function installCrewPresence(pi: any) {
 if (process.env.VERTRICE_PI_CHILD === '1' || process.env.PI_CA_CREW_CHILD === '1') return;
 let ctx: any, redraw: (() => void) | undefined;
 const allowed = () => {
  let trusted = false;
  try { trusted = ctx?.isProjectTrusted?.() === true; } catch {}
  if (trusted) return true;
  unsubscribe(); unbindReceiptSink(); redraw = undefined; ctx = undefined;
  return false;
 };
 const update = () => {
  if (!allowed()) return;
  if (ctx?.mode === 'tui') ctx.ui.setWidget('crew-presence', liveCount() ? () => ({ invalidate() {}, render(width: number) {
   if (!allowed()) return [];
   return wrapTextWithAnsi(`${liveCount()} running workers`, Math.max(1, width));
  } }) : undefined);
  redraw?.();
  pi.events.emit('crew:presence:v1', { live: liveCount(), rows: snapshot() });
 };
 const unsubscribe = subscribe(update);
 pi.on('session_start', (_e: any, c: any) => { ctx = c; bindReceiptSink(c.sessionManager.getSessionId(), (type: string, data: any) => { if (allowed()) pi.appendEntry(type, data); }); update(); });
 // No restoration to live state, no taskstate reads or context-stat changes.
 pi.on('session_shutdown', () => { unsubscribe(); unbindReceiptSink(); ctx?.ui.setWidget('crew-presence', undefined); ctx = undefined; });
 pi.registerShortcut('alt+w', { description: 'Inspect observed Crew children', handler: async (c: any) => {
  if (c.mode !== 'tui') return;
  await c.ui.custom((tui: any, theme: any, keys: any, done: any) => {
   let offset = 0, page = 1, total = 0, raw = false;
   redraw = () => tui.requestRender();
   return { invalidate() {}, render(width: number) {
    if (!allowed()) return [];
    const rows = snapshot();
    const lines = [`Workers · ${liveCount()} live`, 'r: raw/details · ↑↓ PgUp/PgDn · Esc',
     'Aggregate: captured native receipts only; missing tail / side calls unknown.',
     ...rows.map((r: any) => `${r.agent} · ${r.accounting}`)].flatMap(s => wrapTextWithAnsi(s, Math.max(1, width)));
    lines.push(...inspectorLines(rows, workerState, raw, width));
    total = lines.length; page = Math.max(1, tui.terminal.rows - 1); offset = Math.min(offset, Math.max(0, total - page));
    return lines.slice(offset, offset + page);
   }, handleInput(data: string) {
    if (!allowed()) { done(undefined); return; }
    if (keys.matches(data, 'tui.select.cancel')) { done(undefined); return; }
    if (data === 'r') { raw = !raw; offset = 0; }
    else if (keys.matches(data, 'tui.select.up')) offset = Math.max(0, offset - 1);
    else if (keys.matches(data, 'tui.select.down')) offset = Math.min(Math.max(0, total - page), offset + 1);
    else if (keys.matches(data, 'tui.select.pageUp')) offset = Math.max(0, offset - page);
    else if (keys.matches(data, 'tui.select.pageDown')) offset = Math.min(Math.max(0, total - page), offset + page);
    tui.requestRender();
   } };
  });
  redraw = undefined;
 } });
}
