// Native Pi1.5.0 reload handoff: tools cannot reload a running agent.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { ContextPack } from '../work-store.mjs';

export default function (pi: ExtensionAPI) {
  let requested = false;
  pi.registerCommand('reload-runtime', {
    description: 'Verify local context and reload this Pi runtime after tested self-edits',
    handler: async (_args, ctx) => {
      const pack = new ContextPack(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
      for (const file of pack.files) pack.read(file.path);
      await ctx.reload();
      return;
    },
  });
  pi.registerTool({
    name: 'reload_runtime', label: 'Reload owned runtime',
    description: 'After testing authorized self-edits and refreshing context hashes, request native resource reload at idle. No elevated permission or trust grant. Verify subsequent new behavior; a request alone is not completion.',
    parameters: Type.Object({}), executionMode: 'sequential',
    async execute(_id, _params, signal) {
      if (signal?.aborted) return { content: [{ type: 'text', text: 'Reload cancelled before request.' }], details: {}, isError: true };
      requested = true;
      return { content: [{ type: 'text', text: 'Reload requested; native command runs after this agent settles.' }], details: { requested: true }, terminate: true };
    },
  });
  pi.on('agent_settled', (event) => {
    if (!requested) return;
    requested = false;
    if (event.aborted) return;
    pi.sendUserMessage('/reload-runtime', { expandPromptTemplates: true });
  });
}
