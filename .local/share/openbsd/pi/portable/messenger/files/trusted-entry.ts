import { installCrewPresence } from './crew-presence/ui.ts';
import { preflightInstance } from './candidate-instance.mjs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import messenger from './index.ts';

export const reason = 'Messenger requires current native project trust; use the native trust flow and restart when requested. This package does not grant trust.';
export function trusted(ctx: any): boolean {
  try { return ctx?.isProjectTrusted?.() === true; } catch { return false; }
}
export default function (pi: ExtensionAPI) {
  preflightInstance();
  const guarded: ExtensionAPI = {
    ...pi,
    on(event: any, handler: any) {
      return pi.on(event, ((...args: any[]) => {
        if (event === 'session_shutdown' || trusted(args[1])) return handler(...args);
      }) as any);
    },
    registerTool(tool: any) {
      pi.registerTool({ ...tool, async execute(...args: any[]) {
        if (!trusted(args[4])) return { content: [{ type: 'text', text: reason }], details: { error: 'project_not_trusted' }, isError: true };
        return tool.execute(...args);
      } });
    },
    registerCommand(name: string, command: any) {
      pi.registerCommand(name, { ...command, async handler(...args: any[]) {
        if (!trusted(args[1])) { if (args[1]?.hasUI) args[1].ui.notify(reason, 'warning'); return; }
        return command.handler(...args);
      } });
    },
    registerShortcut(key: any, shortcut: any) {
      pi.registerShortcut(key, { ...shortcut, async handler(ctx: any) {
        if (!trusted(ctx)) { if (ctx?.hasUI) ctx.ui.notify(reason, 'warning'); return; }
        return shortcut.handler(ctx);
      } });
    },
  };
  installCrewPresence(guarded);
  messenger(guarded);
}
