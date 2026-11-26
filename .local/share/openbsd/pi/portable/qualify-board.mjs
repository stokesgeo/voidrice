import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
export function assertHostResolution(root,source,packages) {
 const resolve=createRequire(source+'/board-runtime.cjs');const resolved={};
 for(const name of packages) {
  const entry=fs.realpathSync.native(resolve.resolve(name)),expected=fs.realpathSync.native(root+'/node_modules/'+name);
  assert(entry.startsWith(expected+'/'),'Board external package shadows qualified host: '+name);resolved[name]=entry;
 }
 return resolved;
}
import {sourceIdentity,hash} from './integrity.mjs';
export function qualifyBoard(root,contract,delta,dependencyLock,translations={}) {
 assert.equal(process.platform,contract.platform);assert.equal(process.arch,contract.arch);assert.equal(process.versions.modules,contract.nodeABI);assert.equal(Number(process.versions.node.split('.')[0]),contract.nodeMajor);
 const modules=root+'/node_modules',modified=new Map(delta.map(e=>[e.path,e]));
 const files={};
 for(const [rel,digest] of Object.entries({...contract.apiFiles,...contract.executedRuntime.files})) {
  const member='node_modules/'+rel,actual=sourceIdentity(root+'/'+member),change=modified.get(member);
  if(change&&change.input!==digest&&change.output!==digest)assert.deepEqual(translations[member],{contractDigest:digest,pristineInput:change.input},'unreviewed Board runtime baseline translation: '+member);
  assert.equal(actual.sha256,change?.output??digest,'Board cold API/executed envelope drift: '+rel);files[member]=actual;
 }
 for(const [name,version] of Object.entries(contract.packages))assert.equal(JSON.parse(fs.readFileSync(modules+'/'+name+'/package.json')).version,version);
 const source=root+'/board/source';assert.equal(sourceIdentity(source+'/package-lock.json').sha256,dependencyLock,'Board cold lock drift');
 for(const [name,version] of Object.entries(contract.nativeDependencies))assert.equal(JSON.parse(fs.readFileSync(source+'/node_modules/'+name+'/package.json')).version,version);
 const externalResolution={};
 for(const name of ['@earendil-works/pi-coding-agent','@earendil-works/pi-tui']) {
  assert(!fs.existsSync(source+'/node_modules/'+name),'Board local SDK shadows qualified host');
  const pkg=JSON.parse(fs.readFileSync(modules+'/'+name+'/package.json')),entry=(pkg.exports?.['.']?.import??(pkg.main?'./'+pkg.main:undefined));assert(typeof entry==='string'&&entry.startsWith('./dist/'));
  const sdk=fs.realpathSync.native(modules+'/'+name+'/'+entry.slice(2));assert(sdk.startsWith(fs.realpathSync.native(modules+'/'+name)+'/'));
  const emitted=fs.readFileSync(source+'/board-runtime.cjs','utf8');assert(emitted.includes(JSON.stringify(modules+'/'+name+'/'+entry.slice(2))),'Board bundle missing exact qualified SDK route');assert(!emitted.includes('require('+JSON.stringify(name)+')'),'Board bare CJS SDK import prohibited');externalResolution[name]=sdk;
 }
 const addon=source+'/node_modules/node-pty/build/Release/pty.node',addonIdentity=sourceIdentity(addon);
 const nativePackage=JSON.parse(fs.readFileSync(modules+'/@earendil-works/pi-coding-agent/package.json'));
 assert.equal(nativePackage.type,contract.executedRuntime.packageRouting.type);assert.deepEqual(nativePackage.bin,contract.executedRuntime.packageRouting.bin);
 const cli=fs.realpathSync.native(modules+'/.bin/pi');assert.equal(cli,fs.realpathSync.native(modules+'/'+contract.executedRuntime.bin));
 const route=JSON.parse(fs.readFileSync(root+'/messenger-contract.json'));
 const env={PATH:'/usr/bin:/bin:/usr/local/bin',HOME:route.home,PI_CODING_AGENT_DIR:route.agentDir,PI_CA_RUNTIME:root,PI_CA_NATIVE_AUTH_STORAGE:route.nativeAuthStorage,PI_CA_MESSENGER_CONTRACT:root+'/messenger-contract.json',PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1'};
 execFileSync(process.execPath,['-e','require(process.argv[1])',addon],{env,timeout:30000,stdio:'pipe'});
 execFileSync(process.execPath,['-e','const assert=require("node:assert/strict");assert.equal(typeof require(process.argv[1]).default,"function","Board runtime default export must be callable");assert.equal(typeof require(process.argv[2]),"function","Messenger runtime export must be callable")',source+'/board-runtime.cjs',root+'/messenger/messenger-runtime.cjs'],{env,timeout:30000,stdio:'pipe'});
 return {schema:1,node:process.version,nodeABI:process.versions.modules,platform:process.platform,arch:process.arch,dependencyLock,addon:addonIdentity,files,cli,externalResolution,loadedBundles:true};
}
