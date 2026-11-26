import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const source = path.resolve(process.argv[2]);
const shared = path.join(source, '.local/share/vertrice-agents');
const { WorkStore, ContextPack, parse, serialize } = await import(pathToFileURL(path.join(shared, 'work-store.mjs')));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-core-')));
let checks = 0;
const check = fn => { fn(); checks++; };
const rejects = (fn, pattern) => check(() => assert.throws(fn, pattern));
try {
  // B1: identical manifests, real parent accepted / symlink parent rejected.
  const realPack = path.join(tmp, 'real-pack'), linkedPack = path.join(tmp, 'linked-pack');
  fs.mkdirSync(path.join(realPack, 'context'), { recursive: true });
  fs.mkdirSync(linkedPack);
  const manifest = { schema: 1, files: [], origin: 'fixture sentinel' };
  fs.writeFileSync(path.join(realPack, 'context/manifest.json'), JSON.stringify(manifest));
  check(() => assert.equal(new ContextPack(realPack).manifest.origin, manifest.origin));
  fs.symlinkSync(path.join(realPack, 'context'), path.join(linkedPack, 'context'));
  rejects(() => new ContextPack(linkedPack), /real directory/);
  // Isolated package fixture with stand-in templates; the real templates are
  // checked by their own content, not here.
  const local = path.join(tmp, 'package/.local');
  const bin = path.join(local, 'bin/vertrice-agents');
  const lib = path.join(local, 'share/vertrice-agents');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.mkdirSync(path.join(lib, 'templates'), { recursive: true });
  fs.copyFileSync(path.join(shared, 'templates/private.gitignore'), path.join(lib, 'templates/private.gitignore'));
  fs.copyFileSync(path.join(source, '.local/bin/vertrice-agents'), bin);
  for (const name of ['cli.mjs', 'work-store.mjs']) fs.copyFileSync(path.join(shared, name), path.join(lib, name));
  for (const name of ['AGENTS.md', 'README.md', 'USER.md', 'vision.md']) fs.writeFileSync(path.join(lib, 'templates', name), `# ${name}\nfixture needle\n`);
  for (const lane of ['tasks', 'plans', 'decisions', 'handoffs', 'reports', 'memory', 'skills', 'sessions', 'archive']) {
    fs.mkdirSync(path.join(lib, 'templates', lane));
    fs.writeFileSync(path.join(lib, 'templates', lane, 'README.md'), `# ${lane}\n`);
  }
  const root = path.join(tmp, 'owner space/.agents');
  const run = (args, ok = true, env = {}) => {
    const result = spawnSync('sh', [bin, '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
    check(() => assert.equal(result.status === 0, ok, result.stderr || result.stdout));
    return result;
  };
  const help = run(['--help']).stdout;
  check(() => assert(help.includes('task update ID REVISION ACTOR JSON')));
  run(['task', '--help']);
  const firstInit = JSON.parse(run(['init']).stdout);
  check(() => assert.equal(firstInit.created.length, 14));
  check(() => assert(firstInit.created.includes('.gitignore')));
  check(() => assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '*\n!.gitignore\n'));
  check(() => assert.equal(fs.statSync(path.join(root, '.gitignore')).mode & 0o777, 0o600));
  for (const lane of ['tasks', 'plans', 'decisions', 'handoffs', 'reports', 'memory', 'skills', 'sessions', 'archive']) {
    check(() => assert.equal(fs.statSync(path.join(root, lane)).mode & 0o777, 0o700));
  }
  check(() => assert.equal(fs.statSync(path.join(root, 'USER.md')).mode & 0o777, 0o600));
  fs.writeFileSync(path.join(root, 'USER.md'), 'Owner text survives verbatim.\n');
  const ownerIgnore = '# Owner policy remains owner policy.\n[not a source](missing.md)\n';
  fs.writeFileSync(path.join(root, '.gitignore'), ownerIgnore);
  fs.chmodSync(path.join(root, '.gitignore'), 0o640);
  const before = fs.readFileSync(path.join(lib, 'templates/USER.md'), 'utf8');
  const again = JSON.parse(run(['init']).stdout);
  check(() => assert.deepEqual(again.created, []));
  check(() => assert.equal(fs.readFileSync(path.join(root, 'USER.md'), 'utf8'), 'Owner text survives verbatim.\n'));
  check(() => assert.equal(fs.readFileSync(path.join(lib, 'templates/USER.md'), 'utf8'), before));
  check(() => assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), ownerIgnore));
  check(() => assert.equal(fs.statSync(path.join(root, '.gitignore')).mode & 0o777, 0o640));
  fs.renameSync(path.join(root, '.gitignore'), path.join(root, '.gitignore.saved'));
  run(['check'], false);
  fs.symlinkSync(path.join(root, '.gitignore.saved'), path.join(root, '.gitignore'));
  run(['init'], false);
  run(['check'], false);
  fs.unlinkSync(path.join(root, '.gitignore'));
  fs.renameSync(path.join(root, '.gitignore.saved'), path.join(root, '.gitignore'));
  run(['check']);
  const input = { title: 'Possibility', next_action: 'Consider it', spent_when: 'Evidence checked and delivered' };
  let row = JSON.parse(run(['task', 'create', 'session-a', JSON.stringify(input)]).stdout);
  check(() => assert.equal(row.kind, 'maybe'));
  const store = new WorkStore(root);
  // N1: UUID strings round-trip; arrays must not coerce to UUID strings.
  const validBytes = serialize(row.task);
  check(() => assert.equal(parse(validBytes).id, row.task.id));
  check(() => assert.equal(store.read(row.task.id).task.id, row.task.id));
  rejects(() => serialize({ ...row.task, id: [row.task.id] }), /Invalid task schema/);
  rejects(() => parse(validBytes.replace(`id: ${JSON.stringify(row.task.id)}\n`, `id: ${JSON.stringify([row.task.id])}\n`)), /Invalid task schema/);
  rejects(() => store.file([row.task.id]), /Invalid task id/);
  rejects(() => store.read([row.task.id]), /Invalid task id/);
  rejects(() => store.update(row.task.id, row.revision, { kind: 'commitment' }, 'session-a'), /kind/);
  const previous = row;
  // Session A is this live process; only a live, declared claim locks.
  const liveA = { VERTRICE_SESSION_PID: String(process.pid) };
  row = JSON.parse(run(['task', 'update', row.task.id, row.revision, 'session-a', '{"kind":"todo","status":"in_progress"}'], true, liveA).stdout);
  check(() => assert.equal(row.kind, 'todo'));
  check(() => assert.equal(row.task.owner, 'session-a'));
  check(() => assert.equal(row.claim, 'live'));
  run(['task', 'update', row.task.id, previous.revision, 'session-a', '{"title":"stale"}'], false, liveA);
  run(['task', 'update', row.task.id, row.revision, 'session-b', '{"title":"steal"}'], false);
  run(['task', 'update', row.task.id, row.revision, 'session-a', '{"status":"completed"}'], false, liveA);
  row = JSON.parse(run(['task', 'update', row.task.id, row.revision, 'session-a', '{"status":"completed","evidence":["Fixture delivery checked"],"next_action":""}'], true, liveA).stdout);
  check(() => assert.equal(row.task.status, 'completed'));
  const legacy = { ...row.task }; delete legacy.kind;
  fs.writeFileSync(row.file, serialize(legacy));
  const legacyBytes = fs.readFileSync(row.file, 'utf8');
  check(() => assert(!Object.hasOwn(parse(legacyBytes), 'kind')));
  check(() => assert.equal(JSON.parse(run(['task', 'read', row.task.id]).stdout).kind, 'legacy'));
  check(() => assert.equal(fs.readFileSync(row.file, 'utf8'), legacyBytes));
  const incubate = store.create({ ...input, kind: 'incubate' }, 'session-a');
  check(() => assert.equal(incubate.task.kind, 'incubate'));
  fs.writeFileSync(path.join(root, 'sessions/raw.md'), 'needle private-session');
  fs.mkdirSync(path.join(root, 'memory/private'));
  fs.writeFileSync(path.join(root, 'memory/private/secret.md'), 'needle private-memory');
  fs.writeFileSync(path.join(root, 'plans/plan.md'), 'needle authored-plan\n[source](../reports/evidence.md)\n');
  fs.writeFileSync(path.join(root, 'reports/evidence.md'), 'needle source-evidence\n');
  // No Node on PATH: lexical discovery is a base-tools operation.
  const found = run(['find', 'needle'], true, { PATH: '/usr/bin:/bin' }).stdout;
  check(() => assert(found.includes('./plans/plan.md:1:needle authored-plan')));
  check(() => assert(!found.includes('private-session') && !found.includes('private-memory')));
  check(() => assert.equal(run(['find', 'no-match-zzzz']).stdout, ''));
  run(['find', '-not-a-grep-option']);
  fs.writeFileSync(path.join(root, 'handoffs/thread.md'), '[source](../sessions/nonexistent.md)\n');
  check(() => assert(JSON.parse(run(['check']).stdout).links.some(link => link.status === 'unchecked excluded data lane')));
  check(() => assert(JSON.parse(run(['check']).stdout).links.some(link => link.status.startsWith('local regular file'))));
  fs.writeFileSync(path.join(root, 'plans/missing.md'), '[source](missing-source.md)\n');
  run(['check'], false);
  fs.unlinkSync(path.join(root, 'plans/missing.md'));
  fs.symlinkSync(path.join(root, 'sessions'), path.join(root, 'plans/linked'));
  run(['check'], false);
  check(() => assert(!run(['find', 'private-session']).stdout.includes('private-session')));
  fs.unlinkSync(path.join(root, 'plans/linked'));
  fs.symlinkSync(path.join(root, 'USER.md'), path.join(root, 'plans/link.md'));
  run(['check'], false);
  fs.unlinkSync(path.join(root, 'plans/link.md'));
  fs.renameSync(path.join(root, 'USER.md'), path.join(root, 'USER.saved'));
  fs.symlinkSync(path.join(root, 'USER.saved'), path.join(root, 'USER.md'));
  run(['init'], false);
  fs.unlinkSync(path.join(root, 'USER.md'));
  fs.renameSync(path.join(root, 'USER.saved'), path.join(root, 'USER.md'));
  fs.renameSync(path.join(root, 'memory'), path.join(root, 'memory.saved'));
  fs.symlinkSync(path.join(root, 'memory.saved'), path.join(root, 'memory'));
  run(['init'], false);
  fs.unlinkSync(path.join(root, 'memory'));
  fs.renameSync(path.join(root, 'memory.saved'), path.join(root, 'memory'));
  fs.renameSync(path.join(lib, 'templates/vision.md'), path.join(lib, 'templates/vision.saved'));
  fs.symlinkSync(path.join(lib, 'templates/vision.saved'), path.join(lib, 'templates/vision.md'));
  run(['init'], false);
  fs.unlinkSync(path.join(lib, 'templates/vision.md'));
  fs.renameSync(path.join(lib, 'templates/vision.saved'), path.join(lib, 'templates/vision.md'));
  const symlinkRoot = path.join(tmp, 'linked');
  fs.symlinkSync(root, symlinkRoot);
  const unsafe = spawnSync('sh', [bin, '--root', symlinkRoot, 'init'], { encoding: 'utf8' });
  check(() => assert.notEqual(unsafe.status, 0));
  fs.writeFileSync(path.join(root, 'tasks/broken.md'), 'not a task');
  const partial = JSON.parse(run(['task', 'list'], false).stdout);
  check(() => assert(partial.some(entry => entry.file.endsWith('/broken.md') && entry.error.includes('Invalid task id'))));
  check(() => assert(partial.some(entry => entry.task?.id === row.task.id)));
  check(() => assert(!partial.some(entry => entry.file.endsWith('/README.md'))));
  const brief = partial.find(entry => entry.task?.id === row.task.id);
  const full = JSON.parse(run(['task', 'list', '--full'], false).stdout)
    .find(entry => entry.task?.id === row.task.id);
  check(() => assert.equal(brief.file, full.file));
  check(() => assert.equal(brief.task.next_action, full.task.next_action));
  check(() => assert(!Object.hasOwn(brief.task, 'notes') && !Object.hasOwn(brief.task, 'evidence')));
  check(() => assert.equal(full.revision, store.read(row.task.id).revision));
  check(() => assert(Object.hasOwn(full.task, 'notes') && Object.hasOwn(full.task, 'evidence')));
  run(['check'], false);
  fs.unlinkSync(path.join(root, 'tasks/broken.md'));
  fs.writeFileSync(row.file, 'malformed record');
  run(['task', 'read', row.task.id], false);
  fs.writeFileSync(row.file, legacyBytes);
  // Native tar recovery is exercised only on this test's private fixture.
  const archive = path.join(tmp, 'backup.tar'), recovered = path.join(tmp, 'recovered');
  check(() => assert.equal(spawnSync('tar', ['-cf', archive, '-C', root, '.']).status, 0));
  fs.mkdirSync(recovered);
  check(() => assert.equal(spawnSync('tar', ['-xf', archive, '-C', recovered]).status, 0));
  check(() => assert.equal(new WorkStore(recovered).read(row.task.id).revision, store.read(row.task.id).revision));
  check(() => assert.equal(fs.readFileSync(path.join(recovered, 'USER.md'), 'utf8'), 'Owner text survives verbatim.\n'));
  // Also seed from the actual concurrently authored public templates.
  const publicRepo = path.join(tmp, 'public-like repo');
  fs.mkdirSync(publicRepo);
  const git = args => {
    const result = spawnSync('git', ['-C', publicRepo, ...args], { encoding: 'utf8' });
    check(() => assert.equal(result.status, 0, result.stderr));
    return result.stdout;
  };
  git(['init', '-q']);
  const actualRoot = path.join(publicRepo, '.agents');
  const actual = spawnSync('sh', [path.join(source, '.local/bin/vertrice-agents'), '--root', actualRoot, 'init'], { encoding: 'utf8' });
  check(() => assert.equal(actual.status, 0, actual.stderr));
  check(() => assert.equal(JSON.parse(actual.stdout).created.length, 14));
  check(() => assert.equal(fs.readFileSync(path.join(actualRoot, '.gitignore'), 'utf8'), '*\n!.gitignore\n'));
  check(() => assert.equal(fs.readFileSync(path.join(actualRoot, 'tasks/README.md'), 'utf8'), fs.readFileSync(path.join(shared, 'templates/tasks/README.md'), 'utf8')));
  const actualCheck = spawnSync('sh', [path.join(source, '.local/bin/vertrice-agents'), '--root', actualRoot, 'check'], { encoding: 'utf8' });
  check(() => assert.equal(actualCheck.status, 0, actualCheck.stderr));
  const privateTask = new WorkStore(actualRoot).create(input, 'fixture');
  fs.writeFileSync(path.join(actualRoot, 'memory/private-fact.md'), 'Fabricated private fact.\n');
  fs.writeFileSync(path.join(actualRoot, 'sessions/private-session.jsonl'), '{"fixture":"private"}\n');
  fs.writeFileSync(path.join(publicRepo, 'public-source.txt'), 'Public source fixture.\n');
  const publicTemplates = path.join(publicRepo, '.local/share/vertrice-agents/templates');
  fs.cpSync(path.join(shared, 'templates'), publicTemplates, { recursive: true });
  check(() => assert(!fs.existsSync(path.join(publicTemplates, '.gitignore'))));
  check(() => assert.equal(fs.readFileSync(path.join(publicTemplates, 'private.gitignore'), 'utf8'), '*\n!.gitignore\n'));
  const sourcePaths = ['.local/share/vertrice-agents/templates/private.gitignore', '.local/share/vertrice-agents/templates/README.md', '.local/share/vertrice-agents/templates/tasks/README.md'];
  const sourceIgnore = spawnSync('git', ['-C', publicRepo, 'check-ignore', '--no-index', '--', ...sourcePaths], { encoding: 'utf8' });
  check(() => assert.equal(sourceIgnore.status, 1, sourceIgnore.stderr));
  check(() => assert.equal(sourceIgnore.stdout, ''));
  const privatePaths = [path.relative(publicRepo, privateTask.file), '.agents/memory/private-fact.md', '.agents/sessions/private-session.jsonl', '.agents/USER.md'];
  check(() => assert.deepEqual(git(['check-ignore', '--', ...privatePaths]).trim().split('\n'), privatePaths));
  git(['add', '--all']);
  const staged = git(['ls-files']).trim().split('\n');
  check(() => assert(staged.includes('.agents/.gitignore') && staged.includes('public-source.txt') && sourcePaths.every(file => staged.includes(file))));
  check(() => assert.deepEqual(staged.filter(file => file.startsWith('.agents/')), ['.agents/.gitignore']));

  // Several harness sessions sharing one home (Pi, OpenCode, Hermes).
  const team = path.join(tmp, 'team/.agents');
  const cli = (...args) => spawnSync('sh', [bin, '--root', team, ...args], { encoding: 'utf8' });
  check(() => assert.equal(cli('init').status, 0));
  const job = title => ['task', 'create', 'teammate', JSON.stringify({ title, next_action: 'Do it', spent_when: 'Checked' })];
  // Writers queue briefly instead of failing on a busy lock.
  const busy = Array.from({ length: 12 }, (_, i) => new Promise(resolve => {
    const child = spawn('sh', [bin, '--root', team, ...job('Parallel ' + i)]);
    child.on('close', resolve);
  }));
  const codes = await Promise.all(busy);
  check(() => assert.deepEqual(codes.filter(code => code !== 0), []));
  check(() => assert.equal(new WorkStore(team).list().length, 12));
  // The kernel holds the lock: a writer killed inside it frees it at once.
  const teamStore = new WorkStore(team);
  const holdLock = body => spawn(process.execPath, ['--input-type=module', '-e',
    `import {WorkStore} from ${JSON.stringify(pathToFileURL(path.join(shared, 'work-store.mjs')).href)};new WorkStore(${JSON.stringify(team)}).locked(()=>{${body}});`]);
  const killed = holdLock("process.kill(process.pid,'SIGKILL')");
  await new Promise(resolve => killed.on('close', resolve));
  check(() => assert.equal(cli(...job('After crash')).status, 0));
  // A live holder (here: paused inside the lock) is waited on, then refused.
  const paused = holdLock("process.stdout.write('in');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8000)");
  await new Promise(resolve => paused.stdout.once('data', resolve));
  const busyWrite = cli(...job("Behind a live writer"));
  check(() => assert(busyWrite.status !== 0 && /Store busy/.test(busyWrite.stderr), busyWrite.stderr));
  paused.kill('SIGKILL'); await new Promise(resolve => paused.on('close', resolve));
  check(() => assert.equal(cli(...job('After the holder ended')).status, 0));
  // A temp file left by a killed writer is removed by the next writer.
  fs.writeFileSync(path.join(teamStore.location(), '.tmp-left-behind'), 'partial');
  check(() => assert.equal(cli(...job('Next writer')).status, 0));
  check(() => assert(!fs.existsSync(path.join(teamStore.location(), '.tmp-left-behind'))));
  // A claim belongs to a live session. When that session ends, the claim
  // lapses and the task is back with the store for any session to take.
  const sessionCli = (pid, ...args) => spawnSync('sh', [bin, '--root', team, ...args], { encoding: 'utf8', env: { ...process.env, VERTRICE_SESSION_PID: String(pid) } });
  const sessionA = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']);
  let claimed = JSON.parse(cli(...job('Claimed by A')).stdout);
  claimed = JSON.parse(sessionCli(sessionA.pid, 'task', 'update', claimed.task.id, claimed.revision, 'session-a', '{"status":"in_progress"}').stdout);
  check(() => assert.equal(claimed.claim, 'live'));
  const blockedTake = sessionCli(process.pid, 'task', 'update', claimed.task.id, claimed.revision, 'session-b', '{"status":"in_progress"}');
  check(() => assert(blockedTake.status !== 0 && /held by live session session-a/.test(blockedTake.stderr), blockedTake.stderr));
  sessionA.kill('SIGKILL');
  await new Promise(resolve => sessionA.on('close', resolve));
  const lapsed = JSON.parse(cli('task', 'read', claimed.task.id).stdout);
  check(() => assert.equal(lapsed.claim, 'lapsed'));
  check(() => assert(JSON.parse(cli('task', 'list').stdout).some(r => r.task.id === claimed.task.id && r.claim === 'lapsed')));
  const taken = JSON.parse(sessionCli(process.pid, 'task', 'update', claimed.task.id, lapsed.revision, 'session-b', '{"status":"in_progress"}').stdout);
  check(() => assert(taken.task.owner === 'session-b' && taken.claim === 'live'));
  // The new claim is live again: another live process cannot open it, even
  // by typing the owner's name.
  const sessionC = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']);
  const impostor = sessionCli(sessionC.pid, 'task', 'update', claimed.task.id, taken.revision, 'session-b', '{"notes":"late"}');
  check(() => assert(impostor.status !== 0 && /held by live session/.test(impostor.stderr), impostor.stderr));
  sessionC.kill('SIGKILL');
  // Another session in the same process (same pid, other name) cannot change it either.
  const sameProcess = sessionCli(process.pid, 'task', 'update', claimed.task.id, taken.revision, 'session-z', '{"notes":"same process, other session"}');
  check(() => assert(sameProcess.status !== 0 && /held by live session/.test(sameProcess.stderr), sameProcess.stderr));
  // Releasing removes the claim file; a record without one reads as before.
  const released = JSON.parse(sessionCli(process.pid, 'task', 'update', claimed.task.id, taken.revision, 'session-b', '{"status":"pending"}').stdout);
  check(() => assert(released.claim === undefined && !fs.existsSync(teamStore.claimFile(claimed.task.id))));
  // A claim made without a declared session cannot be checked, and does not
  // lock: any session may take it.
  let unchecked = JSON.parse(cli(...job('Undeclared session')).stdout);
  const noPid = { ...process.env }; delete noPid.VERTRICE_SESSION_PID; delete noPid.VERTRICE_SESSION_ID;
  unchecked = JSON.parse(spawnSync('sh', [bin, '--root', team, 'task', 'update', unchecked.task.id, unchecked.revision, 'session-c', '{"status":"in_progress"}'], { encoding: 'utf8', env: noPid }).stdout);
  check(() => assert.equal(unchecked.claim, 'unchecked'));
  const takeUnchecked = sessionCli(process.pid, 'task', 'update', unchecked.task.id, unchecked.revision, 'session-d', '{"status":"in_progress"}');
  check(() => assert.equal(takeUnchecked.status, 0, takeUnchecked.stderr));
  // A claim file that names someone the record does not (an interrupted
  // write) reads as unchecked and does not lock.
  const interrupted = JSON.parse(takeUnchecked.stdout);
  fs.writeFileSync(teamStore.claimFile(interrupted.task.id), JSON.stringify({ actor: 'someone-else', pid: process.pid, host: os.hostname(), since: 'now' }));
  check(() => assert.equal(teamStore.read(interrupted.task.id).claim, 'unchecked'));
  // When the harness names its session, the typed actor must match it.
  const wrongName = spawnSync('sh', [bin, '--root', team, ...job('Wrong name')], { encoding: 'utf8', env: { ...process.env, VERTRICE_SESSION_ID: 'the-real-session' } });
  check(() => assert(wrongName.status !== 0 && /ACTOR must be this session's id/.test(wrongName.stderr), wrongName.stderr));
  // A record carrying a claim still parses with the record-only reader.
  check(() => assert.equal(parse(fs.readFileSync(taken.file, 'utf8')).id, claimed.task.id));
  // check reports a broken link instead of stopping, and keeps the report.
  fs.writeFileSync(path.join(team, 'handoffs/broken.md'), '[plan](../plans/gone.md)\n');
  const broken = cli('check');
  check(() => assert.equal(broken.status, 1));
  check(() => assert(JSON.parse(broken.stdout).links.some(l => l.status === 'BROKEN' && l.target === '../plans/gone.md')));
  fs.unlinkSync(path.join(team, 'handoffs/broken.md'));
  // A lane that is itself a symlink is reported and never entered.
  const outsideLane = path.join(tmp, 'outside-lane');
  fs.mkdirSync(outsideLane); fs.writeFileSync(path.join(outsideLane, 'outside.md'), '[x](nowhere.md)\n');
  fs.renameSync(path.join(team, 'reports'), path.join(team, 'reports.real'));
  fs.symlinkSync(outsideLane, path.join(team, 'reports'));
  const linkedLane = JSON.parse(cli('check').stdout);
  check(() => assert(linkedLane.problems.some(p => p.file.endsWith('/reports'))));
  check(() => assert(!JSON.stringify(linkedLane).includes('outside.md')));
  fs.unlinkSync(path.join(team, 'reports'));
  fs.renameSync(path.join(team, 'reports.real'), path.join(team, 'reports'));
  // A skill linked in from elsewhere is reported, not followed, not an error.
  const skillRepo = path.join(tmp, 'skill-repo/tidy');
  fs.mkdirSync(skillRepo, { recursive: true });
  fs.writeFileSync(path.join(skillRepo, 'SKILL.md'), '# tidy\nOUTSIDE-SKILL-TEXT\n');
  fs.symlinkSync(skillRepo, path.join(team, 'skills/tidy'));
  const linked = cli('check');
  check(() => assert.equal(linked.status, 0, linked.stderr));
  check(() => assert(JSON.parse(linked.stdout).skipped.some(s => s.status === 'symlink not followed')));
  check(() => assert.equal(cli('find', 'OUTSIDE-SKILL-TEXT').stdout, ''));
  // check reports, never stops, on ordinary content: a bad % escape, a link
  // to a directory, a large linked asset, a titled or <bracketed> link, a
  // link into a linked skill, and a missing optional owner file.
  fs.writeFileSync(path.join(team, 'reports/big.pdf'), Buffer.alloc(200 * 1024));
  fs.writeFileSync(path.join(team, 'handoffs/mixed.md'),
    '[pct](100%.md)\n[dir](../skills/)\n[pdf](../reports/big.pdf)\n[t](../plans/p.md "title")\n[b](<../plans/p.md>)\n[s](../skills/tidy/SKILL.md)\n');
  fs.writeFileSync(path.join(team, 'plans/p.md'), 'plan\n');
  fs.renameSync(path.join(team, 'USER.md'), path.join(team, 'USER.away'));
  const mixed = cli('check');
  const report = JSON.parse(mixed.stdout), byTarget = t => report.links.find(l => l.target === t)?.status;
  check(() => assert.equal(byTarget('100%.md'), 'BROKEN'));
  check(() => assert.equal(byTarget('../skills/'), 'local directory exists'));
  check(() => assert(byTarget('../reports/big.pdf').startsWith('local regular file exists')));
  check(() => assert.equal(report.links.filter(l => l.target === '../plans/p.md').length, 2));
  check(() => assert.equal(byTarget('../skills/tidy/SKILL.md'), 'symlink not followed'));
  check(() => assert(report.skipped.some(s => s.status === 'optional file absent')));
  check(() => assert.equal(mixed.status, 1)); // the bad % escape
  fs.renameSync(path.join(team, 'USER.away'), path.join(team, 'USER.md'));
  fs.unlinkSync(path.join(team, 'handoffs/mixed.md'));
  // find does not follow a symlinked lane, and still searches the rest.
  fs.writeFileSync(path.join(team, 'decisions/d.md'), 'NEEDLE-AFTER-SKIP\n');
  fs.writeFileSync(path.join(team, 'plans/hidden-behind-link.md'), 'NEEDLE-AFTER-SKIP\n');
  fs.renameSync(path.join(team, 'plans'), path.join(team, 'plans.real'));
  fs.symlinkSync(path.join(team, 'plans.real'), path.join(team, 'plans'));
  const skipping = cli('find', 'NEEDLE-AFTER-SKIP');
  check(() => assert(skipping.stdout.includes('decisions/d.md') && !skipping.stdout.includes('hidden-behind-link') && skipping.status === 0, skipping.stdout + skipping.stderr));
  fs.unlinkSync(path.join(team, 'plans.real/hidden-behind-link.md'));
  fs.unlinkSync(path.join(team, 'plans'));
  fs.renameSync(path.join(team, 'plans.real'), path.join(team, 'plans'));
  // Unquoted words are one phrase, as shell-tool agents tend to send them.
  fs.writeFileSync(path.join(team, 'plans/p.md'), 'Use git status first.\n');
  check(() => assert(cli('find', 'git', 'status').stdout.includes('plans/p.md')));
  check(() => assert.equal(cli('find', 'status', 'git').stdout, ''));
  console.log(`PASS ${checks} shared init, preservation, private modes, kinds/legacy, revision/owner, evidence, malformed records, lexical discovery, source links, symlink refusal, tar recovery and shared-team lock/check/find assertions`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true }); // This test's owned fixture only.
}
