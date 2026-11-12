// Refresh the manifest's explicit selection; never discover/admit new files.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] ?? path.join(os.homedir(), '.pi/agent'));
const { ContextPack, digest } = await import(pathToFileURL(path.join(root, 'work-store.mjs')));
const pack = new ContextPack(root);
const files = pack.files.map(file => ({ path: file.path, sha256: digest(pack.source(file.path).text) }));
const data = JSON.stringify({ ...pack.manifest, files }, null, 2) + '\n';
const target = path.join(root, 'context/manifest.json');
if (process.argv.includes('--check')) {
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
