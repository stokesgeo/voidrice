import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkStore, directory, readFile } from './work-store.mjs';

const lanes = ['tasks', 'plans', 'decisions', 'handoffs', 'reports', 'memory', 'skills', 'sessions', 'archive'];
const documents = ['AGENTS.md', 'README.md', 'USER.md', 'vision.md'];
const seeded = ['.gitignore', ...documents, ...lanes.map(lane => `${lane}/README.md`)];
const usage = `vertrice-agents [--root PATH] init|check|find WORDS
vertrice-agents [--root PATH] task list [--full]
vertrice-agents [--root PATH] task read ID
vertrice-agents [--root PATH] task create ACTOR JSON
vertrice-agents [--root PATH] task update ID REVISION ACTOR JSON

ACTOR is this session's id (required to match VERTRICE_SESSION_ID when set).
JSON is an object argument, not code.
  create: title, next_action, spent_when (all required); notes, kind (optional)
  update: any of title, status, owner, next_action, spent_when, blockers,
          evidence, notes, kind; REVISION is the one task read returned
  kind:   maybe (default) | incubate | todo; older records without one show legacy
  status: pending | in_progress | blocked | parked | completed
  rules:  unfinished work needs next_action; in_progress needs an owner and is
          claimed by this session; blocked needs blockers; completed needs
          evidence and no blockers
Claims lock only while the session in VERTRICE_SESSION_PID is alive; list
shows each as live, lapsed or unchecked. List and check show task pointers;
read ID or list --full for full records. No memory writer.
Node required for help, init, check and tasks; find uses base tools only.
Find: literal lexical search of selected root docs and authored-lane Markdown.
Excludes hidden/private/runtime/sessions/archive subtrees, symlinks and hardlinks.
Selected discovery only, not a complete corpus search or confidentiality boundary.`;
const output = value => console.log(JSON.stringify(value, null, 2));
const object = value => {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected JSON object');
  return parsed;
};
// When the harness names its session (VERTRICE_SESSION_ID), the actor is that
// session: a different name typed by an agent is refused.
const actor = name => {
  const session = process.env.VERTRICE_SESSION_ID;
  if (session && name !== session) throw new Error(`ACTOR must be this session's id (${session}), not ${JSON.stringify(name)}`);
  return name;
};
const show = row => row.error !== undefined ? row : ({ ...row, kind: row.task.kind ?? 'legacy' });
const taskRows = (store, full = false) => {
  const rows = store.list().map(show);
  // Keep upstream's valid rows and record diagnostics; never claim a clean list.
  if (rows.some(row => row.error !== undefined)) process.exitCode = 1;
  if (full) return rows;
  return rows.map(row => {
    if (row.error !== undefined) return row;
    const { id, title, status, owner, next_action, blockers } = row.task;
    return { file: row.file, kind: row.kind, ...(row.claim ? { claim: row.claim } : {}),
      task: { id, title, status, owner, next_action, blockers } };
  });
};

function init(root) {
  // Preflight sources before creating the root, destinations before seeding.
  // A failed init may leave missing directories created, never replaced files.
  // No chmod of owner files, config rewrite or migration.
  const templates = directory(path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates'), false);
  const sources = seeded.map(name => {
    const source = path.join(templates, name === '.gitignore' ? 'private.gitignore' : name);
    directory(path.dirname(source), false);
    return [name, readFile(source)];
  });
  const inspect = target => {
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${target}`);
      return stat;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  // directory() refuses symlink ancestors even when a suffix is absent.
  directory(root, true);
  for (const name of lanes) {
    const stat = inspect(path.join(root, name));
    if (stat && !stat.isDirectory()) throw new Error(`Not a directory: ${name}`);
  }
  for (const name of seeded) {
    const stat = inspect(path.join(root, name));
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error(`Not a single regular file: ${name}`);
  }
  for (const name of lanes) directory(path.join(root, name), true);
  const created = [];
  for (const [name, data] of sources) {
    const file = path.join(root, name);
    try { fs.writeFileSync(file, data, { flag: 'wx', mode: 0o600 }); created.push(name); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = inspect(file);
      if (!stat?.isFile() || stat.nlink !== 1) throw new Error(`Unsafe existing file: ${name}`);
    }
  }
  return { root, created, preserved_existing: true };
}

// Check only local Markdown source links in authored lanes. Remote links and
// links outside this root are reported, never fetched/read. No semantic proof.
// Every problem is reported with the rest; only an unusable root stops it.
function check(root, store) {
  directory(root, false);
  const files = [], skipped = [], problems = [], safeLanes = new Set();
  const problem = (file, status, error) => {
    problems.push({ file, status, ...(error ? { error: error.code ?? String(error.message).slice(0, 120) } : {}) });
    process.exitCode = 1;
  };
  // Required seed, not Markdown or a privacy certification.
  try { readFile(path.join(root, '.gitignore')); } catch (error) { problem(path.join(root, '.gitignore'), 'MISSING or unsafe required file', error); }
  for (const lane of lanes) {
    try { directory(path.join(root, lane), false); safeLanes.add(lane); } catch (error) { problem(path.join(root, lane), 'MISSING or unsafe lane', error); }
  }
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) { if (!problems.some(p => p.file === dir)) problem(dir, 'UNREADABLE directory', error); return; }
    for (const item of entries) {
      if (item.name.startsWith('.') || ['private', 'runtime', 'sessions', 'archive'].includes(item.name)) continue;
      const file = path.join(dir, item.name);
      // Never followed. Linking a skill in from a repository is ordinary
      // native practice, so under skills/ it is reported, not an error.
      // Elsewhere it is still refused, but reported with everything else.
      if (item.isSymbolicLink()) {
        const skill = path.relative(root, file).split(path.sep)[0] === 'skills';
        skipped.push({ file, status: skill ? 'symlink not followed' : 'REFUSED symlink' });
        if (!skill) process.exitCode = 1;
        continue;
      }
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && item.name.endsWith('.md')) files.push(file);
    }
  }
  // USER.md and vision.md are optional owner files; the others are seeds.
  for (const name of documents) {
    const file = path.join(root, name);
    try { fs.lstatSync(file); } catch (error) {
      if (error.code === 'ENOENT' && ['USER.md', 'vision.md'].includes(name)) { skipped.push({ file, status: 'optional file absent' }); continue; }
    }
    files.push(file);
  }
  // A lane that is a symlink (or missing) was reported above and is never entered.
  for (const lane of lanes.filter(name => safeLanes.has(name) && !['sessions', 'archive'].includes(name))) walk(path.join(root, lane));
  // Where a link lands, without reading it: a file or directory is fine at
  // any size; a symlink on the way is not followed.
  const landing = resolved => {
    let current = root;
    for (const part of path.relative(root, resolved).split(path.sep)) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return 'symlink not followed';
      if (current === resolved) return stat.isDirectory() ? 'local directory exists' : stat.isFile() ? 'local regular file exists; content not proved' : null;
    }
    return null;
  };
  const links = [];
  for (const file of files) {
    let data;
    try { data = readFile(file); } catch (error) { problem(file, 'UNREADABLE (missing, symlink, hard link or over 128 KiB)', error); continue; }
    // [text](target), [text](<target>), [text](target "title"); a target that
    // itself contains parentheses is not recognised.
    for (const match of data.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g)) {
      const target = match[1] ?? match[2];
      if (target.startsWith('#')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) { links.push({ file, target, status: 'unchecked URI' }); continue; }
      let decoded;
      try { decoded = decodeURIComponent(target.split('#')[0]); }
      catch { links.push({ file, target, status: 'BROKEN', error: 'malformed % escape' }); process.exitCode = 1; continue; }
      const resolved = path.resolve(path.dirname(file), decoded);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) { links.push({ file, target, status: 'unchecked outside root' }); continue; }
      const parts = path.relative(root, resolved).split(path.sep);
      if (parts.some(part => part.startsWith('.') || ['private', 'runtime', 'sessions', 'archive'].includes(part))) {
        links.push({ file, target, status: 'unchecked excluded data lane' }); continue;
      }
      let status;
      try { status = resolved === root ? 'local directory exists' : landing(resolved); } catch (error) { status = null; }
      if (status) links.push({ file, target, status });
      else { links.push({ file, target, status: 'BROKEN', error: 'no such file or directory' }); process.exitCode = 1; }
    }
  }
  let tasks = [];
  try { tasks = taskRows(store); } catch (error) { problem(path.join(root, 'tasks'), 'UNREADABLE task store', error); }
  return { root, tasks, authored_files: files.length, problems, links, skipped,
    ceiling: 'Structural validation only. Simple inline Markdown links only; no factual, completion-evidence or semantic proof. Sessions/archive not inspected.' };
}

try {
  const args = process.argv.slice(2);
  if (args.shift() !== '--root') throw new Error(usage);
  const supplied = args.shift();
  if (!supplied || supplied.split(path.sep).some(part => part === '..' || part === '.')) throw new Error('Unsafe root');
  const root = path.resolve(supplied), command = args.shift(), store = new WorkStore(root);
  if (['--help', '-h', 'help'].includes(command) && !args.length) console.log(usage);
  else if (command === 'init' && !args.length) output(init(root));
  else if (command === 'check' && !args.length) output(check(root, store));
  else if (command === 'task') {
    const action = args.shift();
    if (['--help', '-h', 'help'].includes(action) && !args.length) console.log(usage);
    else if (action === 'list' && (!args.length || (args.length === 1 && args[0] === '--full'))) {
      output(taskRows(store, args[0] === '--full'));
    }
    else if (action === 'read' && args.length === 1) output(show(store.read(args[0])));
    else if (action === 'create' && args.length === 2 && args[0].trim()) output(show(store.create(object(args[1]), actor(args[0]))));
    else if (action === 'update' && args.length === 4 && args[2].trim()) output(show(store.update(args[0], args[1], object(args[3]), actor(args[2]))));
    else throw new Error(usage);
  } else throw new Error(usage);
} catch (error) {
  console.error(`vertrice-agents: ${error.message}`);
  process.exitCode = 1;
}
