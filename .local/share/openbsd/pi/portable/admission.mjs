import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash,sourceIdentity,inventory,artifactClosure,realDirectories} from './integrity.mjs';
import admission from '../../npm-admission.cjs';
export function typedInventory(root) {
 const out=[];
 function visit(rel) {
  const p=path.join(root,rel),s=fs.lstatSync(p),mode=s.mode&0o777;
  if(s.isDirectory()){out.push({path:rel,type:'directory',mode});for(const n of fs.readdirSync(p).sort())visit(path.posix.join(rel,n));}
  else if(s.isFile()){sourceIdentity(p);out.push({path:rel,type:'file',mode,sha256:hash(fs.readFileSync(p))});}
  else {assert(s.isSymbolicLink(),'special acquisition member');assert(fs.realpathSync.native(p).startsWith(root+'/'),'escaping acquisition link');out.push({path:rel,type:'link',mode,target:fs.readlinkSync(p)});}
 }
 visit('');return out;
}
export function admittedProject(root,expectation,here) {
 assert(expectation?.manifest&&expectation?.lock&&expectation?.manifestSha256&&expectation?.lockSha256,'source-owned acquisition contract required');
 for(const [rel,digest] of [[expectation.manifest,expectation.manifestSha256],[expectation.lock,expectation.lockSha256]])assert.equal(sourceIdentity(path.resolve(here,rel)).sha256,digest,'acquisition source lock drift');
 realDirectories(root);const attempt=path.dirname(root),receiptFile=attempt+'/receipt.json';assert(fs.existsSync(receiptFile),'reviewed portable input identity missing: acquisition receipt');sourceIdentity(receiptFile);const receipt=JSON.parse(fs.readFileSync(receiptFile));
 assert.equal(receipt.schema,1);assert.equal(receipt.manifestSha256,expectation.manifestSha256);assert.equal(receipt.lockSha256,expectation.lockSha256);
 assert.equal(receipt.admissionSha256,admission.identity(),'unreviewed npm admission implementation');assert.deepEqual(receipt.qualification,admission.qualification,'unreviewed npm distribution qualification');
 assert.equal(sourceIdentity(root+'/package.json').sha256,expectation.manifestSha256);assert.equal(sourceIdentity(root+'/package-lock.json').sha256,expectation.lockSha256);
 assert(receipt.gates&&typeof receipt.gates==='object','receipt-bound acquisition gates required');
 const gates={};for(const gate of ['graph','signatures','scan']){
  const p=attempt+'/'+gate+'.json',identity=sourceIdentity(p),binding=receipt.gates[gate];
  assert(binding&&binding.sha256===identity.sha256,'acquisition gate receipt identity: '+gate);
  assert.equal(binding.kind,gate,'acquisition gate kind');assert.equal(binding.project,root,'acquisition gate scope');assert.equal(binding.lockSha256,expectation.lockSha256,'acquisition gate lock scope');
  const record=JSON.parse(fs.readFileSync(p));assert((gate==='graph'?['clean','advisories']:['clean']).includes(binding.status),'acquisition gate status refused');assert.equal(binding.manifestSha256,expectation.manifestSha256,'gate manifest scope');
  for(const [key,value] of Object.entries({kind:gate,project:root,manifestSha256:expectation.manifestSha256,lockSha256:expectation.lockSha256,status:binding.status}))assert.equal(record[key],value,'gate record scope: '+key);
  if(gate==='graph') {assert.equal(binding.inventorySha256,null);assert.equal(record.inventorySha256,null);assert.equal(record.beforeInventorySha256,null);assert.equal(record.afterInventorySha256,null);}
  else for(const value of [binding.inventorySha256,record.inventorySha256,record.beforeInventorySha256,record.afterInventorySha256])assert.equal(value,receipt.inventorySha256,'gate installed tree scope');
  gates[gate]=identity;
 }
 const files=typedInventory(root);assert.equal(hash(JSON.stringify(files)),receipt.inventorySha256,'acquisition inventory digest');assert.deepEqual(files,receipt.files,'acquisition inventory drift');
 const members=inventory(root);artifactClosure(root,members);return {members,provenance:{receipt:sourceIdentity(receiptFile),gates,manifestSha256:expectation.manifestSha256,lockSha256:expectation.lockSha256,inventorySha256:receipt.inventorySha256,admissionSha256:receipt.admissionSha256,qualification:receipt.qualification}};
}
