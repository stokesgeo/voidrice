// Source-only generated resource binding. Never run against an installed HOME.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(process.argv[2]);
assert(process.argv.length === 3 || process.argv.length === 4 && process.argv[3] === '--write', 'ROOT [--write]');
const manifest = path.join(root, '.pi/agent/resources.json');
const resources = JSON.parse(fs.readFileSync(manifest, 'utf8'));
for (const [from, to] of [
  ['work-store.mjs', 'work-store.mjs'],
  ['adapters/pi/shared-instructions.mjs', 'extensions/shared-instructions.mjs'],
]) {
  const source = path.join(root, '.local/share/vertrice-agents', from);
  const target = path.join(root, '.pi/agent', to);
  for (const file of [source, target, manifest]) {
    try {
      const stat = fs.lstatSync(file);
      assert(stat.isFile() && stat.nlink === 1, 'single regular source file required');
    } catch (error) {
      if (error.code !== 'ENOENT' || file !== target || process.argv[3] !== '--write') throw error;
    }
  }
  const bytes = fs.readFileSync(source);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const entries = resources.files.filter(entry => entry.path === to);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].mode, '0644');
  if (process.argv[3] === '--write') {
    fs.writeFileSync(target, bytes, { mode: 0o644 });
    entries[0].sha256 = digest;
  }
  assert.deepEqual(fs.readFileSync(target), bytes, 'regenerate Pi snapshot from shared source');
  assert.equal(entries[0].sha256, digest, 'refresh explicit Pi resource hash');
}
for (const entry of resources.files) {
  const file = path.join(root, '.pi/agent', entry.path);
  assert(!path.isAbsolute(entry.path) && !entry.path.split('/').includes('..'), 'safe resource member');
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.nlink === 1, 'single regular resource');
  assert.equal(stat.mode & 0o777, parseInt(entry.mode, 8), 'explicit resource mode');
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  // Work tools are maintained in their native extension, not duplicated.
  if (process.argv[3] === '--write' && ['extensions/work.ts', '.gitignore'].includes(entry.path)) entry.sha256 = digest;
  assert.equal(entry.sha256, digest, 'resource SHA256 drift: ' + entry.path);
}
if (process.argv[3] === '--write') fs.writeFileSync(manifest, JSON.stringify(resources, null, 2) + '\n');
console.log('PASS generated Pi shared engine/owner-context extension snapshots and resource SHA256');
