import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {assertHostResolution} from './qualify-board.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-host-resolution-'));
try {
 const source=root+'/board/source',name='@earendil-works/pi-tui';fs.mkdirSync(source,{recursive:true,mode:0o700});
 function packageAt(base,version){const p=base+'/node_modules/'+name;fs.mkdirSync(p,{recursive:true,mode:0o700});fs.writeFileSync(p+'/package.json',JSON.stringify({name,version,main:'index.js'}));fs.writeFileSync(p+'/index.js','throw Error("resolution tests must never execute package code");\n');}
 packageAt(root,'1.6.0');assert.equal(assertHostResolution(root,source,[name])[name],root+'/node_modules/'+name+'/index.js');console.log('PASS external resolves to qualified root without executing package');
 const shadowSource=root+'/board-shadow/source';fs.mkdirSync(shadowSource,{recursive:true,mode:0o700});packageAt(shadowSource,'0.79.8');assert.throws(()=>assertHostResolution(root,shadowSource,[name]),/shadows qualified host/);console.log('PASS local development SDK shadow refuses before imports');
 console.log('2 host resolution checks PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
