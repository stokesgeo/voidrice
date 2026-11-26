import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {assembleComplete} from '../complete.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-home-layout-'));
try {
 const home=root+'/home',parent=home+'/.local/share/vertrice-pi/generations',dest=parent+'/candidate',evidence=root+'/evidence',pristineRoot=root+'/pristine';
 fs.mkdirSync(parent,{recursive:true,mode:0o700});fs.mkdirSync(evidence,{mode:0o700});fs.mkdirSync(pristineRoot,{mode:0o700});
 const options={home,pristineRoot,boardRoot:root+'/board',messengerRoot:root+'/messenger',resourceRoot:root+'/resources',toolRoot:root+'/tool'};
 await assert.rejects(assembleComplete(dest,evidence,options),/reviewed portable input identity missing: acquisition receipt/);
 assert(!fs.existsSync(dest));assert.deepEqual(fs.readdirSync(evidence),[]);assert.deepEqual(fs.readdirSync(parent),[]);
 console.log('PASS production preflight permits generation beneath HOME and reaches admission before writes');
 await assert.rejects(assembleComplete(evidence+'/candidate',evidence,options),/overlapping roots/);
 console.log('PASS destination overlapping evidence still refuses');
 for(const key of ['pristineRoot','boardRoot','messengerRoot','resourceRoot','toolRoot']) {
  await assert.rejects(assembleComplete(dest,evidence,{...options,[key]:parent}),/overlapping roots/);
  assert(!fs.existsSync(dest));console.log('PASS destination overlapping '+key+' still refuses');
 }
 console.log('7 HOME layout checks PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
