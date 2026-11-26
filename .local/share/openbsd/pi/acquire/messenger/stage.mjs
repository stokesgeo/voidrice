#!/usr/bin/env node
// Offline staging only. Never loads a package or edits a Pi profile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function inventory(root) {
  const records = [];
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const file = path.posix.join(relative, name);
      const full = path.join(root, file);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(file);
      else {
        assert(st.isFile(), `non-regular source: ${file}`);
        records.push({ path: file, mode: st.mode & 0o777, sha256: sha256(fs.readFileSync(full)) });
      }
    }
  }
  walk();
  return records.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function stage(source, destination) {
  source = fs.realpathSync(source);
  destination = path.resolve(destination);
  assert(destination !== source && !destination.startsWith(source + path.sep), 'destination overlaps source');
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json')));
  const patch = fs.readFileSync(path.join(here, 'local.patch'));
  assert.equal(sha256(patch), manifest.patchSha256, 'patch hash');
  // Do not inherit GIT_DIR/WORK_TREE/INDEX_FILE/config injection. Prevent apply
  // from discovering an unrelated enclosing checkout when staging inside one.
  const git = (args, cwd = source) => execFileSync('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-C', cwd, ...args], {
    env: { PATH: process.env.PATH ?? '/bin:/usr/bin:/usr/local/bin', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), manifest.commit, 'source pin');
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']).toString(), '', 'source must be clean');
  assert.equal(git(['rev-parse', 'HEAD^{tree}']).toString().trim(), manifest.tree, 'source tree');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const lock = `${destination}.lock`;
  fs.mkdirSync(lock); // Never steal a lock, remove an old generation or overwrite a target.
  let temporary;
  try {
    let occupied = false;
    try { fs.lstatSync(destination); occupied = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    assert(!occupied, 'destination already exists');
    temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.messenger-stage-'));
    for (const record of manifest.pristine) {
      assert(!path.isAbsolute(record.path) && !record.path.split('/').includes('..'));
      const bytes = git(['show', `${manifest.commit}:${record.path}`]);
      assert.equal(sha256(bytes), record.sha256, record.path);
      const file = path.join(temporary, record.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, { flag: 'wx', mode: record.mode });
      fs.chmodSync(file, record.mode);
    }
    assert.deepEqual(inventory(temporary), manifest.pristine, 'pristine bytes/modes');
    git(['apply', '--check', '--whitespace=nowarn', path.join(here, 'local.patch')], temporary);
    git(['apply', '--whitespace=nowarn', path.join(here, 'local.patch')], temporary);
    for (const record of manifest.patched) fs.chmodSync(path.join(temporary, record.path), record.mode);
    assert.deepEqual(inventory(temporary), manifest.patched, 'patched bytes/modes');
    assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'package.json'))).version, manifest.version);
    fs.renameSync(temporary, destination);
    temporary = undefined;
    return { destination, commit: manifest.commit, patchSha256: manifest.patchSha256, files: manifest.patched.length };
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmdirSync(lock);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceFlag, source, destFlag, destination, extra] = process.argv.slice(2);
  assert(sourceFlag === '--source' && source && destFlag === '--dest' && destination && !extra,
    'usage: node stage.mjs --source CLEAN_PINNED_CHECKOUT --dest NEW_GENERATION_DIRECTORY');
  console.log(JSON.stringify(stage(source, destination), null, 2));
}
