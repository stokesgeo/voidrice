import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {sourceIdentity} from './integrity.mjs';
export async function bundle(root,toolRoot,lock,admitted) {
 for(const [p,digest] of Object.entries(lock.esbuild.files))assert.equal(sourceIdentity(path.resolve(toolRoot,p)).sha256,digest,'locked build tool drift: '+p);
 const require=createRequire(import.meta.url),esbuild=require(toolRoot+'/lib/main.js');assert.equal(esbuild.version,lock.esbuild.version);
 const results=[];
 for(const [entry,out] of [['board/source/index.ts','board/source/board-runtime.cjs'],['messenger/trusted-entry.ts','messenger/messenger-runtime.cjs']]) {
  const result=await esbuild.build({absWorkingDir:root,entryPoints:[entry],outfile:root+'/'+out,bundle:true,packages:'external',platform:'node',target:'node22',format:'cjs',metafile:true,footer:entry==='messenger/trusted-entry.ts'?{js:'module.exports = Object.assign(module.exports.default, module.exports);'}:undefined,external:['@earendil-works/pi-coding-agent','@earendil-works/pi-tui',root+'/node_modules/@earendil-works/pi-coding-agent/*',root+'/node_modules/@earendil-works/pi-tui/*'],plugins:[{name:'explicit-source-urls',setup(build){build.onLoad({filter:/\.(?:ts|mjs|js)$/},args=>{
   const rel=path.relative(root,args.path);assert(admitted.has(rel),'unlisted bundle input');
   let contents=fs.readFileSync(args.path,'utf8').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(args.path).href));
   for(const name of ['@earendil-works/pi-coding-agent','@earendil-works/pi-tui']) {
    const manifest=JSON.parse(fs.readFileSync(root+'/node_modules/'+name+'/package.json'));const entry=(manifest.exports?.['.']?.import??(manifest.main?'./'+manifest.main:undefined));assert(typeof entry==='string'&&entry.startsWith('./dist/'),'reviewed native SDK export required');
    const source=root+'/node_modules/'+name+'/'+entry.slice(2);assert(admitted.has(path.relative(root,source)),'unlisted native SDK entry');
    contents=contents.replaceAll(JSON.stringify(name),JSON.stringify(source)).replaceAll("'"+name+"'",JSON.stringify(source));
   }
   assert(!contents.includes('import.meta.'),'unsupported import.meta use');
   return {contents,loader:args.path.endsWith('.ts')?'ts':'js',resolveDir:path.dirname(args.path)};
  });}}],logLevel:'warning'});
  for(const p of Object.keys(result.metafile.inputs))assert(admitted.has(p)&&!p.includes('node_modules/'),'bundle input closure');
  fs.chmodSync(root+'/'+out,0o600);results.push({entry,out,metafile:result.metafile});
 }
 fs.writeFileSync(root+'/bundle-results.json',JSON.stringify({version:esbuild.version,packages:'external',results},null,2)+'\n',{flag:'wx',mode:0o600});
 return results;
}
