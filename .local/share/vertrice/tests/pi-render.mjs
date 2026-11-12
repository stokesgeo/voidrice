// Registered compact renderer and overview; no provider or child launch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { compileFunction } from 'node:vm';
const root = process.argv[2];
let source = stripTypeScriptTypes(readFileSync(path.join(root, '.pi/agent/extensions/subagent/index.ts'), 'utf8'))
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export default function', 'function extension');
// Stub only subprocess execution; exercise the real dispatch/overview observer.
source = source.slice(0, source.indexOf('async function runSingleAgent')) + source.slice(source.indexOf('const TaskItem'));
const launched = [];
const runSingleAgent = (...args) => new Promise(resolve => launched.push({ args, resolve }));
class Text { constructor(text) { this.text = text; } }
class Spacer extends Text { constructor() { super(''); } }
class Container { children = []; addChild(child) { this.children.push(child); } }
const theme = { fg: (_color, text) => text, bold: text => text };
const types = new Proxy({}, { get: () => () => ({}) });
let tool;
const events = {}, widgets = new Map();
const { extension, workerState, assignmentLabel } = compileFunction(source + '\nreturn { extension, workerState, assignmentLabel };', [
  'os', 'path', 'Type', 'StringEnum', 'getAgentDir', 'formatReadLineRange', 'Container', 'Spacer', 'Text', 'truncateToWidth', 'discoverAgents', 'runSingleAgent',
])(os, path, types, () => ({}), () => '/fixture/agent', () => '', Container, Spacer, Text, (s, w) => s.slice(0, w), () => [], runSingleAgent);
extension({ registerTool: value => { tool = value; }, on: (name, fn) => { events[name] = fn; } });
const nodes = c => c instanceof Container ? c.children.flatMap(nodes) : [c];
const row = (exitCode, extra = {}) => ({ agent: 'worker', agentSource: 'user', task: 'Exact assignment. Further details\nsecond line', exitCode,
  messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE-THINKING' },
    { type: 'toolCall', name: 'read', arguments: { path: '/fixture/path' } }, { type: 'text', text: 'FINAL-OUTPUT' }] },
    { role: 'toolResult', content: [{ type: 'text', text: 'RAW-RESULT' }] }], stderr: '',
  usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 120, turns: 1 }, ...extra });
let checks = 0;
const check = fn => { fn(); checks++; };
for (const mode of ['single', 'chain', 'parallel']) {
  for (const code of [-2, -1, 0, 1, 130]) {
    for (const expanded of [false, true]) {
      const r = row(code, { step: 1, stderr: code > 0 ? 'diagnostic failure' : '' });
      const view = nodes(tool.renderResult({ content: [], details: { mode, agentScope: 'user', results: [r] } }, { expanded }, theme, {})).map(c => c.text).join('\n');
      check(() => assert(view.includes('worker')));
      check(() => assert(!view.includes('PRIVATE-THINKING')));
      if (expanded) {
        for (const text of [r.task, 'FINAL-OUTPUT', 'RAW-RESULT', '/fixture/path', '1 turn']) check(() => assert(view.includes(text), text));
      } else {
        for (const text of ['FINAL-OUTPUT', 'RAW-RESULT', '/fixture/path', 'second line', '1 turn']) check(() => assert(!view.includes(text), text));
        check(() => assert(view.includes('Exact assignment.')));
      }
      if (code > 0) check(() => assert(view.includes('diagnostic failure')));
    }
  }
}
for (const [r, state] of [[row(-2), 'queued'], [row(-1), 'running'], [row(0), 'done'], [row(1), 'failed'], [row(130), 'cancelled'], [row(0, { messages: [] }), 'incomplete'], [row(0, { stderr: 'truncated' }), 'incomplete']]) check(() => assert.equal(workerState(r), state));
check(() => assert(assignmentLabel('x'.repeat(100)).length <= 72));
check(() => assert(!/[\x00-\x1f\x7f-\x9f]/.test(assignmentLabel('\x1b[31munsafe'))));
// Refusal must not create an overview or spawn a child.
const ctx = { hasUI: true, mode: 'tui', ui: { setWidget: (key, value) => widgets.set(key, value) } };
const refused = await tool.execute('refusal', { agent: 'worker', task: 'fixture', agentScope: 'project' }, undefined, undefined, ctx);
check(() => assert(refused.isError));
check(() => assert.equal(widgets.size, 0));
// This is a stubbed dispatch test even when the test runner is itself a child.
delete process.env.VERTRICE_PI_CHILD;
const active = tool.execute('active', { agent: 'worker', task: 'Live assignment' }, undefined, undefined, ctx);
const widgetText = () => widgets.get('subagent-workers')().render(60).join('\n');
check(() => assert(widgetText().includes('[queued]')));
const child = row(-1, { task: 'Live assignment', activity: 'read active' });
const launch = launched.shift();
launch.args[8]({ content: [], details: launch.args[9]([child]) });
check(() => assert(widgetText().includes('[running]')));
check(() => assert(widgetText().includes('read active')));
check(() => assert(widgets.get('subagent-workers')().render(20).every(line => line.length <= 20)));
launch.resolve(row(0));
await active;
check(() => assert.equal(widgets.get('subagent-workers'), undefined));
// Empty arrays must not mask the dispatcher's selected nonempty mode.
for (const [id, params] of [
  ['empty-chain-parallel', { chain: [], tasks: [{ agent: 'worker', task: 'Parallel fallback' }] }],
  ['empty-chain-single', { chain: [], agent: 'worker', task: 'Chain fallback' }],
  ['empty-tasks-single', { tasks: [], agent: 'worker', task: 'Tasks fallback' }],
]) {
  const pending = tool.execute(id, params, undefined, undefined, ctx);
  const task = params.task ?? params.tasks[0].task;
  check(() => assert(widgetText().includes(task)));
  check(() => assert(widgetText().includes('[queued]')));
  const dispatched = launched.shift();
  check(() => assert.equal(dispatched.args[4], task));
  check(() => assert.equal(dispatched.args[6], undefined));
  dispatched.resolve(row(0));
  await pending;
  check(() => assert.equal(widgets.get('subagent-workers'), undefined));
}
// A stopped chain returns only dispatched results; later rows are presentation-only.
for (const aborted of [false, true]) {
  const controller = new AbortController();
  const pending = tool.execute(`chain-${aborted}`, { chain: [
    { agent: 'worker', task: 'First step' }, { agent: `later-${aborted}`, task: 'Never launched' },
  ] }, controller.signal, undefined, ctx);
  const dispatched = launched.shift();
  if (aborted) controller.abort();
  const first = row(aborted ? 130 : 1, { step: 1 });
  dispatched.resolve(first);
  const result = await pending;
  check(() => assert.deepEqual(result.details.results, [first]));
  check(() => assert.equal(launched.length, 0));
  const later = widgetText().split('\n').find(line => line.includes(`later-${aborted}`));
  check(() => assert(later.includes(aborted ? '[cancelled]' : '[skipped]')));
  check(() => assert(later.includes('not dispatched')));
  check(() => assert(!later.includes('[failed]')));
}
const failing = tool.execute('failed', { agent: 'worker', task: 'Failed assignment' }, undefined, undefined, ctx);
launched.shift().resolve(row(1));
await failing;
check(() => assert(widgetText().includes('[failed]')));
events.session_shutdown({}, ctx);
check(() => assert.equal(widgets.get('subagent-workers'), undefined));
console.log(`PASS ${checks} compact/expanded subagent renderer, states, labels, refusal and shutdown assertions`);
