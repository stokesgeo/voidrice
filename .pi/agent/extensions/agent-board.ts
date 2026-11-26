// Complete-generation Board bridge; runtime source and instance are recipe inputs.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getPackageDir, getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default async function (pi: ExtensionAPI) {
 if (process.platform !== 'openbsd') throw Error('Board integration requires OpenBSD');
 const base=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
 const instance=JSON.parse(readFileSync(join(base,'instance.json'),'utf8'));
 if(getAgentDir()!==instance.agentDir) throw Error('Generation agent identity mismatch');
 const source=join(base,'board/source');
 const {inlineOptions}=await import(join(source,'src/core/inline.mjs'));
 const {default:board}=createRequire(import.meta.url)(join(source,'board-runtime.cjs'));
 if(typeof board!=='function') throw Error('Board runtime default export is not a function');
 board(pi,inlineOptions(process.env.HOME!,process.env,getPackageDir(),process.argv[1],instance));
 pi.on('session_start',(event,ctx)=>{
  if(ctx.mode==='tui'&&event.reason==='startup') {
   ctx.ui.setTitle('Pi');
    // Identity checks/title retained; no routine startup declaration.
  }
 });
}
