import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function absolute(p) {
 assert(typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p&&(p==='/'||!p.endsWith('/'))&&!p.includes('\0'),'normalized absolute path required');
}
function trustedOwner(s,p) {
 assert(s.uid===process.getuid()||s.uid===0,'untrusted owner: '+p);
}
export function realDirectories(p) {
 absolute(p);
 for(let q=p;;q=path.dirname(q)) {
  const s=fs.lstatSync(q);assert(s.isDirectory(),'real directory: '+q);trustedOwner(s,q);
  assert((s.mode&0o022)===0||(q==='/tmp'&&s.uid===0&&(s.mode&0o1000)!==0),'writable directory ancestor: '+q);
  if(q==='/')break;
 }
}
function sourceSnapshot(p) {
 absolute(p);realDirectories(path.dirname(p));
 const s=fs.lstatSync(p);assert(s.isFile()&&s.nlink===1,'regular single-link source: '+p);
 trustedOwner(s,p);assert.equal(s.mode&0o022,0,'writable source: '+p);
 const bytes=fs.readFileSync(p);
 return {bytes,identity:{sha256:hash(bytes),mode:s.mode&0o777}};
}
export function sourceIdentity(p) {
 return sourceSnapshot(p).identity;
}
function memberName(p) {
 assert(typeof p==='string'&&p&&!p.includes('\0')&&!path.isAbsolute(p)&&path.normalize(p)===p&&
  p.split('/').every(n=>n&&n!=='.'&&n!=='..'),'member path: '+p);
 assert(!['auth.json','trust.json','models.json','models-store.json','settings.json'].includes(path.basename(p)),'private member: '+p);
}
export function instructionBindings(resourceRoot,dest,nativeProfileRoot,capture=sourceIdentity) {
 for(const p of [resourceRoot,dest,nativeProfileRoot])absolute(p);
 realDirectories(resourceRoot);
 const bind=rel=>{
  const source=path.join(resourceRoot,rel),packagedPath='agent/'+rel;
  return {source,...capture(source),packagedPath,output:{path:path.join(dest,packagedPath),...capture(source)}};
 };
 const native=bind('native-context.md');
 native.retainedPath=path.join(nativeProfileRoot,'AGENTS.md');
 const append=bind('AGENTS.md');
 assert.notEqual(native.sha256,append.sha256,'native stub must be distinct from full policy');
 const snapshot=sourceSnapshot(path.join(resourceRoot,'context/manifest.json'));
 const manifest=bind('context/manifest.json'),selected=JSON.parse(snapshot.bytes);
 for(const identity of [manifest,manifest.output]) {
  assert.equal(identity.sha256,snapshot.identity.sha256,'context manifest capture drift');
  assert.equal(identity.mode,snapshot.identity.mode,'context manifest mode drift');
 }
 assert(selected&&typeof selected==='object'&&!Array.isArray(selected)&&selected.schema===1,'context manifest schema');
 assert(Array.isArray(selected.files)&&selected.files.length,'explicit context selection');
 const seen=new Set();
 for(const f of selected.files) {
  assert(f&&typeof f==='object'&&!Array.isArray(f),'context member schema');
  memberName(f.path);
  assert(typeof f.sha256==='string'&&/^[a-f0-9]{64}$/.test(f.sha256),'context member digest: '+f.path);
  assert(!seen.has(f.path),'duplicate context selection: '+f.path);seen.add(f.path);
 }
 manifest.members=selected.files.map(f=>{
  const source=path.join(resourceRoot,f.path),identity=capture(source),packagedPath='agent/'+f.path;
  assert.equal(identity.sha256,f.sha256,'selected context stale: '+f.path);
  return {source,packagedPath,...identity,output:{path:path.join(dest,packagedPath),...identity}};
 });
 return {schema:1,native,append,manifest};
}
