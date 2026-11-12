import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { compileFunction } from 'node:vm';
import { spawnSync } from 'node:child_process';
const repo = process.argv[2], agent = path.join(repo, '.pi/agent');
const { ContextPack } = await import(pathToFileURL(path.join(agent, 'work-store.mjs')));
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-self-test-')));
let checks = 0;
const check = fn => { fn(); checks++; };
try {
  const pack = new ContextPack(agent);
  for (const file of pack.files) {
    const target = path.join(scratch, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, pack.read(file.path).text);
  }
  fs.copyFileSync(path.join(agent, 'context/manifest.json'), path.join(scratch, 'context/manifest.json'));
  fs.copyFileSync(path.join(agent, 'work-store.mjs'), path.join(scratch, 'work-store.mjs'));
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(agent, 'extensions/self-maintain.ts'), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('path.resolve(path.dirname(fileURLToPath(import.meta.url)), \'..\')', JSON.stringify(scratch))
    .replace('export default function', 'function extension');
  const tools = {}, commands = {}, events = {}, sent = [];
  const Type = new Proxy({}, { get: () => () => ({}) });
  compileFunction(source + '\nreturn extension;', ['Type', 'ContextPack'])(Type, ContextPack)({
    registerTool: tool => { tools[tool.name] = tool; },
    registerCommand: (name, command) => { commands[name] = command; },
    on: (name, handler) => { events[name] = handler; },
    sendUserMessage: (...args) => sent.push(args),
  });
  check(() => assert.deepEqual(Object.keys(commands), ['reload-runtime']));
  check(() => assert.deepEqual(Object.keys(tools), ['reload_runtime']));
  const call = signal => tools.reload_runtime.execute('fixture', {}, signal);
  const cancelled = await call({ aborted: true });
  check(() => assert(cancelled.isError));
  events.agent_settled({ aborted: false });
  check(() => assert.equal(sent.length, 0));
  const requested = await call();
  check(() => assert(requested.terminate && requested.details.requested));
  check(() => assert.equal(sent.length, 0));
  events.agent_settled({ aborted: true });
  events.agent_settled({ aborted: false });
  check(() => assert.equal(sent.length, 0));
  await call(); events.agent_settled({ aborted: false });
  check(() => assert.deepEqual(sent, [['/reload-runtime', { expandPromptTemplates: true }]]));
  events.agent_settled({ aborted: false });
  check(() => assert.equal(sent.length, 1));
  let reloads = 0;
  const ctx = { reload: async () => { reloads++; } };
  await commands['reload-runtime'].handler('', ctx);
  check(() => assert.equal(reloads, 1));
  fs.appendFileSync(path.join(scratch, 'AGENTS.md'), '\nReviewed self-edit fixture.\n');
  await assert.rejects(commands['reload-runtime'].handler('', ctx), /changed since/); checks++;
  check(() => assert.equal(reloads, 1));
  const script = path.join(repo, '.local/share/openbsd/pi/context-index.mjs');
  const run = (...args) => spawnSync(process.execPath, [script, scratch, ...args], { encoding: 'utf8' });
  check(() => assert.notEqual(run('--check').status, 0));
  check(() => assert.equal(run().status, 0));
  const manifest = fs.readFileSync(path.join(scratch, 'context/manifest.json'));
  check(() => assert.equal(run().status, 0));
  check(() => assert.deepEqual(fs.readFileSync(path.join(scratch, 'context/manifest.json')), manifest));
  check(() => assert.equal(run('--check').status, 0));
  await commands['reload-runtime'].handler('', ctx);
  check(() => assert.equal(reloads, 2));
  check(() => assert(!fs.readdirSync(path.join(scratch, 'context')).some(name => name.includes('.tmp-'))));
  const selected = new ContextPack(scratch).files[0];
  const original = fs.readFileSync(path.join(scratch, selected.path));
  fs.unlinkSync(path.join(scratch, selected.path));
  fs.symlinkSync(path.join(scratch, 'unselected'), path.join(scratch, selected.path));
  fs.writeFileSync(path.join(scratch, 'unselected'), original);
  check(() => assert.notEqual(run().status, 0));
  console.log(`PASS ${checks} self-reload cancellation/idle/command handoff and installed explicit-manifest refresh/idempotency/path assertions`);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
