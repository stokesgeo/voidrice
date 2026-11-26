import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const digest = data => createHash('sha256').update(data).digest('hex');
const relative = p => typeof p === 'string' && p.length > 0 && !path.isAbsolute(p) && path.normalize(p) === p && p !== '..' && !p.startsWith('../');
function readRegular(filename) {
 const s = fs.lstatSync(filename);
 if (!s.isFile() || s.nlink !== 1) throw Error('regular single-link source required: ' + filename);
 return fs.readFileSync(filename);
}
function verifyTree(root, entries) {
 const expected = new Map(entries.map(e => [e.path,e.sha256]));
 const directories = new Set();
 for (const e of entries) { let d = path.dirname(e.path); while (d !== '.') { directories.add(d); d = path.dirname(d); } }
 const seen = new Set();
 const walk = dir => {
  for (const name of fs.readdirSync(path.join(root,dir))) {
   const rel = dir ? dir + '/' + name : name;
   const file = path.join(root,rel), stat = fs.lstatSync(file);
   if (stat.isDirectory() && !stat.isSymbolicLink()) {
    if (!directories.has(rel)) throw Error('unexpected source directory: ' + rel);
    walk(rel);
   } else {
    if (!expected.has(rel) || digest(readRegular(file)) !== expected.get(rel)) throw Error('unexpected or changed source: ' + rel);
    seen.add(rel);
   }
  }
 };
 walk('');
 if (seen.size !== expected.size) throw Error('incomplete source tree');
}
export function applyOverlay(messengerRoot) {
 if (!path.isAbsolute(messengerRoot) || path.normalize(messengerRoot) !== messengerRoot) throw Error('absolute normalized Messenger root required');
 const manifest = JSON.parse(readRegular(path.join(root,'manifest.json')));
 if (manifest.schema !== 1 || manifest.base.files.length !== 111 || manifest.files.length !== 41) throw Error('Messenger overlay schema');
 const directory = fs.lstatSync(messengerRoot);
 if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('Messenger directory required');
 verifyTree(messengerRoot,manifest.base.files);
 for (const entry of manifest.base.files) {
  if (!relative(entry.path)) throw Error('unsafe base path');
  if (digest(readRegular(path.join(messengerRoot,entry.path))) !== entry.sha256) throw Error('stage111 base mismatch: ' + entry.path);
 }
 const pending = manifest.files.map(entry => {
  if (!relative(entry.path) || !relative(entry.source)) throw Error('unsafe overlay path');
  const base = manifest.base.files.find(x => x.path === entry.path);
  if ((base?.sha256 ?? null) !== entry.baseSha256) throw Error('overlay base identity mismatch');
  const dest = path.join(messengerRoot,entry.path);
  if (!base && fs.existsSync(dest)) throw Error('unexpected added destination: ' + entry.path);
  const data = readRegular(path.join(root,entry.source));
  if (digest(data) !== entry.sha256) throw Error('overlay hash mismatch: ' + entry.path);
  let parent = path.dirname(dest);
  while (parent !== messengerRoot) {
   if (fs.existsSync(parent) && !fs.lstatSync(parent).isDirectory()) throw Error('unsafe output parent');
   if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw Error('symlink output parent');
   parent = path.dirname(parent);
  }
  return {entry,dest,data};
 });
 for (const {entry,dest,data} of pending) {
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,data,{mode:0o644});
  if (digest(readRegular(dest)) !== entry.sha256) throw Error('overlay output mismatch');
 }
 const final = new Map(manifest.base.files.map(e => [e.path,e]));
 for (const e of manifest.files) final.set(e.path,e);
 verifyTree(messengerRoot,[...final.values()]);
 return {schema:1,baseCommit:manifest.base.commit,files:manifest.files.map(({path,sha256}) => ({path,sha256}))};
}
