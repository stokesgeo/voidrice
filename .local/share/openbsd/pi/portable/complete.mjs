import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {absolute,memberName,realDirectories,sourceIdentity,inventory,artifactClosure,disjoint,exists,hash} from './integrity.mjs';
import {prepareRuntime} from './patch-runtime.mjs';
import {prepareBoard} from './prepare-board.mjs';
import {applyOverlay} from './messenger/apply-overlay.mjs';
import {bundle} from './bundle.mjs';
import {qualifyBoard} from './qualify-board.mjs';
import {admittedProject} from './admission.mjs';
import {nativeBuild,admittedNative} from './native-build.mjs';
import {routes} from './routes.mjs';
import {instructionBindings} from '../instruction-inputs.mjs';
export const shellQuote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export function resourceMode(mode) {
 assert(typeof mode==='number'||typeof mode==='string'&&/^0[0-7]{3}$/.test(mode),'resource mode schema');
 const value=typeof mode==='string'?parseInt(mode,8):mode;assert([0o600,0o644,0o700,0o755].includes(value),'safe resource mode required');return value;
}
const here=path.dirname(fileURLToPath(import.meta.url));
const json=p=>JSON.parse(fs.readFileSync(p));
const production=e=>e.path!=='test.mjs'&&!e.path.endsWith('-test.mjs')&&!e.path.split('/').includes('tests');
function copy(root,dest,members) {
 for(const e of members) {
  const p=dest+'/'+e.path;fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});
  if(e.link!==undefined)fs.symlinkSync(e.link,p);
  else {assert.deepEqual(sourceIdentity(root+'/'+e.path),{sha256:e.sha256,mode:e.mode});fs.copyFileSync(root+'/'+e.path,p);fs.chmodSync(p,e.mode);}
 }
}
function stagedMessenger(root) {
 const manifest=json(here+'/messenger/manifest.json');const members=inventory(root);artifactClosure(root,members);
 assert.deepEqual(members.map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path)),manifest.base.files.map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path)),'pinned staged Messenger exact closure');return members;
}
export async function assembleComplete(dest,evidence,{pristineRoot,boardRoot,messengerRoot,resourceRoot,toolRoot,home,boardInputs}={}) {
 for(const key of ['NODE_OPTIONS','NODE_PATH','PI_PACKAGE_DIR','ESBUILD_BINARY_PATH'])assert(!process.env[key],'inherited injection');
 for(const p of [dest,evidence,pristineRoot,boardRoot,messengerRoot,resourceRoot,toolRoot,home])absolute(p);
 assert(!exists(dest),'new final destination required');realDirectories(path.dirname(dest));realDirectories(evidence);
 for(const p of [evidence,pristineRoot,boardRoot,messengerRoot,resourceRoot,toolRoot])disjoint(dest,p);
 const lock=json(here+'/dependencies.json');
 assert(lock.acquisition?.pristine&&lock.acquisition?.board&&lock.acquisition?.tool,'reviewed portable input identity missing: source-owned acquisition locks');
 const boardSourceRoot=boardInputs?.sourceRoot??boardRoot+'/source',boardProjectRoot=boardInputs?.registryProject??boardRoot+'/dependencies/project';
 for(const p of [boardSourceRoot,boardProjectRoot,...(boardInputs?[boardInputs.buildProject,boardInputs.nativeReceipt]:[])]){absolute(p);disjoint(dest,p);}
 if(boardInputs)assert.deepEqual(Object.keys(boardInputs).sort(),['sourceRoot','registryProject','buildProject','nativeReceipt'].sort(),'explicit Board source evidence paths only');
 const nativeAdmission=admittedProject(pristineRoot,lock.acquisition.pristine,here),boardAdmission=admittedProject(boardProjectRoot,lock.acquisition.board,here);
 const built=boardInputs?admittedNative(boardInputs.nativeReceipt,{project:boardInputs.buildProject,registryProject:boardProjectRoot},boardAdmission,lock):nativeBuild(boardRoot,boardAdmission,lock);
 const pristine=nativeAdmission.members,boardDependencies=built.members,messenger=stagedMessenger(messengerRoot);
 const toolProject=path.resolve(toolRoot,'../..'),toolAdmission=admittedProject(toolProject,lock.acquisition.tool,here);
 const provenance={pristine:nativeAdmission.provenance,board:boardAdmission.provenance,tool:toolAdmission.provenance};
 assert.equal(json(pristineRoot+'/node_modules/@earendil-works/pi-coding-agent/package.json').version,'1.6.0');
 assert.equal(sourceIdentity(here+'/runtime-patches.json').sha256,lock.runtimePatchesSha256);
 for(const [p,digest] of Object.entries(lock.esbuild.files))assert.equal(sourceIdentity(path.resolve(toolRoot,p)).sha256,digest,'build tool drift');
 const resourceIdentity=sourceIdentity(resourceRoot+'/resources.json'),resources=json(resourceRoot+'/resources.json');assert.equal(resources.schema,1);
 const selected=resources.files.filter(e=>!resources.sourceOnly?.includes(e.path)).map(e=>({...e,mode:resourceMode(e.mode)}));
 const seen=new Set();for(const e of selected) {memberName(e.path);assert(!seen.has(e.path),'duplicate resource');seen.add(e.path);assert(!/^(auth|trust|models|models-store|settings)\.json$/.test(path.basename(e.path)),'private resource');assert.deepEqual(sourceIdentity(resourceRoot+'/'+e.path),{sha256:e.sha256,mode:e.mode});}
 selected.push({path:'resources.json',...resourceIdentity});

 const {bindings,route,messengerContract}=routes(dest,home,resources,selected);
 const instructions=instructionBindings(resourceRoot,dest,bindings.agentDir);
 for(const role of [instructions.native,instructions.append,instructions.manifest,...instructions.manifest.members])assert.deepEqual(selected.find(e=>'agent/'+e.path===role.packagedPath),{path:role.packagedPath.slice(6),sha256:role.sha256,mode:role.mode},'instruction resource closure');
 const delta=prepareRuntime(pristineRoot,lock,json(here+'/runtime-patches.json'),bindings.nativeAuthStorage,here);
 provenance.nativeBuild={...built.receipt,identity:built.identity};
 const boardScratch=evidence+'/board-source',messengerScratch=evidence+'/messenger-source';
 assert(!exists(boardScratch)&&!exists(messengerScratch),'fresh source scratch required');
 const boardPreparation=prepareBoard(boardSourceRoot,boardScratch,lock,here);fs.mkdirSync(messengerScratch,{mode:0o700});copy(messengerRoot,messengerScratch,messenger);applyOverlay(messengerScratch);
 const boardPrepared=inventory(boardScratch),messengerPrepared=inventory(messengerScratch);
 const recipe=inventory(here).filter(production);artifactClosure(here,recipe);
 const expected=new Map();const add=(prefix,entries)=>{for(const e of entries){const p=prefix+e.path;assert(!expected.has(p),'duplicate output');expected.set(p,{...e,path:p});}};
 add('',pristine);for(const e of delta){if(e.input===null)assert(!expected.has(e.path));expected.set(e.path,{path:e.path,sha256:e.output,mode:e.mode});}
 add('board/source/',boardPrepared);add('board/source/node_modules/',boardDependencies);add('messenger/',messengerPrepared);add('agent/',selected);
 const generated=new Map(Object.entries({'instance.json':bindings,'board/source/src/core/instance.json':bindings,'route.json':route,'messenger-contract.json':messengerContract}).map(([p,v])=>[p,Buffer.from(JSON.stringify(v,null,2)+'\n')]));
 generated.set('launch.mjs',fs.readFileSync(here+'/launch.mjs'));generated.set('pi',Buffer.from('#!/bin/sh\nset -eu\numask 077\nexec /usr/local/bin/node '+shellQuote(dest+'/launch.mjs')+' "$@"\n'));
 for(const [p,b] of generated)expected.set(p,{path:p,sha256:hash(b),mode:p==='pi'?0o700:0o600});
 for(const p of ['board/source/board-runtime.cjs','messenger/messenger-runtime.cjs','bundle-results.json']){assert(!expected.has(p));expected.set(p,{path:p,mode:0o600});}
 const externalPaths=['../instruction-inputs.mjs','../../npm-admission.cjs','../../security-checks.cjs','../acquire/registry.mjs','../acquire/inputs.json',...Object.values(lock.acquisition).flatMap(e=>[e.manifest,e.lock])];
 const externalRecipes=[...new Set(externalPaths)].map(p=>({path:p,...sourceIdentity(path.resolve(here,p))}));recipe.push(...externalRecipes);
 const plan={schema:1,dest,strategy:'portable-source-reconstruction',bindings,instructions,inputs:provenance,resourcesIdentity:resourceIdentity,recipe,members:[...expected.values()],runtimeDelta:delta.map(({bytes,...e})=>e)};
 const planBytes=JSON.stringify(plan,null,2)+'\n';fs.writeFileSync(evidence+'/portable-prebuild.json',planBytes,{flag:'wx',mode:0o600});
 fs.mkdirSync(dest,{mode:0o700});copy(pristineRoot,dest,pristine);for(const e of delta){const p=dest+'/'+e.path;fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,e.bytes,{mode:e.mode});fs.chmodSync(p,e.mode);}
 copy(boardScratch,dest+'/board/source',boardPrepared);copy(built.project+'/node_modules',dest+'/board/source/node_modules',boardDependencies);copy(messengerScratch,dest+'/messenger',messengerPrepared);copy(resourceRoot,dest+'/agent',selected);
 for(const [p,b] of generated){fs.mkdirSync(path.dirname(dest+'/'+p),{recursive:true,mode:0o700});fs.writeFileSync(dest+'/'+p,b,{mode:expected.get(p).mode});fs.chmodSync(dest+'/'+p,expected.get(p).mode);}
 await bundle(dest,toolRoot,lock,new Set(expected.keys()));
 assert.deepEqual(sourceIdentity(built.receiptPath),built.identity,'native build receipt changed');
 assert.equal(built.receipt.addonSha256,sourceIdentity(dest+'/board/source/node_modules/node-pty/build/Release/pty.node').sha256,'compiled addon receipt drift');
 const boardQualification=qualifyBoard(dest,boardPreparation.qualificationContract,delta,lock.board.lockfileSha256,lock.board.runtimeTranslations);
 assert.deepEqual(json(dest+'/route.json').instance,bindings);
 for(const e of selected)assert.deepEqual(sourceIdentity(resourceRoot+'/'+e.path),{sha256:e.sha256,mode:e.mode},'end-of-build resource drift');
 const actual=inventory(dest);artifactClosure(dest,actual);assert.deepEqual(actual.map(e=>e.path).sort(),[...expected.keys()].sort(),'exact output member closure');
 for(const e of actual){const wanted=expected.get(e.path);if(wanted.sha256)assert.equal(e.sha256,wanted.sha256,'output byte drift');if(wanted.mode!==undefined)assert.equal(e.mode,wanted.mode);if(wanted.link!==undefined)assert.equal(e.link,wanted.link);}
 assert.deepEqual(inventory(pristineRoot),pristine);assert.deepEqual(inventory(built.project+'/node_modules'),boardDependencies);assert.deepEqual(inventory(boardProjectRoot),boardAdmission.members);assert.deepEqual(inventory(messengerRoot),messenger);assert.deepEqual(sourceIdentity(resourceRoot+'/resources.json'),resourceIdentity);assert.deepEqual([...inventory(here).filter(production),...externalRecipes.map(e=>({path:e.path,...sourceIdentity(path.resolve(here,e.path))}))],recipe);
 const receipt={schema:1,dest,complete:true,launchable:true,strategy:plan.strategy,bindings,instructions,outputs:actual,prebuildSha256:hash(planBytes),inputs:provenance,recipe,runtimeDelta:plan.runtimeDelta,activation:'not performed',boardQualification,qualification:'cold API/executed envelope, native ABI load and emitted bundle imports; interactive acceptance separate'};
 fs.writeFileSync(dest+'/portable-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 return {dest,complete:true,launchable:true,receiptSha256:sourceIdentity(dest+'/portable-receipt.json').sha256};
}
