import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {nativeBuild} from './native-build.mjs';
import {typedInventory} from './admission.mjs';
import {hash} from './integrity.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-native-receipt-'));let passed=0;
try {
 const project=root+'/build/project',registryProject=root+'/dependencies/project';
 for(const p of [project,registryProject])fs.mkdirSync(p+'/node_modules/node-pty/build/Release',{recursive:true,mode:0o700});
 const addon=project+'/node_modules/node-pty/build/Release/pty.node';fs.writeFileSync(addon,'synthetic addon never loaded',{mode:0o600});
 const original={schema:1,status:'clean',nodeABI:process.versions.modules,toolchain:{node:process.version,npm:'11.19.1',nodeGyp:'12.4.0',platform:process.platform,arch:process.arch},project,registryProject,addonSha256:hash(fs.readFileSync(addon)),registryReceiptSha256:'a'.repeat(64),lockSha256:'b'.repeat(64),command:['/usr/local/bin/node','/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js','rebuild','--nodedir=/usr/local','--make=gmake'],env:{MAKE:'gmake',PYTHON:'/usr/local/bin/python3'},inputsSha256:hash(JSON.stringify(typedInventory(registryProject+'/node_modules'))),files:typedInventory(project+'/node_modules'),qualification:'addon load and shell PTY exit only; Board API/executed graph qualification remains separate'};
 original.upstreamLockSha256='c'.repeat(64);
 original.toolchain={node:{version:process.version,modules:process.versions.modules,platform:process.platform,arch:process.arch}};
 for(const [name,executable,output] of [['nodeGyp','/usr/local/bin/node','v12.4.0'],['make','/usr/local/bin/gmake','version evidence'],['python','/usr/local/bin/python3','version evidence'],['compiler','/usr/bin/c++','version evidence']]){const real=fs.realpathSync.native(executable);original.toolchain[name]={executable,real,sha256:hash(fs.readFileSync(real)),output};}
 original.toolchain.nodeGyp.entrySha256=hash(fs.readFileSync('/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js'));original.toolchain.headers={nodedir:'/usr/local',versionHeaderSha256:hash(fs.readFileSync('/usr/local/include/node/node_version.h'))};
 const registry={provenance:{receipt:{sha256:original.registryReceiptSha256}}},lock={board:{lockfileSha256:'c'.repeat(64)},acquisition:{board:{lockSha256:original.lockSha256}},nativeBuild:{nodeGyp:'12.4.0'}};
 const run=(name,change,valid=false)=>{const r=structuredClone(original);change(r);fs.writeFileSync(root+'/build/receipt.json',JSON.stringify(r),{mode:0o600});if(valid)nativeBuild(root,registry,lock);else assert.throws(()=>nativeBuild(root,registry,lock));passed++;console.log('PASS '+name);};
 run('exact actual-schema postbuild evidence accepted structurally',()=>{},true);
 for(const key of ['project','registryProject','registryReceiptSha256','lockSha256','inputsSha256','addonSha256','qualification','nodeABI'])run('native receipt '+key+' drift refuses',r=>r[key]='wrong');
 run('native command drift refuses',r=>r.command=['true']);run('native toolchain drift refuses',r=>r.toolchain.nodeGyp='unreviewed');run('native full tree omitted member refuses',r=>r.files.pop());
 fs.writeFileSync(project+'/node_modules/unlisted','extra',{mode:0o600});run('native unlisted compiled member refuses',()=>{});fs.unlinkSync(project+'/node_modules/unlisted');
 fs.writeFileSync(registryProject+'/node_modules/changed','changed',{mode:0o600});run('pre-admitted dependency tree drift refuses',()=>{});
 console.log(passed+' native receipt checks PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
