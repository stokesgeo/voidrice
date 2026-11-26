import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { compileFunction } from 'node:vm';
import { spawnSync } from 'node:child_process';
const root = process.argv[2], agent = path.join(root, '.pi/agent');
const { WorkStore, ContextPack, parse, serialize, digest, directory } = await import(pathToFileURL(path.join(agent, 'work-store.mjs')));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-work-test-')));
let checks = 0;
const check = fn => { fn(); checks++; };
const rejects = (fn, pattern) => check(() => assert.throws(fn, pattern));
try {
  const store = new WorkStore(path.join(tmp, 'work'));
  check(() => assert.deepEqual(store.list(), []));
  check(() => assert(!fs.existsSync(store.root)));
  const input = { title: 'Qualify task tools', spent_when: 'Native flow checked and record delivered', next_action: 'Run fixture', notes: 'A line with two spaces.  \n\nUnsaved text is separate.\n---\nEnd\n' };
  let row = store.create(input, 'parent');
  check(() => assert.equal(row.task.notes, input.notes));
  check(() => assert.equal(fs.statSync(row.file).mode & 0o777, 0o600));
  check(() => assert.equal(fs.statSync(path.dirname(row.file)).mode & 0o777, 0o700));
  check(() => assert.equal(serialize(parse(fs.readFileSync(row.file, 'utf8'))), fs.readFileSync(row.file, 'utf8')));
  check(() => assert.equal(new WorkStore(store.root).read(row.task.id).revision, row.revision));
  rejects(() => store.read('../../etc/passwd'), /Invalid task id/);
  rejects(() => store.update(row.task.id, 'old', { title: 'lost edit' }, 'parent'), /Stale revision/);
  rejects(() => store.update(row.task.id, row.revision, { schema: 2 }, 'parent'), /Unknown update/);
  rejects(() => store.create({ ...input, owner: 'hidden' }, 'parent'), /Unknown create/);
  rejects(() => store.create({ ...input, spent_when: '' }, 'parent'), /completion condition/);
  rejects(() => store.create({ ...input, title: '\x1b[2J' }, 'parent'), /Invalid title/);
  rejects(() => store.update(row.task.id, row.revision, { status: 'completed' }, 'parent'), /evidence/);
  rejects(() => store.update(row.task.id, row.revision, { status: 'blocked' }, 'parent'), /blocker/);
  rejects(() => store.update(row.task.id, row.revision, { next_action: '' }, 'parent'), /next action/);
  const first = row;
  // The claiming session is this live process; another process may not touch it.
  const savedSessionPid = process.env.VERTRICE_SESSION_PID;
  process.env.VERTRICE_SESSION_PID = String(process.pid);
  row = store.update(row.task.id, row.revision, { status: 'in_progress' }, 'parent');
  check(() => assert.equal(row.task.owner, 'parent'));
  check(() => assert.equal(row.claim, 'live'));
  delete process.env.VERTRICE_SESSION_PID;
  rejects(() => store.update(row.task.id, row.revision, { next_action: 'steal' }, 'other'), /held by live session/);
  process.env.VERTRICE_SESSION_PID = String(process.pid);
  rejects(() => store.update(row.task.id, row.revision, { owner: 'other' }, 'parent'), /Only claim/);
  row = store.update(row.task.id, row.revision, { status: 'pending', owner: 'other', next_action: 'Explicit review handoff' }, 'parent');
  row = store.update(row.task.id, row.revision, { status: 'in_progress' }, 'other');
  check(() => assert.equal(row.task.owner, 'other'));
  row = store.update(row.task.id, row.revision, { status: 'blocked', blockers: ['Need native test result'], next_action: 'Collect result' }, 'other');
  rejects(() => store.update(row.task.id, row.revision, { status: 'completed', evidence: ['exit 0'] }, 'other'), /Resolve blockers/);
  row = store.update(row.task.id, row.revision, { status: 'completed', blockers: [], evidence: ['Native fixture and disk readback passed'], next_action: '' }, 'other');
  check(() => assert.equal(new WorkStore(store.root).list()[0].task.status, 'completed'));
  if (savedSessionPid === undefined) delete process.env.VERTRICE_SESSION_PID; else process.env.VERTRICE_SESSION_PID = savedSessionPid;
  rejects(() => store.update(first.task.id, first.revision, { title: 'offline edit' }, 'parent'), /Stale revision/);
  // Hold the kernel store lock through a separate open; BSD locks conflict per open.
  const holdLock = dir => fs.openSync(path.join(dir, '.lock'), fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NONBLOCK | 0x20, 0o600);
  let held = holdLock(store.location());
  rejects(() => store.create(input, 'parent'), /Store busy/);
  fs.closeSync(held);
  check(() => assert(!fs.readdirSync(store.location()).some(name => name.startsWith('.tmp-'))));
  const outside = path.join(tmp, 'outside.md'); fs.writeFileSync(outside, serialize(row.task));
  const file = row.file; fs.unlinkSync(file); fs.symlinkSync(outside, file);
  rejects(() => store.read(row.task.id));
  check(() => assert.equal(fs.readFileSync(outside, 'utf8'), serialize(row.task)));
  fs.unlinkSync(file); fs.linkSync(outside, file);
  rejects(() => store.read(row.task.id), /non-hardlinked/);
  fs.unlinkSync(file); fs.copyFileSync(outside, file);
  fs.symlinkSync(store.root, path.join(tmp, 'linked-root'));
  rejects(() => new WorkStore(path.join(tmp, 'linked-root')).list(), /real directory/);
  rejects(() => parse(serialize(row.task).replace('schema: 1', 'schema: 1\nschema: 1')), /duplicate/);
  rejects(() => parse('---\n__proto__: {}\n---\n'), /Invalid/);
  rejects(() => parse(serialize(row.task).replace('schema: 1', 'schema: 2')), /schema/);
  rejects(() => store.create({ ...input, notes: 'x'.repeat(64001) }, 'parent'), /Invalid notes/);
  const pack = new ContextPack(agent);
  check(() => assert.equal(pack.files.length, 22));
  for (const entry of pack.files) check(() => assert.equal(digest(pack.read(entry.path).text), entry.sha256));
  check(() => assert(pack.search('revision').some(hit => hit.path === 'context/tasks.md')));
  check(() => assert.equal(pack.search('zzzz-no-such-word').length, 0));
  rejects(() => pack.search('  '), /needs words/);
  rejects(() => pack.read('../AGENTS.md'), /manifest/);
  rejects(() => pack.read('settings.json'), /manifest/);
  const copyContext = (sourcePack, target) => {
    fs.mkdirSync(path.join(target, 'context'), { recursive: true });
    fs.writeFileSync(path.join(target, 'context/manifest.json'), JSON.stringify(sourcePack.manifest));
    for (const entry of sourcePack.files) {
      const file = path.join(target, entry.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, sourcePack.read(entry.path).text);
    }
  };
  const clone = path.join(tmp, 'pack'); copyContext(pack, clone);
  fs.writeFileSync(path.join(clone, 'unselected-private.fixture'), 'must not be copied');
  const secondClone = path.join(tmp, 'second-pack'); copyContext(new ContextPack(clone), secondClone);
  check(() => assert(!fs.existsSync(path.join(secondClone, 'unselected-private.fixture'))));
  const changed = new ContextPack(clone); fs.appendFileSync(path.join(clone, 'context/usage.md'), '\nchanged\n');
  rejects(() => changed.read('context/usage.md'), /changed since/);
  rejects(() => changed.search('setup'), /changed since/);
  for (const name of ['.pi/agent/auth.json', '.pi/agent/context/private-extra.md', '.local/share/vertrice-work/tasks/runtime.md']) {
    check(() => assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', name]).status, 0, name + ' must not enter dotfiles'));
  }
  for (const name of ['.pi/agent/work-store.mjs', '.pi/agent/extensions/work.ts', '.pi/agent/context/manifest.json']) {
    check(() => assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', name]).status, 1, name + ' must ship'));
  }

  // Native filesystem serialization across processes, not just an async fake.
  const concurrent = new WorkStore(path.join(tmp, 'concurrent'));
  concurrent.create(input, 'main');
  const module = pathToFileURL(path.join(agent, 'work-store.mjs')).href;
  held = holdLock(concurrent.location());
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {WorkStore} from ${JSON.stringify(module)};try{new WorkStore(${JSON.stringify(concurrent.root)}).create(${JSON.stringify(input)},'child');process.exit(2)}catch(e){if(!e.message.includes('Store busy'))process.exit(3)}`]);
  check(() => assert.equal(child.status, 0));
  fs.closeSync(held);

  // Exercise actual extension handlers and widget against disk; this is an API
  // fixture, not a native Pi renderer/model claim (tested separately).
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(agent, 'extensions/work.ts'), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^const packRoot = .*;$/m, `const packRoot = ${JSON.stringify(agent)};`).replace('export default function', 'function extension');
  const types = new Proxy({}, { get: () => (...args) => ({ args }) });
  const tools = {}, events = {}, commands = {}, widgets = [], statuses = [];
  const old = process.env.VERTRICE_WORK_DIR; process.env.VERTRICE_WORK_DIR = path.join(tmp, 'ui');
  try { compileFunction(source + '\nreturn extension;', ['os', 'path', 'fs', 'Type', 'WorkStore', 'ContextPack', 'directory'])(os, path, fs, types, WorkStore, ContextPack, directory)({ registerTool: tool => { tools[tool.name] = tool; }, registerCommand: (name, command) => { commands[name] = command; }, on: (name, handler) => { events[name] = handler; } }); }
  finally { if (old === undefined) delete process.env.VERTRICE_WORK_DIR; else process.env.VERTRICE_WORK_DIR = old; }
  const ctx = { hasUI: true, sessionManager: { getSessionId: () => 'ui-owner' }, ui: { setWidget: (_key, lines) => widgets.push(lines), setStatus: (_key, status) => statuses.push(status) } };
  const call = (params, signal) => tools.work_task.execute('fixture', params, signal, undefined, ctx);
  await events.session_start({}, ctx);
  check(() => assert.equal(widgets.at(-1), undefined));
  check(() => assert.equal(statuses.at(-1), undefined));
  await commands.work.handler('', ctx);
  check(() => assert(widgets.at(-1)[0].includes('0 open')));
  let result = await call({ action: 'create', ...input });
  check(() => assert(!result.isError));
  const created = result.details;
  check(() => assert(widgets.at(-1).some(line => line.includes('Qualify task tools'))));
  result = await call({ action: 'update', id: created.task.id, revision: created.revision, patch: { status: 'in_progress' } });
  check(() => assert.equal(result.details.task.owner, 'ui-owner'));
  check(() => assert(widgets.at(-1)[0].includes('1 active')));
  result = await call({ action: 'update', id: created.task.id, revision: created.revision, patch: { status: 'completed' } });
  check(() => assert(result.isError && result.details.error.includes('Stale')));
  const cancelled = await call({ action: 'create', ...input }, { aborted: true });
  check(() => assert(cancelled.isError));
  const listing = await call({ action: 'list' });
  check(() => assert.equal(listing.details.total, 1));
  const contextResult = await tools.context_read.execute('', { path: 'context/usage.md' });
  check(() => assert.equal(contextResult.details.path, 'context/usage.md'));
  const deniedContext = await tools.context_read.execute('', { path: 'auth.json' });
  check(() => assert(deniedContext.isError));
  const disk = new WorkStore(path.join(tmp, 'ui')); const active = disk.read(created.task.id);
  disk.update(active.task.id, active.revision, { status: 'completed', evidence: ['API fixture result checked'], next_action: '' }, 'ui-owner');
  await events.turn_end({}, ctx);
  check(() => assert(widgets.at(-1)[0].includes('0 open / 0 active')));
  await commands.work.handler('', ctx);
  check(() => assert.equal(widgets.at(-1), undefined));
  check(() => assert.equal(statuses.at(-1), undefined));
  fs.writeFileSync(active.file, 'corrupt record');
  await events.turn_end({}, ctx);
  // The new public baseline distinguishes record-local errors from store failure.
  check(() => assert(widgets.at(-1)[0].includes('PARTIAL; 1 record errors')));
  check(() => assert(statuses.at(-1).includes('PARTIAL errors:1')));
  const badListing = await call({ action: 'list' });
  check(() => assert(!badListing.isError && badListing.details.partial));
  check(() => assert.equal(badListing.details.error_total, 1));
  check(() => assert.equal(badListing.details.errors[0].file, active.file));
  const stillValid = disk.create(input, 'ui-owner');
  const mixed = await call({ action: 'list' });
  check(() => assert.equal(mixed.details.valid_total, 1));
  check(() => assert.equal(mixed.details.records[0].id, stillValid.task.id));
  fs.writeFileSync(path.join(disk.location(), 'README.md'), '# Authored guide, not a task\n');
  check(() => assert.equal(disk.list().length, 2));
  // An ENOENT during enumeration is not an uninitialized location.
  const vanished = new WorkStore(path.join(tmp, 'vanished'));
  vanished.location = () => path.join(tmp, 'missing-after-location');
  rejects(() => vanished.list(), /ENOENT/);
  // A non-directory tasks path is a store-level failure, not a partial record.
  fs.renameSync(disk.location(), path.join(tmp, 'saved-tasks'));
  fs.writeFileSync(path.join(disk.root, 'tasks'), 'not a directory');
  await events.turn_end({}, ctx);
  check(() => assert(widgets.at(-1)[0].includes('STORE ERROR')));
  const storeFailure = await call({ action: 'list' });
  check(() => assert(storeFailure.isError));
  console.log(`PASS ${checks} plaintext persistence, fidelity, validation, revision/ownership, lock/process, path safety, context and widget/API assertions`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true }); // This test's owned scratch only.
}
