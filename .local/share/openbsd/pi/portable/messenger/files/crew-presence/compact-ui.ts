// Display only. No accounting projection, provider calls, or task-result mutation.
import { Text, wrapTextWithAnsi } from '@earendil-works/pi-tui';

type Row = {
  agent: string; task: string; goalTask?: string; step?: number;
  messages: any[]; stderr?: string; errorMessage?: string;
  processActive?: boolean; cancellationPending?: boolean;
};
export function safeText(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}
// No authored summary field exists: retain the entire meaningful authored text.
// Punctuation and line boundaries are not semantic summaries.
export function lead(text: string): string {
  return safeText(text).trim() || '(not supplied)';
}
function finalText(r: Row): string {
  for (let i = r.messages.length - 1; i >= 0; i--) {
    const m = r.messages[i];
    if (m.role === 'assistant') {
      const text = (m.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
      if (text.trim()) return safeText(text);
    }
  }
  return '';
}
export function rowState(r: Row, state: (r: any) => string): string {
  return r.processActive && r.cancellationPending ? 'cancellation pending' : state(r);
}
const buckets = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// Read authoritative captured assistant endings once each. Never sum the lossy
// aggregate alongside its source messages, overview aliases, or contextTokens.
export function reportedUsage(r: Row) {
  const reports = r.messages.filter(m => m.role === 'assistant');
  const sum = (get: (m: any) => unknown) => {
    let known = 0, missing = 0;
    for (const m of reports) { const v = get(m); if (valid(v)) known += v; else missing++; }
    return { known, missing: missing || (reports.length ? 0 : 1) };
  };
  const fields = Object.fromEntries(buckets.map(k => [k, sum(m => m.usage?.[k])])) as Record<typeof buckets[number], {known: number; missing: number}>;
  const tokens = { known: buckets.reduce((n, k) => n + fields[k].known, 0), missing: buckets.reduce((n, k) => n + fields[k].missing, 0) };
  return { fields, tokens, cost: sum(m => m.usage?.cost?.total), reports: reports.length };
}
function amount(v: { known: number; missing: number }, dollar = false): string {
  if (v.missing && v.known === 0) return 'unknown';
  return `${dollar ? '$' : ''}${v.known}${v.missing ? ' + unknown' : ''}`;
}
export function usageLine(r: Row): string {
  const u = reportedUsage(r);
  return `Reported: ${amount(u.tokens)} tokens · ${amount(u.cost, true)}`;
}
export function usageDetails(r: Row): string[] {
  const u = reportedUsage(r);
  return [
    `Captured assistant reports: ${u.reports}; cumulative reported usage, not context remaining or an invoice.`,
    ...buckets.map(k => `${k}: ${amount(u.fields[k])}`),
    `cost: ${amount(u.cost, true)}`,
    'Coverage: captured assistant endings only; missing reports, nested tools and side work may be absent.',
  ];
}
export function purpose(r: Row): string { return lead(r.goalTask ?? r.task); }
export function childLines(r: Row, state: (r: any) => string, expanded: boolean): string[] {
  const p = purpose(r), outcome = finalText(r);
  const template = safeText(r.goalTask ?? r.task).trim();
  const lines = [`${safeText(r.agent)}${r.step ? ` · step ${r.step}` : ''} · ${expanded ? template : p} · ${rowState(r, state)}`];
  const terminal = ['failed', 'cancelled', 'incomplete'].includes(rowState(r, state));
  const diagnostics = [...new Set([r.errorMessage, r.stderr].filter(Boolean).map(s => safeText(s!).trim()))].filter(Boolean);
  if (terminal) {
    lines.push(diagnostics.length ? `Terminal diagnostic:\n${diagnostics.join('\n')}` : 'Terminal diagnostic: not captured');
    if (expanded && outcome && !diagnostics.includes(outcome.trim())) lines.push(`Earlier worker report (not terminal outcome): ${outcome}`);
  } else if (outcome) lines.push(expanded ? `Worker report: ${lead(outcome)}` : 'Report available; expand for details.');
  else lines.push('Outcome: not reported');
  if (expanded) {
    const assignment = safeText(r.task).trim();
    if (assignment !== template) lines.push(`Expanded assignment: ${assignment}`);
    if (!terminal && diagnostics.length) lines.push(`Diagnostics:\n${diagnostics.filter(s => s !== outcome.trim()).join('\n')}`);
    lines.push(usageLine(r), ...usageDetails(r));
  }
  return lines;
}
export function callView(args: any, theme: any, context: any) {
  // Core invokes call before result, but renders the returned components after
  // both slots are built. Reading shared state at render-time prevents even the
  // first partial/final frame from painting two purposes. No recursive invalidate.
  context.state.compactResultOwns = false;
  return {
    invalidate() {},
    render(width: number) {
      if (context.state.compactResultOwns) return [];
      const jobs = args.chain ?? args.tasks ?? [{ agent: args.agent ?? 'subagent', task: args.task ?? '' }];
      const mode = args.chain ? 'chain' : args.tasks ? 'parallel' : 'single';
      const lines = jobs.map((j: any, i: number) => `${safeText(j.agent ?? 'subagent')}${mode === 'chain' ? ` · step ${i + 1}` : ''} · ${lead(j.task ?? '')} · ${context.isError ? 'failed' : !context.isPartial ? 'incomplete' : context.executionStarted ? 'starting' : 'queued'}`);
      if (mode !== 'single') lines.unshift(`${mode} · ${jobs.length} workers`);
      return new Text(theme.fg('dim', lines.join('\n')), 0, 0).render(width);
    },
  };
}
export function resultView(rows: Row[], mode: string, state: (r: any) => string, expanded: boolean, theme: any, context: any) {
  context.state.compactResultOwns = true;
  const lines = mode === 'single' ? [] : [`${mode} · ${rows.length} workers`];
  for (const r of rows) lines.push(...childLines(r, state, expanded));
  if (expanded) lines.push('Worker reports are not independent verification or acceptance.');
  if (!expanded) lines.push(context.keyText?.('app.tools.expand')
    ? context.keyHint('app.tools.expand', 'for details') : 'Expand tool row for details');
  return new Text(theme.fg('toolOutput', lines.join('\n')), 0, 0);
}
export function inspectorLines(rows: Row[], state: (r: any) => string, raw: boolean, width: number): string[] {
  const lines = rows.flatMap(r => raw
    ? [`Captured detail · ${safeText(r.agent)}`, safeText(JSON.stringify(r, null, 2)), '']
    : [...childLines(r, state, true), '']);
  if (!lines.length) lines.push('No workers on this branch.');
  return lines.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)));
}
