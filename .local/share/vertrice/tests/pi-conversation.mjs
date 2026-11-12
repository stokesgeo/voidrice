// Display hooks with mocked model registry; no account/network access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { compileFunction } from 'node:vm';
import { summaryInput, cleanSummary, operationLabel } from '../../../../.pi/agent/action-summary.mjs';
const source = stripTypeScriptTypes(readFileSync(process.argv[2] + '/.pi/agent/extensions/conversation-ui.ts', 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default function', 'function extension');
class Text { constructor(text) { this.text = text; } }
class Container {}
const factory = compileFunction(source + '\nreturn extension;', ['Text', 'Container', 'summaryInput', 'cleanSummary', 'operationLabel'])(Text, Container, summaryInput, cleanSummary, operationLabel);
const theme = { fg: (_color, text) => text };
let checks = 0;
const check = fn => { fn(); checks++; };
for (const enabled of [false, true]) {
  const events = {}, notices = [], requests = [], deferred = [];
  let resolver, transform, flag;
  factory({ on: (n, f) => events[n] = f, registerFlag: (n, f) => { flag = [n, f]; }, getFlag: () => enabled,
    registerToolRenderer: f => resolver = f, registerMarkdownTransformer: f => transform = f });
  check(() => assert.equal(flag[1].default, false));
  const ctx = { mode: 'tui', ui: { notify: (...x) => notices.push(x), setToolsExpanded: () => {}, setHiddenThinkingLabel: () => {} },
    modelRegistry: { find: () => ({}), streamSimple: (_m, input, options) => { requests.push([input, options]); return { result: () => new Promise(resolve => deferred.push(resolve)) }; } } };
  events.session_start({}, ctx);
  const event = { toolName: 'bash', args: { command: 'git -C /PRIVATE status secret' }, toolCallId: 'one' };
  events.tool_execution_start(event, ctx);
  const renderer = resolver('bash', () => undefined);
  let invalidations = 0;
  const context = { toolCallId: 'one', invalidate: () => invalidations++ };
  const label = renderer.renderCall(event.args, theme, context).text;
  check(() => assert(label.includes('git status')));
  check(() => assert(!label.includes('PRIVATE') && !label.includes('secret')));
  check(() => assert(renderer.renderResult({ content: [{ type: 'text', text: 'output' }] }, { expanded: false }, theme, {}) instanceof Container));
  check(() => assert(renderer.renderResult({ content: [{ type: 'text', text: 'failure' }] }, { expanded: false }, theme, { isError: true }).text.includes('failure')));
  check(() => assert(renderer.renderCall(event.args, theme, { ...context, expanded: true }).text.includes('/PRIVATE')));
  check(() => assert.equal(requests.length, enabled ? 1 : 0));
  if (enabled) {
    check(() => assert(!JSON.stringify(requests[0][0]).includes('PRIVATE')));
    events.tool_execution_start({ ...event, toolCallId: 'two' }, ctx);
    check(() => assert.equal(requests.length, 1)); // identical metadata shares in-flight request
    deferred.shift()({ stopReason: 'stop', content: [{ type: 'text', text: 'Inspect repository state' }] });
    await new Promise(resolve => setImmediate(resolve));
    check(() => assert.equal(invalidations, 1));
    check(() => assert(renderer.renderCall(event.args, theme, context).text.includes('Inspect repository state')));
    check(() => assert(notices[0][0].includes('not included')));
  } else check(() => assert.equal(notices.length, 0));
  check(() => assert.equal(transform('hello', { messageType: 'user' }), '**You**\n\nhello'));
  check(() => assert.equal(transform('thinking', { messageType: 'assistant-thinking' }), 'thinking'));
  events.session_shutdown();
}
for (const failure of ['missing', 'error']) {
  const events = {}, notices = [];
  factory({ on: (n, f) => events[n] = f, registerFlag() {}, getFlag: () => true,
    registerToolRenderer() {}, registerMarkdownTransformer() {} });
  const ctx = { mode: 'tui', ui: { notify: text => notices.push(text) }, modelRegistry: {
    find: () => failure === 'missing' ? undefined : {},
    streamSimple: () => ({ result: async () => ({ stopReason: 'error', content: [] }) }),
  } };
  for (let i = 0; i < 2; i++) {
    events.tool_execution_start({ toolName: 'read', toolCallId: String(i), args: {} }, ctx);
    await new Promise(resolve => setImmediate(resolve));
  }
  check(() => assert.equal(notices.length, 1));
  check(() => assert(notices[0].includes('deterministic')));
  events.session_shutdown();
}
console.log(`PASS ${checks} conversation defaults, opt-in async/cache/privacy, fallback, errors, expansion and labels assertions`);
