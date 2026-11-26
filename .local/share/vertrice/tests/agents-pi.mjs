// Real source launcher subprocesses + production hook/task handlers; no SDK/model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { compileFunction } from 'node:vm';

const repo = path.resolve(process.argv[2]);
const agent = path.join(repo, '.pi/agent');
const { routes } = await import(pathToFileURL(path.join(repo, '.local/share/openbsd/pi/portable/routes.mjs')));
const { snapshotOwner, default: extension } = await import(pathToFileURL(path.join(agent, 'extensions/shared-instructions.mjs')));
const { WorkStore, ContextPack, directory } = await import(pathToFileURL(path.join(agent, 'work-store.mjs')));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-pi-')));
const put = (file, bytes, mode = 0o600) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, bytes, { mode }); };
let checks = 0;
const check = fn => { fn(); checks++; };
const savedHome = process.env.HOME, savedWork = process.env.VERTRICE_WORK_DIR;
try {
  const home = path.join(tmp, 'owner'), file = path.join(home, '.agents/AGENTS.md');
  fs.mkdirSync(home, { mode: 0o700 });
  check(() => assert.equal(snapshotOwner(home).status, 'missing'));
  const text = 'OWNER-CANONICAL-SENTINEL\n';
  put(file, text);
  const snapshot = snapshotOwner(home);
  check(() => assert.equal(snapshot.status, 'loaded'));
  check(() => assert.equal(snapshot.sha256, createHash('sha256').update(text).digest('hex')));
  check(() => assert.equal(snapshot.text, text));
  process.env.HOME = home;
  const handlers = {}, commands = {}, messages = [];
  extension({ on: (name, handler) => { handlers[name] = handler; }, registerCommand: (name, command) => { commands[name] = command; } });
  const ctx = { hasUI: true, ui: { setStatus: (...args) => messages.push(args), notify: (...args) => messages.push(args) } };
  handlers.session_start({}, ctx);
  fs.writeFileSync(file, 'LATER-EDIT-NOT-AUTOMATICALLY-ADOPTED\n');
  const base = 'GLOBAL-AGENTS\nPROJECT-AGENTS\nBASELINE-SEALED-APPEND\nOWNER-NATIVE-APPEND\n';
  for (let i = 0; i < 2; i++) {
    const rendered = handlers.before_agent_start({ systemPrompt: base }, ctx).systemPrompt;
    check(() => assert(rendered.startsWith(base)));
    check(() => assert.equal(rendered.split('OWNER-CANONICAL-SENTINEL').length - 1, 1));
    check(() => assert(!rendered.includes('LATER-EDIT')));
    check(() => assert(!rendered.includes(snapshot.sha256))); // the SHA is shown on request, not in the prompt
  }
  check(() => assert.deepEqual(messages, [['vertrice-shared-home', 'shared home: loaded']]));
  await commands['shared-home'].handler('', ctx);
  check(() => assert(String(messages.at(-1)).includes(snapshot.sha256)));
  fs.writeFileSync(file, '');
  check(() => assert.equal(snapshotOwner(home).status, 'refused'));
  fs.writeFileSync(file, text);
  fs.renameSync(file, file + '.saved');
  fs.symlinkSync(file + '.saved', file);
  check(() => assert.equal(snapshotOwner(home).status, 'refused'));
  fs.unlinkSync(file);
  fs.renameSync(file + '.saved', file);
  fs.writeFileSync(file, Buffer.alloc(128 * 1024 + 1, 120));
  check(() => assert.equal(snapshotOwner(home).status, 'refused'));
  fs.writeFileSync(file, Buffer.from([0xff]));
  check(() => assert.equal(snapshotOwner(home).status, 'refused'));
  fs.writeFileSync(file, text);
  fs.unlinkSync(file);
  const absentHandlers = {}, absentMessages = [];
  extension({ on: (name, handler) => { absentHandlers[name] = handler; } });
  const absentCtx = { hasUI: true, ui: { setStatus: (...args) => absentMessages.push(args), notify: (...args) => absentMessages.push(args) } };
  check(() => assert.equal(absentHandlers.before_agent_start({ systemPrompt: base }, absentCtx), undefined));
  check(() => assert(absentMessages.some(row => String(row).includes('shared home: missing'))));
  check(() => assert(!fs.existsSync(file)));

  // Build source-owned route and actual production launch script in a fixture.
  const resources = JSON.parse(fs.readFileSync(path.join(agent, 'resources.json')));
  const runtime = path.join(tmp, 'generation');
  const built = routes(runtime, '/fixture', resources, resources.files);
  const route = built.route;
  check(() => assert.equal(route.instance.workDir, '/fixture/.agents'));
  check(() => assert.equal(route.instance.sessionDir, '/fixture/.agents/sessions/pi'));
  check(() => assert.equal(route.messenger.workDir, '/fixture/.local/share/vertrice-pi/state/work'));
  check(() => assert.equal(route.messenger.sessionDir, '/fixture/.local/share/vertrice-pi/state/sessions'));
  check(() => assert.equal(route.instance.nativeAuthStorage, '/fixture/.local/share/vertrice-pi/profile/auth.json'));
  check(() => assert(route.generic.extensions.some(p => p.endsWith('/shared-instructions.mjs'))));
  check(() => assert(!route.campaign.extensions.some(p => /\/(?:shared-instructions\.mjs|work\.ts|subagent\/index\.ts)$/.test(p))));
  check(() => assert.equal(route.ownerContext.path, '/fixture/.agents/AGENTS.md'));
  const badResources = structuredClone(resources); delete badResources.ownerContext;
  check(() => assert.throws(() => routes(runtime, '/fixture', badResources, resources.files), /owner-data contract/));
  put(path.join(runtime, 'route.json'), JSON.stringify(route));
  put(path.join(runtime, 'agent/AGENTS.md'), 'SEALED-GENERIC-APPEND\n');
  fs.copyFileSync(path.join(repo, '.local/share/openbsd/pi/portable/launch.mjs'), path.join(runtime, 'launch.mjs'));
  put(path.join(runtime, 'node_modules/capture.mjs'), 'console.log(JSON.stringify({argv:process.argv.slice(2),env:Object.fromEntries(["HOME","VERTRICE_WORK_DIR","PI_CODING_AGENT_SESSION_DIR","PI_CA_NATIVE_AUTH_STORAGE","PI_CA_MESSENGER_CONTRACT"].map(k=>[k,process.env[k]]))}));\n');
  fs.mkdirSync(path.join(runtime, 'node_modules/.bin'));
  fs.symlinkSync('../capture.mjs', path.join(runtime, 'node_modules/.bin/pi'));
  const launch = await import(pathToFileURL(path.join(runtime, 'launch.mjs')));
  check(() => assert.equal(launch.environment({}).VERTRICE_WORK_DIR, route.instance.workDir));
  check(() => assert.equal(launch.environment({}).PI_CODING_AGENT_SESSION_DIR, route.instance.sessionDir));
  const overrides = { VERTRICE_WORK_DIR: '/explicit/work', PI_CODING_AGENT_SESSION_DIR: '/explicit/sessions' };
  check(() => assert.equal(launch.environment(overrides).VERTRICE_WORK_DIR, overrides.VERTRICE_WORK_DIR));
  check(() => assert.equal(launch.environment(overrides).PI_CODING_AGENT_SESSION_DIR, overrides.PI_CODING_AGENT_SESSION_DIR));
  check(() => assert.equal(launch.environment(overrides, { campaign: true }).VERTRICE_WORK_DIR, route.messenger.workDir));
  check(() => assert.equal(launch.environment(overrides, { campaign: true }).PI_CODING_AGENT_SESSION_DIR, route.messenger.sessionDir));
  const campaignArgs = launch.argumentsFor({ campaign: true });
  check(() => assert.equal(campaignArgs[campaignArgs.indexOf('--session-dir') + 1], route.messenger.sessionDir));
  check(() => assert(!campaignArgs.some(a => a.endsWith('/shared-instructions.mjs') || a.endsWith('/work.ts'))));
  check(() => assert(launch.argumentsFor({ argv: ['--append-system-prompt', '--version'] }).includes('--no-extensions')));
  check(() => assert(launch.argumentsFor({ argv: ['--', '--version'] }).includes('--no-extensions')));
  check(() => assert.equal(launch.environment({}).PI_CA_MESSENGER_CONTRACT, undefined));
  const run = argv => {
    const result = spawnSync(process.execPath, [path.join(runtime, 'launch.mjs'), ...argv],
      { env: { PATH: process.env.PATH, HOME: home, ...overrides }, encoding: 'utf8', timeout: 10000 });
    check(() => assert.equal(result.status, 0, result.stderr));
    return JSON.parse(result.stdout);
  };
  for (const args of [['--offline', '--version'], ['--help'], ['--version'],
    ...['auth', 'mcp', 'config', 'install', 'remove', 'uninstall', 'update', 'list'].map(word => [word, '--help'])])
    check(() => assert.deepEqual(run(args).argv, args));
  const args = ['--session-dir', '/cli/sessions', '--append-system-prompt', 'OWNER-CLI', '--', 'literal'];
  const chat = run(args);
  check(() => assert.deepEqual(chat.argv.slice(-args.length), args));
  check(() => assert(!chat.argv.slice(0, -args.length).includes('--session-dir')));
  check(() => assert.equal(chat.argv.filter(a => a.endsWith('/shared-instructions.mjs')).length, 1));
  check(() => assert.equal(chat.argv.filter(a => a === '--append-system-prompt').length, 2));
  check(() => assert.equal(chat.env.PI_CODING_AGENT_SESSION_DIR, '/explicit/sessions'));
  check(() => assert.equal(chat.env.PI_CA_NATIVE_AUTH_STORAGE, route.instance.nativeAuthStorage));
  check(() => assert(!fs.existsSync(file))); // Metadata/chat fixture never initializes.

  // Actual work extension: default, kinds, CLI interoperability, name-only warning.
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(agent, 'extensions/work.ts'), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^const packRoot = .*;$/m, `const packRoot = ${JSON.stringify(agent)};`).replace('export default function', 'function extension');
  const types = new Proxy({}, { get: () => (...args) => ({ args }) });
  const tools = {}, events = {}, widgets = [], statuses = [];
  delete process.env.VERTRICE_WORK_DIR;
  compileFunction(source + '\nreturn extension;', ['os', 'path', 'fs', 'Type', 'WorkStore', 'ContextPack', 'directory'])(
    { homedir: () => home }, path, fs, types, WorkStore, ContextPack, directory
  )({ registerTool: tool => { tools[tool.name] = tool; }, registerCommand: () => {}, on: (name, handler) => { events[name] = handler; } });
  const workCtx = { hasUI: true, sessionManager: { getSessionId: () => 'fixture-owner' },
    ui: { setWidget: (_key, value) => widgets.push(value), setStatus: (_key, value) => statuses.push(value) } };
  const call = params => tools.work_task.execute('fixture', params, undefined, undefined, workCtx);
  const created = await call({ action: 'create', title: 'Shared task', kind: 'incubate', next_action: 'Shape', spent_when: 'Checked' });
  check(() => assert(!created.isError && created.details.task.kind === 'incubate'));
  check(() => assert.equal(created.details.file, path.join(home, '.agents/tasks', created.details.task.id + '.md')));
  const cli = spawnSync('/bin/sh', [path.join(repo, '.local/bin/vertrice-agents'), '--root', path.join(home, '.agents'), 'task', 'list'], { encoding: 'utf8' });
  check(() => assert.equal(cli.status, 0, cli.stderr));
  check(() => assert.equal(JSON.parse(cli.stdout)[0].task.id, created.details.task.id));
  const updated = await call({ action: 'update', id: created.details.task.id, revision: created.details.revision, patch: { kind: 'todo' } });
  check(() => assert.equal(updated.details.task.kind, 'todo'));
  // Earlier stores are looked for once per session, by entry name only.
  const oldTasks = path.join(home, '.local/share/vertrice-pi/state/work/tasks');
  put(path.join(oldTasks, 'old.md'), 'not parsed; filename only');
  await events.session_start({}, workCtx);
  check(() => assert(widgets.at(-1).some(line => line.includes('Storage notice:'))));
  check(() => assert(statuses.at(-1).includes('old store')));
  const listed = await call({ action: 'list' });
  check(() => assert.deepEqual(listed.details.storage_notice.map(n => n.path), [oldTasks])); // No old sessions yet.
  // Earlier-generation sessions: name-only notice with the native reopen route.
  const oldSessions = path.join(home, '.local/share/vertrice-pi/state/sessions');
  put(path.join(oldSessions, '--fixture--/old.jsonl'), 'not parsed; entry name only');
  const savedSession = process.env.PI_CODING_AGENT_SESSION_DIR;
  const freshSession = async () => { await events.session_start({}, workCtx); return (await call({ action: 'list' })).details.storage_notice; };
  try {
    for (const value of [undefined, path.join(home, '.agents/sessions/pi')]) {
      if (value === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR; else process.env.PI_CODING_AGENT_SESSION_DIR = value;
      const notice = (await freshSession()).find(n => n.path === oldSessions);
      check(() => assert(notice && notice.notice.includes(`--session-dir ${oldSessions} --resume`)));
    }
    process.env.PI_CODING_AGENT_SESSION_DIR = '/chosen/sessions'; // Owner's own root: stay quiet.
    const chosen = await freshSession();
    check(() => assert(!chosen.some(n => n.path === oldSessions)));
  } finally {
    if (savedSession === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR; else process.env.PI_CODING_AGENT_SESSION_DIR = savedSession;
  }
  check(() => assert.equal(listed.details.records[0].kind, 'todo'));
  console.log(`PASS ${checks} generated-route/native-launch subprocess, owner snapshot safety/provenance, native hook, shared tasks/kinds and no-migration assertions; SDK loading untested`);
} finally {
  for (const [key, value] of [['HOME', savedHome], ['VERTRICE_WORK_DIR', savedWork]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
