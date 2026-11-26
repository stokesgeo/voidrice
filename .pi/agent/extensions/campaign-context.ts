import * as path from 'node:path';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ContextPack } from '../work-store.mjs';
const packRoot=path.resolve(__dirname,'..');
const reply=(value: unknown,error=false)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:value,...(error?{isError:true}:{})});
export default function(pi: ExtensionAPI){
  pi.registerTool({
    name: 'context_search', label: 'Search local context',
    description: 'Search the packaged allowlisted plaintext user/OpenBSD/workflow context, with exact source paths, line excerpts and SHA256. Lexical only, not personal corpus or web. No implicit source execution.',
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }) }),
    async execute(_id, params) {
      try { return reply({ coverage: 'packaged allowlist only; lexical ranked top 8, not exhaustive corpus search', results: new ContextPack(packRoot).search(params.query) }); }
      catch (error) { return reply({ error: error instanceof Error ? error.message : String(error) }, true); }
    },
  });
  pi.registerTool({
    name: 'context_read', label: 'Read local context',
    description: 'Read one exact context manifest path with SHA256 verification. Search first for paths; unconfigured external services remain unavailable.',
    parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 300 }) }),
    async execute(_id, params) {
      try { return reply(new ContextPack(packRoot).read(params.path)); }
      catch (error) { return reply({ error: error instanceof Error ? error.message : String(error) }, true); }
    },
  });
}
