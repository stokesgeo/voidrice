// Refresh the manifest's explicit selection; never discover/admit new files.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, check, ...extra] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || path.normalize(root) !== root ||
    (check !== undefined && check !== '--check') || extra.length)
  throw new Error('usage: context-index.mjs /absolute/agent-root [--check]');
const { ContextPack, digest } = await import(pathToFileURL(path.join(root, 'work-store.mjs')));
const pack = new ContextPack(root);
const files = pack.files.map(file => ({ path: file.path, sha256: digest(pack.source(file.path).text) }));
const data = JSON.stringify({ ...pack.manifest, files }, null, 2) + '\n';
const target = path.join(root, 'context/manifest.json');
if (check === '--check') {
  if (fs.readFileSync(target, 'utf8') !== data) throw new Error('Context manifest stale');
  console.log(`PASS ${files.length} explicit context files and source hashes`);
} else {
  const tmp = target + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, data, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, target);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  console.log(`Indexed ${files.length} explicit context files; no external data read`);
}
