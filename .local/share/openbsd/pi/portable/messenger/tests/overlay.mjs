import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applyOverlay} from '../apply-overlay.mjs';
const input=process.argv[2];
if(!input || !path.isAbsolute(input))throw Error('usage: node overlay.mjs ABSOLUTE_STAGE111_SOURCE');
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url)));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'messenger-overlay-'));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
try {
 for(const e of manifest.base.files) {
  const from=path.join(input,e.path),to=path.join(root,e.path),s=fs.lstatSync(from);
  assert(s.isFile()&&s.nlink===1,'regular single-link base source required');
  assert.equal(hash(from),e.sha256,'pinned stage111 hash mismatch: '+e.path);
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
 }
 fs.writeFileSync(root+'/extra','extra');assert.throws(()=>applyOverlay(root),/unexpected/);fs.unlinkSync(root+'/extra');
 for(const e of manifest.base.files)assert.equal(hash(path.join(root,e.path)),e.sha256);
 fs.symlinkSync('index.ts',root+'/link');assert.throws(()=>applyOverlay(root),/unexpected|single-link/);fs.unlinkSync(root+'/link');
 fs.linkSync(root+'/index.ts',root+'/hardlink');assert.throws(()=>applyOverlay(root),/unexpected|single-link/);fs.unlinkSync(root+'/hardlink');
 fs.mkdirSync(root+'/extra-directory');assert.throws(()=>applyOverlay(root),/unexpected/);fs.rmdirSync(root+'/extra-directory');
 assert.equal(applyOverlay(root).files.length,41);
 for(const e of manifest.files)assert.equal(hash(path.join(root,e.path)),e.sha256);
 let count=0;const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory())walk(path.join(d,e.name));else count++;}};walk(root);assert.equal(count,119);
 assert.throws(()=>applyOverlay(root));
 console.log('PASS pinned base hashes, prewrite extra/link/directory rejection, exact 119-file output, repeat rejection');
} finally {fs.rmSync(root,{recursive:true,force:true});}
