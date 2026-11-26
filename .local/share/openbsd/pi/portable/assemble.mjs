import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {absolute,memberName,realDirectories,sourceIdentity,inventory,artifactClosure,disjoint,exists,hash} from './integrity.mjs';
import {prepareRuntime} from './patch-runtime.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const json=p=>JSON.parse(fs.readFileSync(p));
export const incompleteReasons=Object.freeze([
 'The native-only development API does not assemble Board or Messenger',
 'Use assemble with admitted reviewed inputs for the complete source reconstruction',
 'Native and interactive runtime acceptance remain separate',
]);
export async function assemble(dest,evidence,{pristineRoot,boardRoot,messengerRoot,resourceRoot,toolRoot,home,boardInputs}={}) {
 const {assembleComplete}=await import('./complete.mjs');
 return assembleComplete(dest,evidence,{pristineRoot,boardRoot,messengerRoot,resourceRoot,toolRoot,home,boardInputs});
}
// Explicit development API, never a setup fallback or a runnable vanilla generation.
export function reconstructNative(dest,evidence,{pristineRoot,resourceRoot,home,resourceManifest}={}) {
 for(const key of ['NODE_OPTIONS','NODE_PATH','PI_PACKAGE_DIR','ESBUILD_BINARY_PATH'])assert(!process.env[key],'inherited injection: '+key);
 for(const p of [dest,evidence,pristineRoot,resourceRoot,home])absolute(p);
 assert(!exists(dest),'new final destination required');realDirectories(path.dirname(dest));realDirectories(evidence);
 for(const p of [evidence,pristineRoot,resourceRoot,home])disjoint(dest,p);
 const lock=json(here+'/dependencies.json'),specBytes=fs.readFileSync(here+'/runtime-patches.json');
 assert.equal(hash(specBytes),lock.runtimePatchesSha256,'runtime patch recipe drift');
 const recipeNames=['assemble.mjs','integrity.mjs','patch-runtime.mjs','dependencies.json','runtime-patches.json',...Object.keys(lock.nativeReloadSources??{}),...Object.keys(lock.costModules).map(n=>'cost-integration/'+n)];
 const recipeSources=Object.fromEntries(recipeNames.map(p=>[p,sourceIdentity(here+'/'+p)]));
 const pristine=inventory(pristineRoot);artifactClosure(pristineRoot,pristine);
 assert.equal(hash(JSON.stringify(pristine)),lock.pristineTree,'locked pristine Pi 1.6.0 tree drift; no repinning');
 const packagePath='node_modules/@earendil-works/pi-coding-agent/package.json';
 assert.equal(json(pristineRoot+'/'+packagePath).version,lock.piVersion,'Pi version');
 assert(resourceManifest?.schema===1&&Array.isArray(resourceManifest.files)&&resourceManifest.files.length,'explicit finite resources manifest required');
 const selected=new Map();
 for(const original of resourceManifest.files) {
  const f={...original,mode:typeof original.mode==='string'?parseInt(original.mode,8):original.mode};
  memberName(f.path);assert(!selected.has(f.path),'duplicate resource');
  assert(!/^(auth|trust|models|models-store|settings)\.json$/.test(path.basename(f.path))&&!f.path.split('/').some(n=>['node_modules','.git','sessions','state'].includes(n)),'private resource forbidden');
  assert(/^[a-f0-9]{64}$/.test(f.sha256)&&Number.isInteger(f.mode)&&[0o600,0o644,0o700,0o755].includes(f.mode),'resource identity schema');
  assert.deepEqual(sourceIdentity(resourceRoot+'/'+f.path),{sha256:f.sha256,mode:f.mode},'resource identity drift');selected.set(f.path,{...f});
 }
 for(const n of ['AGENTS.md','native-context.md','context/manifest.json'])assert(selected.has(n),'missing instruction role: '+n);
 assert.notEqual(selected.get('AGENTS.md').sha256,selected.get('native-context.md').sha256,'distinct native stub required');
 const context=json(resourceRoot+'/context/manifest.json');assert.equal(context.schema,1);assert(Array.isArray(context.files)&&context.files.length,'selected context required');
 const seen=new Set();for(const f of context.files) {memberName(f.path);assert(!seen.has(f.path),'duplicate selected context');seen.add(f.path);assert.equal(selected.get(f.path)?.sha256,f.sha256,'unpackaged/stale context');}
 const nativeAuthStorage=home+'/.local/share/vertrice-pi/profile/auth.json'; // prospective only; never stat/open HOME/profile/state
 const delta=prepareRuntime(pristineRoot,lock,JSON.parse(specBytes),nativeAuthStorage,here);
 const expected=new Map(pristine.map(e=>[e.path,{...e}]));
 for(const e of delta) {if(e.input===null)assert(!expected.has(e.path),'new cost module required');expected.set(e.path,{path:e.path,sha256:e.output,mode:e.mode});}
 for(const e of selected.values()) {const p='agent/'+e.path;assert(!expected.has(p),'resource/native collision');expected.set(p,{...e,path:p});}
 const route={schema:1,runtimeRoot:dest,immutableResourceDir:dest+'/agent',agentDir:home+'/.local/share/vertrice-pi/profile',nativeAgentDir:home+'/.local/share/vertrice-pi/profile',nativeAuthStorage,status:'incomplete-native-slice',launchable:false};
 const routeBytes=Buffer.from(JSON.stringify(route,null,2)+'\n');expected.set('native-bindings.json',{path:'native-bindings.json',sha256:hash(routeBytes),mode:0o600});
 const members=[...expected.values()].sort((a,b)=>a.path.localeCompare(b.path));
 const plan={schema:1,strategy:'source-reconstructed-native-slice',complete:false,launchable:false,pristineTree:lock.pristineTree,recipeSources,resources:[...selected.values()],bindings:route,members,receiptConvention:'receipt outputs exclude the receipt itself',missing:incompleteReasons};
 const planBytes=JSON.stringify(plan,null,2)+'\n';
 fs.writeFileSync(evidence+'/native-prebuild.json',planBytes,{flag:'wx',mode:0o600});
 fs.mkdirSync(dest,{mode:0o700});
 function put(rel,bytes,mode) {memberName(rel);const p=dest+'/'+rel;fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,bytes,{flag:'wx',mode});fs.chmodSync(p,mode);}
 const changed=new Map(delta.map(e=>[e.path,e]));
 for(const e of pristine) {
  if(changed.has(e.path))continue;
  if(e.link!==undefined) {fs.mkdirSync(path.dirname(dest+'/'+e.path),{recursive:true,mode:0o700});fs.symlinkSync(e.link,dest+'/'+e.path);}
  else {assert.deepEqual(sourceIdentity(pristineRoot+'/'+e.path),{sha256:e.sha256,mode:e.mode},'copy-time pristine drift');put(e.path,fs.readFileSync(pristineRoot+'/'+e.path),e.mode);}
 }
 for(const e of delta)put(e.path,e.bytes,e.mode);
 for(const e of selected.values()) {assert.deepEqual(sourceIdentity(resourceRoot+'/'+e.path),{sha256:e.sha256,mode:e.mode},'copy-time resource drift');put('agent/'+e.path,fs.readFileSync(resourceRoot+'/'+e.path),e.mode);}
 put('native-bindings.json',routeBytes,0o600);
 assert.deepEqual(inventory(pristineRoot),pristine,'end-of-build pristine drift');
 for(const [p,id] of Object.entries(recipeSources))assert.deepEqual(sourceIdentity(here+'/'+p),id,'end-of-build recipe drift');
 const actual=inventory(dest);artifactClosure(dest,actual);
 assert.deepEqual([...actual].sort((a,b)=>a.path.localeCompare(b.path)),members,'independent output closure');
 const receipt={schema:1,strategy:plan.strategy,complete:false,launchable:false,activation:'not performed',prebuildSha256:hash(planBytes),pristineTree:lock.pristineTree,recipeSources,runtimeDelta:delta.map(({bytes,...e})=>e),resources:[...selected.values()],bindings:route,outputs:actual,missing:incompleteReasons};
 put('native-slice-receipt.json',JSON.stringify(receipt,null,2)+'\n',0o600);
 return {complete:false,launchable:false,members:actual.length+1,receiptSha256:sourceIdentity(dest+'/native-slice-receipt.json').sha256,prebuildSha256:hash(planBytes)};
}
