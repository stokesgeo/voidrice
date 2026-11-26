// Best-effort owned-resource reload at native agent_settled, never a prompt barrier.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { ContextPack } from '../work-store.mjs';

export default function (pi: ExtensionAPI) {
  let requested = false;
  let queued = false;
  let warned = '';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const verifyContext = () => {
    const pack = new ContextPack(root);
    for (const file of pack.files) pack.read(file.path);
  };
  pi.registerCommand('reload-runtime-auto', {
    description: 'Internal best-effort quiet owned-resource reload at idle',
    handler: async (_args, ctx) => {
      queued = false;
      const ui = ctx.ui; // The old ctx becomes stale even when native completion reports failure.
      try {
        const first = ctx.ownedResources;
        if (!first || first.failed) return;
        if (!first.blocked && !first.dirty && first.baseline === first.current) return;
        if (first.blocked) throw new Error(first.blocked);
        verifyContext();
        await new Promise<void>(resolve => setImmediate(resolve));
        const second = ctx.ownedResources;
        if (!second || second.current !== first.current) throw new Error('Owned resources are still changing; reload deferred.');
        if (second.blocked) throw new Error(second.blocked);
        await ctx.reload({ quiet: true, resourcesOnly: true });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (reason !== warned) { warned = reason; ui.notify(`Automatic runtime reload deferred/failed: ${reason}`, 'warning'); }
      }
    },
  });
  pi.registerCommand('reload-runtime', {
    description: 'Verify local context and reload this Pi runtime after tested self-edits',
    handler: async (_args, ctx) => {
      verifyContext();
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
  pi.on('agent_settled', (event, ctx) => {
    if (event.aborted) { requested = false; return; }
    if (requested) {
      requested = false;
      pi.sendUserMessage('/reload-runtime', { expandPromptTemplates: true });
      return;
    }
    if (queued) return;
    const status = ctx.ownedResources;
    // An unpatched runtime keeps the existing manual lane; never guess a baseline.
    if (!status || status.failed) return;
    if (status.blocked) {
      if (status.blocked !== warned) { warned = status.blocked; ctx.ui.notify(`Automatic runtime reload blocked: ${status.blocked}`, 'warning'); }
      return;
    }
    if (!status.dirty && status.baseline === status.current) { warned = ''; return; }
    queued = true;
    pi.sendUserMessage('/reload-runtime-auto', { expandPromptTemplates: true });
  });
}
