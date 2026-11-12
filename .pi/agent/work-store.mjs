// Portable plaintext records. No shell, network, dependencies or auto-sync.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const statuses = ['pending', 'in_progress', 'blocked', 'parked', 'completed'];
const fields = ['schema', 'id', 'title', 'status', 'owner', 'next_action', 'spent_when', 'blockers', 'evidence', 'created', 'updated'];
export const digest = data => createHash('sha256').update(data).digest('hex');
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const cap = 128 * 1024;

function text(value, name, max = 8000) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)) throw new Error(`Invalid ${name}`);
}

function validate(task) {
  if (Object.keys(task).sort().join() !== [...fields, 'notes'].sort().join() || task.schema !== 1 || !idPattern.test(task.id)) throw new Error('Invalid task schema');
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
  const data = '---\n' + fields.map(key => `${key}: ${JSON.stringify(task[key])}`).join('\n') + '\n---\n' + task.notes;
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
    if (!match || !fields.includes(match[1]) || Object.hasOwn(task, match[1])) throw new Error('Invalid/duplicate task field');
    task[match[1]] = JSON.parse(match[2]);
  }
  task.notes = data.slice(end + 5);
  validate(task);
  return task;
}

// Reject symlink components, including an owner-configured root. Cooperative
// same-user protection, not a boundary against a hostile process racing paths.
function directory(dir, create) {
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

function readFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > cap || stat.nlink !== 1) throw new Error('Record must be a bounded regular, non-hardlinked file');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

export class WorkStore {
  constructor(root) { this.root = path.resolve(root); }
  location(create = false) { return directory(path.join(this.root, 'tasks'), create); }
  file(id, create = false) {
    if (!idPattern.test(id)) throw new Error('Invalid task id');
    return path.join(this.location(create), id + '.md');
  }
  read(id) {
    const file = this.file(id), data = readFile(file), task = parse(data);
    if (task.id !== id) throw new Error('Filename and task id differ');
    return { task, revision: digest(data), file };
  }
  list() {
    let names;
    try { names = fs.readdirSync(this.location()); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return names.filter(name => name.endsWith('.md')).sort().map(name => this.read(name.slice(0, -3)));
  }
  locked(fn) {
    const dir = this.location(true), lock = path.join(dir, '.write-lock');
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Store locked; inspect owner/process before recovering a stale lock'); throw error; }
    try { return fn(); } finally { fs.rmdirSync(lock); }
  }
  create(input, owner) {
    const allowed = ['title', 'next_action', 'spent_when', 'notes'];
    if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unknown create field');
    return this.locked(() => {
      const now = new Date().toISOString();
      const task = { schema: 1, id: randomUUID(), title: input.title, status: 'pending', owner,
        next_action: input.next_action, spent_when: input.spent_when, blockers: [], evidence: [], created: now, updated: now, notes: input.notes ?? '' };
      const data = serialize(task), file = this.file(task.id), tmp = path.join(path.dirname(file), '.tmp-' + randomUUID());
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd);
        fs.linkSync(tmp, file); // Atomic publish, no replacement even on id collision.
      } catch (error) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        throw error;
      } finally { fs.unlinkSync(tmp); }
      return this.read(task.id);
    });
  }
  update(id, revision, patch, actor) {
    const allowed = ['title', 'status', 'owner', 'next_action', 'spent_when', 'blockers', 'evidence', 'notes'];
    if (!patch || Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Unknown update field');
    return this.locked(() => {
      const before = this.read(id);
      if (revision !== before.revision) throw new Error('Stale revision; reread and reconcile, do not blindly retry');
      if (before.task.status === 'in_progress' && before.task.owner !== actor) throw new Error('Active task owned by another session; request an explicit handoff');
      const task = { ...before.task, ...patch, updated: new Date().toISOString() };
      if (task.status === 'in_progress' && patch.owner === undefined) task.owner = actor;
      if (task.status === 'in_progress' && task.owner !== actor) throw new Error('Only claim active work for this session');
      const data = serialize(task), file = before.file, tmp = path.join(path.dirname(file), '.tmp-' + randomUUID());
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd);
        // Also detect edits made outside this tool while composing the write.
        if (digest(readFile(file)) !== revision) throw new Error('Record changed during update');
        fs.renameSync(tmp, file);
      } catch (error) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        try { fs.unlinkSync(tmp); } catch { /* preserve original failure */ }
        throw error;
      }
      return this.read(id);
    });
  }
}

export class ContextPack {
  constructor(root) {
    this.root = directory(root, false);
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
