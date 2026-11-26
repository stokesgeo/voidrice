// Isolated tests only: never start a terminal or send queries to real stdout.
// Usage: node test.mjs /absolute/path/to/runtime/node_modules
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { MODES, QUERY, TIMEOUT_MS, probeModes } from './probe.mjs';
const modules = resolve(process.argv[2]);
const native = path => import(pathToFileURL(resolve(modules, '@earendil-works', path)));
const { ProcessTerminal } = await native('pi-tui/dist/terminal.js');
const { TuiBase } = await native('pi-tui/dist/tui.js');
const { InteractiveMode } = await native('pi-coding-agent/dist/modes/interactive/interactive-mode.js');
const { loadExtensions } = await native('pi-coding-agent/dist/core/extensions/loader.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reply = (mode, value = 1) => `\x1b[?${mode};${value}$y`;
let checks = 0;
function fixture() {
  const passed = [], writes = [];
  const tui = new TuiBase({ columns: 80, rows: 24, write: () => {} }, false);
  // No start(), rendering, stdin listener or terminal writes.
  tui.focusedComponent = { handleInput: data => passed.push(data) };
  tui.requestRender = () => {};
  tui.doRender = () => {}; // constructor schedules one render; keep it isolated
  const host = Object.create(InteractiveMode.prototype);
  host.ui = tui;
  host.extensionTerminalInputSubscriptions = new Set();
  const ctx = { mode: 'tui', hasUI: true, ui: {
    onTerminalInput: handler => host.addExtensionTerminalInputListener(handler),
  } };
  const terminal = new ProcessTerminal();
  terminal.inputHandler = data => tui.handleTerminalInput(data);
  terminal.setupStdinBuffer();
  const feed = data => terminal.stdinBuffer.process(data);
  const output = { isTTY: true, write: (data, cb) => { writes.push(data); cb?.(); } };
  const input = { isTTY: true, isRaw: true };
  const run = signal => probeModes(ctx, signal, input, output);
  const clean = () => {
    assert.equal(host.extensionTerminalInputSubscriptions.size, 0);
    assert.equal(tui.inputListeners.size, 0);
    terminal.stdinBuffer.destroy();
    terminal.clearKeyboardProtocolNegotiationBuffer();
  };
  return { passed, writes, ctx, terminal, feed, output, input, run, clean, tui };
}

// Every possible split, including ESC / [, digits, semicolon, $, and final y.
for (const mode of MODES) {
  for (let split = 1; split < reply(mode).length; split++) {
    const f = fixture();
    const pending = f.run();
    f.feed('a' + reply(mode).slice(0, split));
    assert.deepEqual(f.passed, ['a']);
    f.feed(reply(mode).slice(split) + 'z');
    for (const other of MODES) if (other !== mode) f.feed(reply(other));
    const result = await pending;
    assert.equal(result.status, 'complete');
    assert.equal(result.modes.find(row => row.mode === mode).state, 'set');
    assert.deepEqual(f.passed, ['a', 'z']);
    assert.deepEqual(f.writes, [QUERY]);
    f.clean(); checks++;
  }
}
{
  const f = fixture();
  const pending = f.run();
  // Byte-at-a-time fragmented replies, mixed with unrelated complete keys.
  for (let i = 0; i < MODES.length; i++) {
    if (i === 0) {
      f.feed(`\x1b[?${MODES[i]};`);
      await delay(1); // asynchronous chunk delivery, inside native CSI deadline
      f.feed(`${i % 5}$y`);
    } else {
      for (const byte of reply(MODES[i], i % 5)) f.feed(byte);
    }
    f.feed('\x1b[A');
  }
  const result = await pending;
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.modes.map(row => row.value), [0, 1, 2, 3, 4, 0]);
  assert.deepEqual(result.modes.map(row => row.state), ['not-recognized', 'set', 'reset', 'permanently-set', 'permanently-reset', 'not-recognized']);
  assert.deepEqual(f.passed, Array(6).fill('\x1b[A'));
  f.clean(); checks++;
}
{
  const f = fixture();
  const pending = f.run();
  const untouched = ['\x1b[?9999;1$y', '\x1b[?1049;5$y', '\x1b[?01049;1$y',
    '\x1b[1049;1$y', '\x1b[?1049;01$y', '\x1b[I', '\x1b[<0;2;3M',
    '\x1b[200~' + reply(1049) + '\x1b[201~'];
  for (const data of untouched) f.feed(data);
  // ProcessTerminal normally wraps paste before forwarding; mirror its paste path.
  // setupStdinBuffer already installs that wrapper.
  assert.deepEqual(f.passed, untouched);
  f.feed(reply(1049));
  f.feed(reply(1049, 2)); // duplicate is no longer outstanding
  for (const mode of MODES.slice(1)) f.feed(reply(mode));
  f.feed(reply(1000, 2)); // completion, before async finally: must pass
  assert.deepEqual(f.passed, [...untouched, reply(1049, 2), reply(1000, 2)]);
  await pending;
  f.feed(reply(1002)); // after finally
  assert.equal(f.passed.at(-1), reply(1002));
  f.clean(); checks++;
}
{
  const f = fixture();
  const pending = f.run();
  // Partial prefix times out natively. Never consume or replay unmatched bytes.
  f.feed('\x1b[?1049;');
  await delay(75);
  f.feed('q');
  assert.equal(f.passed.join(''), '\x1b[?1049;q');
  const result = await pending;
  assert.equal(result.status, 'timeout');
  assert(result.modes.every(row => row.state === 'no-reply' && row.value === null));
  f.feed(reply(1049)); // late full response is no longer ours
  assert.equal(f.passed.at(-1), reply(1049));
  f.clean(); checks++;
}
{
  const f = fixture();
  const pending = f.run();
  f.feed(reply(1049, 2));
  const result = await pending;
  assert.equal(result.status, 'timeout');
  assert.equal(result.modes[0].state, 'reset');
  assert(result.modes.slice(1).every(row => row.state === 'no-reply'));
  f.clean(); checks++;
}
for (const preAborted of [false, true]) {
  const f = fixture(), controller = new AbortController();
  if (preAborted) controller.abort();
  const pending = f.run(controller.signal);
  controller.abort();
  assert.equal((await pending).status, 'aborted');
  assert.equal(f.writes.length, preAborted ? 0 : 1);
  f.clean(); checks++;
}
for (const change of [f => { f.ctx.mode = 'rpc'; }, f => { f.ctx.mode = 'print'; },
  f => { f.ctx.mode = 'json'; }, f => { f.ctx.hasUI = false; },
  f => { f.input.isTTY = false; }, f => { f.input.isRaw = false; },
  f => { f.output.isTTY = false; }, f => { f.ctx.ui = {}; }]) {
  const f = fixture(); change(f);
  await assert.rejects(f.run(), /attached interactive/);
  assert.deepEqual(f.writes, []);
  f.clean(); checks++;
}
for (const synchronous of [false, true]) {
  const f = fixture();
  f.output.write = (_data, cb) => { if (synchronous) throw new Error('fixture write'); cb(new Error('fixture write')); };
  if (synchronous) await assert.rejects(f.run(), /fixture write/);
  else assert.equal((await f.run()).status, 'write-error');
  f.clean(); checks++;
}
{
  const f = fixture();
  f.ctx.ui.onTerminalInput = () => { throw new Error('fixture subscribe'); };
  await assert.rejects(f.run(), /fixture subscribe/);
  assert.deepEqual(f.writes, []);
  f.clean(); checks++;
}

// Real native extension loading, then registered execute with mocked stdio.
const loaded = await loadExtensions([fileURLToPath(new URL('./index.ts', import.meta.url))], process.cwd());
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const ext = loaded.extensions[0];
const registered = ext.tools.get('terminal_scroll_modes');
assert(registered);
const tool = registered.definition;
assert.deepEqual(Object.keys(tool.parameters.properties), []);
assert.equal(tool.parameters.additionalProperties, false);
assert.equal(tool.annotations.readOnlyHint, true);
{
  const f = fixture();
  const saved = [];
  function override(object, key, value) {
    saved.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
    Object.defineProperty(object, key, { configurable: true, value });
  }
  try {
    override(process.stdin, 'isTTY', true);
    override(process.stdin, 'isRaw', true);
    override(process.stdout, 'isTTY', true);
    override(process.stdout, 'write', f.output.write);
    await assert.rejects(tool.execute('bad', { path: '/dev/tty' }, undefined, undefined, f.ctx), /no parameters/);
    const pending = tool.execute('one', {}, undefined, undefined, f.ctx);
    await assert.rejects(tool.execute('two', {}, undefined, undefined, f.ctx), /already outstanding/);
    for (const mode of MODES) f.feed(reply(mode));
    assert.equal((await pending).details.status, 'complete');
    const shutdownPending = tool.execute('shutdown', {}, undefined, undefined, f.ctx);
    for (const handler of ext.handlers.get('session_shutdown')) await handler({}, f.ctx);
    assert.equal((await shutdownPending).details.status, 'aborted');
    assert.deepEqual(f.writes, [QUERY, QUERY]);
  } finally {
    for (const [object, key, descriptor] of saved.reverse()) {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else delete object[key];
    }
    f.clean();
  }
  checks++;
}
assert.equal(TIMEOUT_MS, 750);
assert.equal(QUERY, '\x1b[?1049$p\x1b[?1000$p\x1b[?1002$p\x1b[?1003$p\x1b[?1004$p\x1b[?1006$p');
console.log(`PASS ${checks} isolated cases; native ProcessTerminal -> TuiBase -> extension subscription, native loader and registered execute; no live terminal query`);
