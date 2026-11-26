import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { probeModes } from './probe.mjs';

export default function (pi: ExtensionAPI) {
  let active: AbortController | undefined;
  pi.on('session_shutdown', () => active?.abort());
  pi.registerTool({
    name: 'terminal_scroll_modes',
    label: 'Terminal scroll modes (read-only)',
    description: 'Read fixed terminal modes 1049, 1000, 1002, 1003, 1004, 1006 via DECRQM in the attached interactive TUI. No parameters, resets, clearing or mode changes. Uses a 750 ms reply timer; no-reply is unknown, not reset. Reports terminal replies, not scroll diagnosis or view authority.',
    parameters: Type.Object({}, { additionalProperties: false }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_id, params, signal, _update, ctx) {
      if (Object.keys(params).length) throw new Error('terminal_scroll_modes takes no parameters.');
      if (active) throw new Error('A terminal mode probe is already outstanding.');
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      try {
        const details = await probeModes(ctx, controller.signal);
        return {
          content: [{ type: 'text', text: JSON.stringify(details) }],
          details,
          isError: details.status === 'write-error' || details.status === 'aborted',
        };
      } finally {
        signal?.removeEventListener('abort', abort);
        active = undefined;
      }
    },
  });
}
