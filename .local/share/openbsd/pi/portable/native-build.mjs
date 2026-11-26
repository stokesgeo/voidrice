import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {typedInventory} from './admission.mjs';
import {absolute,hash,sourceIdentity,inventory,artifactClosure} from './integrity.mjs';
export function validateToolchain(toolchain,lock) {
 assert.deepEqual(toolchain.node,{version:process.version,modules:process.versions.modules,platform:process.platform,arch:process.arch});
 for(const [name,executable] of [['nodeGyp','/usr/local/bin/node'],['make','/usr/local/bin/gmake'],['python','/usr/local/bin/python3'],['compiler','/usr/bin/c++']]) {
  const record=toolchain[name];assert.equal(record.executable,executable);const real=fs.realpathSync.native(executable);assert.equal(record.real,real);const stat=fs.lstatSync(real);assert(stat.isFile()&&stat.uid===0&&!(stat.mode&0o022),'trusted installed native tool required');assert.equal(record.sha256,hash(fs.readFileSync(real)),'native build tool changed: '+name);assert(typeof record.output==='string'&&record.output.length,'native tool version evidence');
 }
 assert.equal(toolchain.nodeGyp.output,'v'+lock.nativeBuild.nodeGyp);assert.equal(toolchain.nodeGyp.entrySha256,sourceIdentity('/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js').sha256);
 assert.deepEqual(toolchain.headers,{nodedir:'/usr/local',versionHeaderSha256:sourceIdentity('/usr/local/include/node/node_version.h').sha256});
}
export function admittedNative(receiptPath,{project,registryProject},registry,lock) {
 for(const p of [receiptPath,project,registryProject])absolute(p);
 assert.equal(receiptPath,path.dirname(project)+'/receipt.json','native receipt/project boundary');
 const identity=sourceIdentity(receiptPath),receipt=JSON.parse(fs.readFileSync(receiptPath));
 assert.equal(receipt.schema,1);assert.equal(receipt.status,'clean');assert.equal(receipt.nodeABI,process.versions.modules);
 assert.equal(receipt.project,project);assert.equal(receipt.registryProject,registryProject);assert.equal(receipt.registryReceiptSha256,registry.provenance.receipt.sha256);assert.equal(receipt.lockSha256,lock.acquisition.board.lockSha256);assert.equal(receipt.upstreamLockSha256,lock.board.lockfileSha256);
 validateToolchain(receipt.toolchain,lock);
 assert.deepEqual(receipt.command,['/usr/local/bin/node','/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js','rebuild','--nodedir=/usr/local','--make=gmake']);assert.deepEqual(receipt.env,{MAKE:'gmake',PYTHON:'/usr/local/bin/python3'});
 assert.equal(receipt.qualification,'addon load and shell PTY exit only; Board API/executed graph qualification remains separate');
 assert.equal(receipt.inputsSha256,hash(JSON.stringify(typedInventory(registryProject+'/node_modules'))),'native build pre-admitted dependency identity');
 assert.deepEqual(typedInventory(project+'/node_modules'),receipt.files,'native build postinventory drift');
 const addon=project+'/node_modules/node-pty/build/Release/pty.node';assert.equal(receipt.addonSha256,sourceIdentity(addon).sha256);
 const members=inventory(project+'/node_modules');artifactClosure(project+'/node_modules',members);
 return {project,receiptPath,identity,receipt,members};
}
export function nativeBuild(boardRoot,registry,lock) {
 return admittedNative(boardRoot+'/build/receipt.json',{project:boardRoot+'/build/project',registryProject:boardRoot+'/dependencies/project'},registry,lock);
}
