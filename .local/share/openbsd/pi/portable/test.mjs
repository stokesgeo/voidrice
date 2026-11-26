import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {assemble,reconstructNative} from './assemble.mjs';
import {hash,inventory,artifactClosure,sourceIdentity} from './integrity.mjs';
import {prepareRuntime} from './patch-runtime.mjs';
import {shellQuote,resourceMode} from './complete.mjs';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-portable-test-'));let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const put=(p,b,mode=0o600)=>{fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b,{mode});fs.chmodSync(p,mode);};
try {
 const pristine=root+'/pristine',resources=root+'/resources',evidence=root+'/evidence';
 for(const p of [pristine,resources,evidence])fs.mkdirSync(p,{mode:0o700});
 put(pristine+'/a.js','before\n');
 await test('shell path quoting preserves metacharacters without expansion',()=>{
  const value="/literal/'quote/$(false)/`false`/$HOME";
  assert.equal(execFileSync('/bin/sh',['-c','printf %s '+shellQuote(value)],{encoding:'utf8'}),value);
 });
 await test('resource modes reject partial octal and unsafe writable values',()=>{
  assert.equal(resourceMode('0644'),0o644);for(const mode of ['0644junk','666','0666',0o777])assert.throws(()=>resourceMode(mode));
 });
 await test('pure runtime preparation verifies identity and exact replacement',()=>{
  const spec=[{path:'a.js',input:hash('before\n'),replacements:[['before','after']],output:hash('after\n')}];
  const d=prepareRuntime(pristine,{costModules:{}},spec,root+'/home/.pi/agent/auth.json',here);
  assert.equal(d[0].bytes.toString(),'after\n');assert.equal(fs.readFileSync(pristine+'/a.js','utf8'),'before\n');
 });
 await test('runtime drift refuses before writes',()=>assert.throws(()=>prepareRuntime(pristine,{costModules:{}},[{path:'a.js',input:'0'.repeat(64),replacements:[]}],'/no-read',here),/pristine runtime drift/));
 await test('escaping and chained artifact links refuse',()=>{
  fs.symlinkSync('../resources',pristine+'/bad');assert.throws(()=>artifactClosure(pristine));fs.unlinkSync(pristine+'/bad');
  fs.symlinkSync('a.js',pristine+'/ok');artifactClosure(pristine);fs.unlinkSync(pristine+'/ok');
 });
 await test('single-link and permissions source checks',()=>{
  fs.linkSync(pristine+'/a.js',pristine+'/hard');assert.throws(()=>sourceIdentity(pristine+'/hard'));fs.unlinkSync(pristine+'/hard');
  fs.chmodSync(pristine+'/a.js',0o666);assert.throws(()=>sourceIdentity(pristine+'/a.js'));fs.chmodSync(pristine+'/a.js',0o600);
 });
 await test('complete assembler precise missing closure before destination write',async()=>{
  await assert.rejects(assemble(root+'/full',evidence,{pristineRoot:pristine,resourceRoot:resources,boardRoot:root+'/board',messengerRoot:root+'/messenger',toolRoot:root+'/tool',home:root+'/home'}),/reviewed portable input identity missing/);
  assert(!fs.existsSync(root+'/full'));assert.deepEqual(fs.readdirSync(evidence),[]);
 });
 await test('native slice cannot accept or repin synthetic pristine',()=>{
  assert.throws(()=>reconstructNative(root+'/native',evidence,{pristineRoot:pristine,resourceRoot:resources,home:root+'/home',resourceManifest:{schema:1,files:[]}}),/locked pristine/);assert(!fs.existsSync(root+'/native'));
 });
 await test('dangling destination refuses without overwrite',()=>{
  fs.symlinkSync('absent',root+'/occupied');assert.throws(()=>reconstructNative(root+'/occupied',evidence,{pristineRoot:pristine,resourceRoot:resources,home:root+'/home'}),/new final/);
 });
 await test('portable source companions have no personal absolute path',()=>{
  for(const n of ['dependencies.json','runtime-patches.json',...fs.readdirSync(here+'/cost-integration').map(n=>'cost-integration/'+n)])assert(!/\/home\/|pi-consolidation-[ab]\/revisions/.test(fs.readFileSync(here+'/'+n,'utf8')),n);
 });
 if(process.argv[2]) {
  const actual=process.argv[2];
  put(resources+'/AGENTS.md','generic policy\n');put(resources+'/native-context.md','native stub\n');put(resources+'/context/policy.md','context\n');
  put(resources+'/context/manifest.json',JSON.stringify({schema:1,files:[{path:'context/policy.md',sha256:hash('context\n')}]}));
  const resourceManifest={schema:1,files:inventory(resources)};
  await test('actual locked Pi native reconstruction and receipt closure',()=>{
   const dest=root+'/actual',result=reconstructNative(dest,evidence,{pristineRoot:actual,resourceRoot:resources,home:root+'/prospective-home',resourceManifest});
   assert.equal(result.complete,false);assert.equal(result.launchable,false);assert(!fs.existsSync(root+'/prospective-home'));
   const receipt=JSON.parse(fs.readFileSync(dest+'/native-slice-receipt.json'));assert.equal(result.receiptSha256,hash(fs.readFileSync(dest+'/native-slice-receipt.json')));
   assert.deepEqual(inventory(dest).filter(e=>e.path!=='native-slice-receipt.json'),receipt.outputs);artifactClosure(dest);
   assert.equal(receipt.runtimeDelta.length,30);assert(!fs.existsSync(dest+'/pi'));assert(!fs.existsSync(dest+'/build-receipt.json'));
   for(const e of receipt.runtimeDelta.filter(e=>e.binding)) {
    const text=fs.readFileSync(dest+'/'+e.path,'utf8');assert(text.includes('reference!==approved'));assert(text.includes('normalizePath(caNativeAuthPath(authPath))'));assert(!text.includes('@PORTABLE_NATIVE_AUTH@'));
   }
  });
 }
 console.log(passed+' tests PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
