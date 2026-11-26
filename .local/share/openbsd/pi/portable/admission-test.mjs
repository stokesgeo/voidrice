import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import admission from '../../npm-admission.cjs';
import {admittedProject} from './admission.mjs';
import {hash} from './integrity.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-admission-test-'));
let passed=0;
try {
 const source=root+'/source',attempt=root+'/attempt',project=attempt+'/project';for(const p of [source,attempt,project])fs.mkdirSync(p,{mode:0o700});
 const manifest='{"private":true}\n',lock='{"lockfileVersion":3}\n';
 for(const p of [source,project]){fs.writeFileSync(p+'/package.json',manifest,{mode:0o600});fs.writeFileSync(p+'/package-lock.json',lock,{mode:0o600});}
 const expected={manifest:'package.json',manifestSha256:hash(manifest),lock:'package-lock.json',lockSha256:hash(lock)};
 const files=[{path:'',type:'directory',mode:0o700},{path:'package-lock.json',type:'file',mode:0o600,sha256:hash(lock)},{path:'package.json',type:'file',mode:0o600,sha256:hash(manifest)}];
 const gates={};for(const kind of ['graph','signatures','scan']){const tree=kind==='graph'?null:hash(JSON.stringify(files)),record={status:'clean',kind,project,lockSha256:expected.lockSha256,manifestSha256:expected.manifestSha256,inventorySha256:tree,beforeInventorySha256:tree,afterInventorySha256:tree};const bytes=JSON.stringify(record)+'\n';fs.writeFileSync(attempt+'/'+kind+'.json',bytes,{mode:0o600});gates[kind]={sha256:hash(bytes),status:'clean',kind,project,lockSha256:expected.lockSha256,manifestSha256:expected.manifestSha256,inventorySha256:tree};}
 const original={schema:1,manifestSha256:expected.manifestSha256,lockSha256:expected.lockSha256,admissionSha256:admission.identity(),qualification:admission.qualification,files,inventorySha256:hash(JSON.stringify(files)),gates};
 function run(name,change,valid=false){const receipt=structuredClone(original);change(receipt);fs.writeFileSync(attempt+'/receipt.json',JSON.stringify(receipt),{mode:0o600});if(valid)admittedProject(project,expected,source);else assert.throws(()=>admittedProject(project,expected,source));passed++;console.log('PASS '+name);}
 run('receipt and clean scoped identity-bound gates accepted',()=>{},true);
 run('missing admission implementation refuses',r=>delete r.admissionSha256);
 run('wrong admission implementation refuses',r=>r.admissionSha256='0'.repeat(64));
 run('missing distribution qualification refuses',r=>delete r.qualification);
 run('wrong distribution qualification refuses',r=>r.qualification.npm='0.0.0');
 run('unbound clean gate refuses',r=>delete r.gates);
 run('swapped clean gate digest refuses',r=>r.gates.graph.sha256=r.gates.scan.sha256);
 run('wrong gate project scope refuses',r=>r.gates.scan.project=root);
 run('wrong gate lock scope refuses',r=>r.gates.signatures.lockSha256='0'.repeat(64));
 run('wrong gate kind refuses',r=>r.gates.graph.kind='scan');
 for(const [kind,status,valid] of [['graph','advisories',true],['graph','unknown',false],['graph','malicious',false],['graph','unexpected',false],['signatures','advisories',false],['scan','advisories',false]]) {
  const file=attempt+'/'+kind+'.json',before=fs.readFileSync(file),record=JSON.parse(before);record.status=status;const bytes=JSON.stringify(record)+'\n';fs.writeFileSync(file,bytes);
  run(kind+' '+status+(valid?' retained and accepted':' refuses'),r=>{r.gates[kind].status=status;r.gates[kind].sha256=hash(bytes);},valid);fs.writeFileSync(file,before);
 }
 console.log(passed+' admission checks PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
