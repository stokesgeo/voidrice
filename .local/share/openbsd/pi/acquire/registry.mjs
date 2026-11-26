import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import admission from '../../npm-admission.cjs';
import security from '../../security-checks.cjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const npm = '/usr/local/bin/npm';
export const node = '/usr/local/bin/node';
export const fields = ['name', 'version', 'private', 'description', 'dependencies', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies', 'engines'];
export function projectManifest(bytes) {
  const original = JSON.parse(bytes);
  for (const key of ['workspaces', 'overrides', 'resolutions', 'bundleDependencies', 'bundledDependencies', 'config', 'hasShrinkwrap', '_hasShrinkwrap', 'link', 'inBundle']) if (Object.hasOwn(original, key)) throw Error('unsupported projection control: ' + key);
  if (Object.hasOwn(original, 'publishConfig') && JSON.stringify(original.publishConfig) !== '{"access":"public"}') throw Error('unsupported projection control: publishConfig');
  return Buffer.from(JSON.stringify(Object.fromEntries(fields.filter(key => Object.hasOwn(original, key)).map(key => [key, original[key]])), null, 2) + '\n');
}
export function trusted(file, directory = false, systemTool = false) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file) throw Error('absolute normalized trusted path required');
  for (let current = file;; current = path.dirname(current)) {
    const st = fs.lstatSync(current), leaf = current === file;
    if (st.isSymbolicLink() || ![0, process.getuid()].includes(st.uid)) throw Error('untrusted path owner or link');
    const stickyRoot = st.isDirectory() && st.uid === 0 && Boolean(st.mode & 0o1000);
    if ((st.mode & 0o022) && !stickyRoot) throw Error('writable trusted path');
    if (leaf && !directory && (!st.isFile() || (st.nlink !== 1 && !(systemTool && st.uid === 0)))) throw Error('trusted source must be single-link regular file');
    if ((!leaf || directory) && !st.isDirectory()) throw Error('trusted ancestor must be directory');
    if (current === path.dirname(current)) break;
  }
}
export function verified(file, expected) {
  trusted(file);
  const bytes = fs.readFileSync(file);
  if (!/^[a-f0-9]{64}$/.test(expected) || sha256(bytes) !== expected) throw Error('source hash mismatch: ' + file);
  return bytes;
}
export function createAttempt(destination) {
  process.umask(0o077);
  if (!path.isAbsolute(destination) || path.resolve(destination) !== destination) throw Error('absolute normalized destination required');
  trusted(path.dirname(destination), true);
  const parent = fs.lstatSync(path.dirname(destination));
  if (!parent.isDirectory()) throw Error('destination parent must be a directory');
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const name of ['project', 'home', 'logs', 'cache', 'tmp']) fs.mkdirSync(path.join(destination, name), { mode: 0o700 });
  fs.writeFileSync(path.join(destination, 'empty-config'), '', { flag: 'wx', mode: 0o600 });
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: path.join(destination, 'home'), TMPDIR: path.join(destination, 'tmp'), CI: '1', LANG: 'C', LC_ALL: 'C', NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: path.join(destination, 'empty-config'), NPM_CONFIG_CACHE: path.join(destination, 'cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
  return { destination, project: path.join(destination, 'project'), env };
}
export function run(attempt, label, command, args, options = {}) {
  const fd = fs.openSync(path.join(attempt.destination, 'logs', label + '.log'), 'wx', 0o600);
  try {
    const result = spawnSync(command, args, { cwd: attempt.project, env: attempt.env, timeout: 1800000, killSignal: 'SIGKILL', stdio: ['ignore', fd, fd], ...options });
    if (result.error || result.status !== 0) throw Error(label + ' failed; see acquisition log');
  } finally { fs.closeSync(fd); }
}
function record(attempt, label, result) {
  fs.writeFileSync(path.join(attempt.destination, label + '.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (!(result.status === 'clean' || (label === 'graph' && result.status === 'advisories'))) throw Error(label + ' gate refused: ' + result.status);
}
function admitted(attempt, phase, input = '') {
  const snapshot = path.join(attempt.destination, 'npm-admission.cjs');
  if (!fs.existsSync(snapshot)) admission.snapshot(attempt.destination);
  run(attempt, phase, node, [snapshot, npm, phase, attempt.project, input]);
}
export function inventory(root) {
  const result = [];
  function walk(relative) {
    const full = path.join(root, relative), st = fs.lstatSync(full), mode = st.mode & 0o777;
    if (![0, process.getuid()].includes(st.uid) || (!st.isSymbolicLink() && (st.mode & 0o022)) || (st.isFile() && st.nlink !== 1)) throw Error('untrusted inventory entry');
    if (st.isDirectory()) {
      result.push({ path: relative, type: 'directory', mode });
      for (const name of fs.readdirSync(full).sort()) walk(path.posix.join(relative, name));
    } else if (st.isFile()) result.push({ path: relative, type: 'file', mode, sha256: sha256(fs.readFileSync(full)) });
    else if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(full), real = fs.realpathSync.native(full);
      if (!real.startsWith(root + path.sep)) throw Error('inventory link leaves project');
      result.push({ path: relative, type: 'link', mode, target });
    } else throw Error('special acquisition file');
  }
  walk('');
  return result;
}
export async function acquireRegistryProject({ destination, manifest, manifestSha256, lock, lockSha256, resolve = false, scanSeconds = 1800 }) {
  if (!Number.isSafeInteger(scanSeconds) || scanSeconds < 1 || scanSeconds > 3600) throw Error('invalid scan duration bound');
  const manifestBytes = verified(manifest, manifestSha256);
  const lockBytes = resolve ? undefined : verified(lock, lockSha256);
  const attempt = createAttempt(destination);
  fs.writeFileSync(path.join(attempt.project, 'package.json'), manifestBytes, { flag: 'wx', mode: 0o600 });
  if (resolve) admitted(attempt, 'resolution');
  else fs.writeFileSync(path.join(attempt.project, 'package-lock.json'), lockBytes, { flag: 'wx', mode: 0o600 });
  const retainedLock = path.join(attempt.project, 'package-lock.json');
  const expectedLock = sha256(fs.readFileSync(retainedLock));
  const checkInputs = () => {
    if (sha256(fs.readFileSync(retainedLock)) !== expectedLock || sha256(fs.readFileSync(path.join(attempt.project, 'package.json'))) !== manifestSha256) throw Error('acquisition input changed');
  };
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = attempt.env.TMPDIR;
  const gates = {};
  const gate = async (label, operation, tree = false) => {
    checkInputs();
    const before = tree ? sha256(JSON.stringify(inventory(attempt.project))) : null;
    if (tree && gates.signatures && gates.signatures.inventorySha256 !== before) throw Error('installed tree changed between gates');
    const started = new Date().toISOString();
    const result = await operation();
    checkInputs();
    const after = tree ? sha256(JSON.stringify(inventory(attempt.project))) : null;
    if (before !== after) throw Error(label + ' input tree changed');
    const evidence = { ...result, kind: label, project: attempt.project, manifestSha256, lockSha256: expectedLock, inventorySha256: before, beforeInventorySha256: before, afterInventorySha256: after, started, finished: new Date().toISOString() };
    record(attempt, label, evidence);
    gates[label] = { status: result.status, kind: label, project: attempt.project, lockSha256: expectedLock, manifestSha256, sha256: sha256(fs.readFileSync(path.join(attempt.destination, label + '.json'))), inventorySha256: before };
  };
  try {
    await gate('graph', () => security.graph(attempt.project, npm, attempt.env));
    admitted(attempt, 'ci', expectedLock);
    checkInputs();
    await gate('signatures', () => security.signatures(attempt.project, npm, attempt.env), true);
    await gate('scan', () => security.scan([attempt.project], { seconds: scanSeconds, run: (command, args, options) => spawnSync(command, args, { ...options, encoding: 'utf8', env: attempt.env, cwd: attempt.destination }) }), true);
  } finally { if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp; }
  checkInputs();
  const files = inventory(attempt.project);
  const inventorySha256 = sha256(JSON.stringify(files));
  if (gates.signatures.inventorySha256 !== inventorySha256 || gates.scan.inventorySha256 !== inventorySha256) throw Error('final installed tree changed after gates');
  const receipt = { schema: 1, manifestSha256, lockSha256: expectedLock, admissionSha256: admission.identity(), qualification: admission.qualification, gates, inventorySha256, files };
  fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { ...attempt, receipt };
}
