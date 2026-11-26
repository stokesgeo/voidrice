// Portable plaintext records. No shell, network, dependencies or auto-sync.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';

export const statuses = ['pending', 'in_progress', 'blocked', 'parked', 'completed'];
export const kinds = ['maybe', 'incubate', 'todo'];
const fields = ['schema', 'id', 'title', 'status', 'owner', 'next_action', 'spent_when', 'blockers', 'evidence', 'created', 'updated'];
export const digest = data => createHash('sha256').update(data).digest('hex');
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const cap = 128 * 1024;

function text(value, name, max = 8000) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)) throw new Error(`Invalid ${name}`);
}

function validate(task) {
  const expected = [...fields, 'notes', ...(Object.hasOwn(task, 'kind') ? ['kind'] : [])];
  if (Object.keys(task).sort().join() !== expected.sort().join() || task.schema !== 1 || typeof task.id !== 'string' || !idPattern.test(task.id)) throw new Error('Invalid task schema');
  if (Object.hasOwn(task, 'kind') && !kinds.includes(task.kind)) throw new Error('Invalid task kind');
  for (const key of ['title', 'owner', 'next_action', 'spent_when', 'created', 'updated', 'notes']) text(task[key], key, key === 'notes' ? 64000 : 8000);
  if (!task.title.trim() || !task.spent_when.trim() || !statuses.includes(task.status)) throw new Error('Title, completion condition and valid status required');
  for (const key of ['blockers', 'evidence']) {
    if (!Array.isArray(task[key]) || task[key].length > 100) throw new Error(`Invalid ${key}`);
    for (const item of task[key]) { text(item, key); if (!item.trim()) throw new Error(`Empty ${key}`); }
  }
  if (task.status !== 'completed' && !task.next_action.trim()) throw new Error('Unfinished work needs a next action');
  if (task.status === 'in_progress' && !task.owner.trim()) throw new Error('Active work needs an owner');
  if (task.status === 'blocked' && !task.blockers.length) throw new Error('Blocked work needs a blocker');
  if (task.status === 'completed' && !task.evidence.length) throw new Error('Completion needs outcome evidence, not just an exit code');
  if (task.status === 'completed' && task.blockers.length) throw new Error('Resolve blockers before completion');
}

export function serialize(task) {
  validate(task);
  const keys = [...fields, ...(Object.hasOwn(task, 'kind') ? ['kind'] : [])];
  const data = '---\n' + keys.map(key => `${key}: ${JSON.stringify(task[key])}`).join('\n') + '\n---\n' + task.notes;
  if (Buffer.byteLength(data) > cap) throw new Error('Task record too large');
  return data;
}

export function parse(data) {
  if (Buffer.byteLength(data) > cap || !data.startsWith('---\n')) throw new Error('Invalid task file');
  const end = data.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('Missing task header boundary');
  const task = Object.create(null);
  for (const line of data.slice(4, end).split('\n')) {
    const match = /^([a-z_]+): (.*)$/.exec(line);
    if (!match || ![...fields, 'kind'].includes(match[1]) || Object.hasOwn(task, match[1])) throw new Error('Invalid/duplicate task field');
    task[match[1]] = JSON.parse(match[2]);
  }
  task.notes = data.slice(end + 5);
  validate(task);
  return task;
}

// Reject symlink components, including an owner-configured root. Cooperative
// same-user protection, not a boundary against a hostile process racing paths.
export function directory(dir, create) {
  const absolute = path.resolve(dir);
  for (let current = path.parse(absolute).root, parts = absolute.slice(current.length).split(path.sep), i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try { if (!fs.lstatSync(current).isDirectory()) throw new Error('Store directory is not a real directory'); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (race) { if (race.code !== 'EEXIST' || !fs.lstatSync(current).isDirectory()) throw race; }
    }
  }
  return absolute;
}

export function readFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > cap || stat.nlink !== 1) throw new Error('Record must be a bounded regular, non-hardlinked file');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

// One writer at a time. `tasks/.lock` is opened with the kernel's exclusive
// lock (O_EXLOCK, on OpenBSD, macOS and the other BSDs). The kernel drops it
// the moment its holder exits or is killed, so it never goes stale and is
// never removed. A busy lock is waited on for up to three seconds.
const O_EXLOCK = 0x20; // <fcntl.h> on OpenBSD and macOS; Node does not name it
const lockWaitMs = 3000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
function lockFlags() {
  if (!['openbsd', 'darwin', 'freebsd', 'netbsd'].includes(process.platform)) throw new Error(`The store lock needs O_EXLOCK (OpenBSD, macOS or another BSD), not ${process.platform}`);
  return fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | O_EXLOCK;
}
// A small JSON side record (a claim), read without following links.
function readSmall(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) return 'unreadable';
    return JSON.parse(fs.readFileSync(fd, 'utf8').slice(0, 4096));
  } catch (error) { return error.code === 'ENOENT' ? null : 'unreadable'; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Only a live session holds a locking claim on in_progress work. A harness
// names its session's long-lived process in VERTRICE_SESSION_PID (and may name
// the session itself in VERTRICE_SESSION_ID). The claim is kept beside the
// record as `<id>.claim`, so older readers that know only the record still
// parse it. States:
//   live      the claiming process is running: only that process may change it
//   lapsed    that process has ended (or is not this user's): back with the store
//   unchecked no claim we can check (no declared process, or a claim that does
//             not match the owner): it does not lock
// Agents are trusted to cooperate: these checks stop mistakes, not a same-user
// process that sets someone else's process ID on purpose.
export function sessionPid() {
  const value = process.env.VERTRICE_SESSION_PID;
  return value && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : undefined;
}
function claimState(task, claim) {
  if (task.status !== 'in_progress') return undefined;
  if (!claim || claim === 'unreadable' || claim.actor !== task.owner || !Number.isInteger(claim.pid)) return 'unchecked';
  try { process.kill(claim.pid, 0); return 'live'; }
  catch { return 'lapsed'; } // ESRCH: gone; EPERM: another user's process, not this session
}

export class WorkStore {
  constructor(root) { this.root = path.resolve(root); }
  claimFile(id) { return this.file(id).replace(/\.md$/, '.claim'); }
  readClaim(id) {
    const c = readSmall(this.claimFile(id));
    return c && c !== 'unreadable' && typeof c.actor === 'string' ? c : c === null ? null : 'unreadable';
  }
  location(create = false) { return directory(path.join(this.root, 'tasks'), create); }
  file(id, create = false) {
    if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Invalid task id');
    return path.join(this.location(create), id + '.md');
  }
  read(id) {
    const file = this.file(id), data = readFile(file), task = parse(data);
    if (task.id !== id) throw new Error('Filename and task id differ');
    const claim = claimState(task, task.status === 'in_progress' ? this.readClaim(id) : null);
    return { task, revision: digest(data), file, ...(claim ? { claim } : {}) };
  }
  // One lexical entry per .md name, including failures. Valid rows retain the
  // read() shape; callers must inspect error before task. Never repair on read.
  list() {
    let dir;
    try { dir = this.location(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    // Only an uninitialized location is empty. Enumeration failures (including
    // a disappearing directory) are store failures, not record-local errors.
    // README.md is the shared home's authored guide, never a task record.
    return fs.readdirSync(dir).filter(name => name.endsWith('.md') && name !== 'README.md').sort().map(name => {
      try { return this.read(name.slice(0, -3)); }
      catch (error) { return { file: path.join(dir, name), error: String(error.message).slice(0, 240) }; }
    });
  }
  locked(fn) {
    const dir = this.location(true), flags = lockFlags();
    const deadline = performance.now() + lockWaitMs; // monotonic: immune to clock changes
    let fd;
    for (let pause = 2; fd === undefined; pause = Math.min(pause * 2, 50)) {
      try { fd = fs.openSync(path.join(dir, '.lock'), flags, 0o600); }
      catch (error) {
        if (error.code !== 'EAGAIN' && error.code !== 'EWOULDBLOCK') throw error;
        if (performance.now() >= deadline) throw new Error('Store busy: another writer has held the lock for 3 s (a paused process?); retry');
        Atomics.wait(sleeper, 0, 0, pause);
      }
    }
    try {
      // Only the lock holder writes temp files, so any found now were left by
      // a writer that was killed.
      for (const name of fs.readdirSync(dir)) if (name.startsWith('.tmp-')) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* gone */ } }
      return fn();
    } finally { fs.closeSync(fd); }
  }
  // Write data to a temp file, run check() just before the switch, then
  // rename it into place. The caller holds the lock; a temp file left by a
  // failure is removed by the next writer.
  replace(file, data, check = () => {}) {
    const tmp = path.join(path.dirname(file), '.tmp-' + randomUUID());
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    check();
    fs.renameSync(tmp, file);
  }
  create(input, owner) {
    const allowed = ['title', 'next_action', 'spent_when', 'notes', 'kind'];
    if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unknown create field');
    return this.locked(() => {
      const now = new Date().toISOString();
      const task = { schema: 1, id: randomUUID(), title: input.title, kind: input.kind ?? 'maybe', status: 'pending', owner,
        next_action: input.next_action, spent_when: input.spent_when, blockers: [], evidence: [], created: now, updated: now, notes: input.notes ?? '' };
      const file = this.file(task.id);
      this.replace(file, serialize(task), () => { if (fs.existsSync(file)) throw new Error('Task id already exists'); });
      return this.read(task.id);
    });
  }
  update(id, revision, patch, actor) {
    const allowed = ['title', 'status', 'owner', 'next_action', 'spent_when', 'blockers', 'evidence', 'notes', 'kind'];
    if (!patch || Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Unknown update field');
    return this.locked(() => {
      const before = this.read(id);
      if (revision !== before.revision) throw new Error('Stale revision; reread and reconcile, do not blindly retry');
      // Only a live claim locks, and only against other processes: the
      // claiming session's own process may still change the task.
      const pid = sessionPid(), heldBy = before.claim === 'live' ? this.readClaim(id) : null;
      // The same session (name and process) only: another session sharing the
      // process, or another process using the name, cannot change it.
      if (heldBy && (heldBy.pid !== pid || heldBy.actor !== actor)) throw new Error(`Active task held by live session ${heldBy.actor}; ask it to release the task, or wait for that session to end`);
      const task = { ...before.task, ...patch, updated: new Date().toISOString() };
      if (task.status === 'in_progress' && patch.owner === undefined) task.owner = actor;
      if (task.status === 'in_progress' && task.owner !== actor) throw new Error('Only claim active work for this session');
      const data = serialize(task), claimFile = this.claimFile(id);
      // A new claim goes in place before the record says in_progress. If the
      // record write then fails, the claim names someone the record does not,
      // which reads as unchecked and does not lock.
      const keepClaim = task.status === 'in_progress' && heldBy && before.task.owner === task.owner;
      if (task.status === 'in_progress' && pid && !keepClaim) this.replace(claimFile, JSON.stringify({ actor: task.owner, pid, since: new Date().toISOString() }));
      // Also catch an edit made outside this tool (an editor) meanwhile.
      this.replace(before.file, data, () => { if (digest(readFile(before.file)) !== revision) throw new Error('Record changed during update'); });
      // Leaving in_progress, or claiming without a declared process: no claim.
      if (task.status !== 'in_progress' || !pid) { try { fs.unlinkSync(claimFile); } catch { /* none */ } }
      return this.read(id);
    });
  }
}

export class ContextPack {
  constructor(root) {
    this.root = directory(root, false);
    directory(path.join(this.root, 'context'), false);
    const data = JSON.parse(readFile(path.join(this.root, 'context', 'manifest.json')));
    if (data.schema !== 1 || !Array.isArray(data.files) || data.files.length > 100) throw new Error('Invalid context manifest');
    const seen = new Set();
    this.manifest = data;
    this.files = data.files;
    for (const file of this.files) {
      if (typeof file.path !== 'string' || !/^[a-zA-Z0-9_./-]+\.md$/.test(file.path) || path.isAbsolute(file.path) || file.path.split('/').includes('..') || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid context entry');
      seen.add(file.path);
    }
  }
  source(name) {
    const entry = this.files.find(file => file.path === name);
    if (!entry) throw new Error('Context path not in package manifest');
    directory(path.dirname(path.join(this.root, name)), false);
    const data = readFile(path.join(this.root, name));
    return { path: name, sha256: entry.sha256, text: data };
  }
  read(name) {
    const doc = this.source(name);
    if (digest(doc.text) !== doc.sha256) throw new Error('Context changed since manifest generation; refresh package index');
    return doc;
  }
  search(query, limit = 8) {
    text(query, 'query', 200);
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])];
    if (!terms.length) throw new Error('Search needs words');
    return this.files.flatMap(file => {
      const doc = this.read(file.path), lines = doc.text.split('\n'), hits = [];
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase(), score = terms.filter(term => lower.includes(term)).length;
        if (score) hits.push({ line: i + 1, score, text: lines[i].slice(0, 500) });
      }
      const score = hits.reduce((sum, hit) => sum + hit.score, 0);
      return score ? [{ path: file.path, sha256: doc.sha256, score, excerpts: hits.sort((a, b) => b.score - a.score || a.line - b.line).slice(0, 3) }] : [];
    }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
  }
}
