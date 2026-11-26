import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function absolute(p) {
 assert(typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p&&!p.includes('\0')&&(p==='/'||!p.endsWith('/')),'normalized absolute path required');
 return p;
}
export function memberName(p) {
 assert(typeof p==='string'&&p&&!p.includes('\0')&&!path.isAbsolute(p)&&path.normalize(p)===p&&p.split('/').every(n=>n&&n!=='.'&&n!=='..'),'normalized member required');
 return p;
}
export function realDirectories(p) {
 absolute(p);
 for(let q=p;;q=path.dirname(q)) {
  const s=fs.lstatSync(q);
  assert(s.isDirectory()&&(s.uid===0||s.uid===process.getuid()),'trusted real directory required');
  assert(!(s.mode&0o022)||(q==='/tmp'&&s.uid===0&&(s.mode&0o1000)),'writable directory ancestor');
  if(q==='/')break;
 }
}
export function sourceIdentity(p) {
 absolute(p);realDirectories(path.dirname(p));const s=fs.lstatSync(p);
 assert(s.isFile()&&s.nlink===1&&(s.uid===0||s.uid===process.getuid())&&!(s.mode&0o022),'trusted single-link regular source required');
 return {sha256:hash(fs.readFileSync(p)),mode:s.mode&0o777};
}
// This ordering intentionally retains the locked pristine inventory convention.
export function inventory(root,rel='') {
 realDirectories(root);const out=[];
 for(const n of fs.readdirSync(root).sort()) {
  const r=rel?rel+'/'+n:n,p=root+'/'+n,s=fs.lstatSync(p);memberName(r);
  if(s.isDirectory())out.push(...inventory(p,r));
  else if(s.isSymbolicLink())out.push({path:r,link:fs.readlinkSync(p)});
  else out.push({path:r,...sourceIdentity(p)});
 }
 return out;
}
export function artifactClosure(root,members=inventory(root)) {
 realDirectories(root);
 for(const e of members) {
  memberName(e.path);const p=root+'/'+e.path;realDirectories(path.dirname(p));
  if(e.link!==undefined) {
   assert.equal(fs.readlinkSync(p),e.link);assert(!path.isAbsolute(e.link),'absolute artifact link');
   assert(path.resolve(path.dirname(p),e.link).startsWith(root+'/'),'escaping lexical link');
   assert(fs.realpathSync.native(p).startsWith(root+'/'),'escaping real link');
  } else assert.deepEqual(sourceIdentity(p),{sha256:e.sha256,mode:e.mode},'artifact drift');
 }
}
export function disjoint(a,b) {assert(a!==b&&!a.startsWith(b+'/')&&!b.startsWith(a+'/'),'overlapping roots');}
export function exists(p) {try {fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
