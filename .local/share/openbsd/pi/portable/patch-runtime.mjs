// Pure preparation: verify every pristine input before any generation write.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import {hash,sourceIdentity} from './integrity.mjs';
export function prepareRuntime(root,lock,spec,nativeAuthStorage,here) {
 const prepared=spec.map(item=>{
  const p=root+'/'+item.path,identity=sourceIdentity(p);assert.equal(identity.sha256,item.input,'pristine runtime drift: '+item.path);
  let text=fs.readFileSync(p,'utf8');
  for(const [before,after,count=1] of item.replacements) {
   assert.equal(text.split(before).length-1,count,'runtime replacement count: '+item.path);
   text=text.split(before).join(after);
  }
  let prepend=item.prepend??'';
  if(item.binding) {
   assert.equal(item.binding,'nativeAuthStorage');
   assert.equal(prepend.split('"@PORTABLE_NATIVE_AUTH@"').length,2,'auth binding slot');
   prepend=prepend.replace('"@PORTABLE_NATIVE_AUTH@"',JSON.stringify(nativeAuthStorage));
  }
  text=(prepend+text).replace(/^\/\/# sourceMappingURL=.*$/gm,'');
  if(item.output)assert.equal(hash(text),item.output,'patched runtime drift: '+item.path);
  return {path:item.path,bytes:Buffer.from(text),mode:identity.mode,input:item.input,output:hash(text),binding:item.binding??null};
 });
 for(const [name,digest] of Object.entries(lock.costModules)) {
  const source=here+'/cost-integration/'+name,identity=sourceIdentity(source);
  assert.equal(identity.sha256,digest,'cost module drift');
  prepared.push({path:'node_modules/@earendil-works/pi-coding-agent/dist/core/cost-integration/'+name,bytes:fs.readFileSync(source),mode:0o600,input:null,output:digest,binding:null});
 }
 if(lock.nativeReloadSources) {
  for(const [name,digest] of Object.entries(lock.nativeReloadSources))assert.equal(sourceIdentity(here+'/'+name).sha256,digest,'native reload source drift');
  const native=require(here+'/native-reload-patch.cjs');
  for(const item of native.specs) {
   const old=prepared.find(e=>e.path===item.target),original=fs.readFileSync(root+'/'+item.target,'utf8');
   assert.equal(hash(original),item.input,'native reload pristine drift');
   let text=old?old.bytes.toString():original;
   for(const [before,after] of item.replacements) {
    if(old&&text.includes(after)&&!text.includes(before))continue;
    assert.equal(text.split(before).length,2,'native reload exact composition drift: '+item.target);text=text.replace(before,after);
   }
   text=(item.prepend??'')+text;text=text.replace(/^\/\/# sourceMappingURL=.*$/gm,'');
   const e={path:item.target,bytes:Buffer.from(text),mode:sourceIdentity(root+'/'+item.target).mode,input:item.input,output:hash(text),binding:null};
   if(old)Object.assign(old,e);else prepared.push(e);
  }
  prepared.push({path:native.helperTarget,bytes:native.helper,mode:0o600,input:null,output:hash(native.helper),binding:null});
 }
 assert.equal(new Set(prepared.map(e=>e.path)).size,prepared.length,'duplicate runtime delta');
 return prepared;
}
