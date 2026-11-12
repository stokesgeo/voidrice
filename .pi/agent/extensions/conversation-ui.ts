// Display-only: execution, approvals, model context and session records stay intact.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Container, Text } from '@earendil-works/pi-tui';
import { summaryInput, cleanSummary, operationLabel } from '../action-summary.mjs';

const routine = new Set(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls',
  'work_task', 'context_search', 'context_read']);

export default function (pi: ExtensionAPI) {
  const labels = new Map<string, string>();
  const redraw = new Map<string, () => void>();
  const cache = new Map<string, Promise<string>>();
  const controllers = new Set<AbortController>();
  let running = 0;
  let warned = false;
  pi.registerFlag('luna-labels', {
    description: 'Opt in to direct OpenAI gpt-6-luna action labels (extra requests/cost; not in session totals)',
    type: 'boolean', default: false,
  });
  pi.on('tool_execution_start', (event, ctx) => {
    if (!pi.getFlag('luna-labels') || disposed || ctx.mode !== 'tui' || event.parentToolCallId || ctx.signal?.aborted) return;
    const input = summaryInput(event.toolName, event.args);
    if (!input) return;
    let pending = cache.get(input);
    if (!pending) {
      if (running >= 2) return;
      const model = ctx.modelRegistry.find('openai', 'gpt-6-luna');
      if (!model) {
        if (!warned) ctx.ui.notify('Luna labels unavailable; using deterministic tool labels.', 'warning');
        warned = true;
        return;
      }
      const controller = new AbortController();
      controllers.add(controller);
      const abort = () => controller.abort();
      const signal = ctx.signal;
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 6000);
      running++;
      pending = ctx.modelRegistry.streamSimple(model, {
        systemPrompt: 'Write a neutral action label of at most eight words from lossy operation metadata. Describe intent only, never claim success or specific file contents. Output only the label.',
        messages: [{ role: 'user', content: input, timestamp: Date.now() }],
      }, { maxTokens: 40, reasoning: 'off', signal: controller.signal }).result().then(message => {
        if (message.stopReason === 'error' || message.stopReason === 'aborted') return '';
        return cleanSummary(message.content.filter(part => part.type === 'text').map(part => part.text).join(' '));
      }).catch(() => '').then(label => {
        if (!label && !disposed && !warned) {
          warned = true;
          ctx.ui.notify('Luna label request failed; using deterministic tool labels.', 'warning');
        }
        return label;
      }).finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controllers.delete(controller);
        running--;
      });
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(input, pending);
    }
    void pending.then(label => {
      if (!label || disposed) return;
      if (labels.size >= 512) { const oldest = labels.keys().next().value!; labels.delete(oldest); redraw.delete(oldest); }
      labels.set(event.toolCallId, label);
      redraw.get(event.toolCallId)?.();
    });
  });
  let disposed = false;
  pi.on('session_shutdown', () => {
    disposed = true;
    for (const controller of controllers) controller.abort();
    redraw.clear();
    labels.clear();
    cache.clear();
  });
  pi.registerToolRenderer((name, next) => {
    const original = next();
    if (!routine.has(name)) return original;
    return {
      ...original,
      renderCall(args, theme, context) {
        if (context.expanded) {
          if (original?.renderCall) return original.renderCall(args, theme, context);
          return new Text(theme.fg('muted', name + '\n' + JSON.stringify(args, null, 2)), 0, 0);
        }
        if (redraw.size >= 512 && !redraw.has(context.toolCallId)) redraw.delete(redraw.keys().next().value!);
        redraw.set(context.toolCallId, context.invalidate);
        const state = context.isError ? 'failed' : context.durationMs !== undefined ? 'finished' : 'activity';
        const summary = labels.get(context.toolCallId);
        const operation = name === 'bash' ? operationLabel(args?.command) : undefined;
        return new Text(theme.fg(context.isError ? 'error' : 'dim', `${name}${operation ? ` · ${operation}` : ''}${summary ? ` · ${summary}` : ''} · ${state}`), 0, 0);
      },
      renderResult(result, options, theme, context) {
        if (!options.expanded && !context.isError) return new Container();
        if (original?.renderResult) return original.renderResult(result, options, theme, context);
        const text = result.content.map(part => part.type === 'text' ? part.text : `[${part.type}]`).join('\n');
        return new Text(theme.fg(context.isError ? 'error' : 'toolOutput', text), 0, 0);
      },
    };
  });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    if (pi.getFlag('luna-labels')) ctx.ui.notify('Luna labels enabled: direct OpenAI side requests may cost extra and are not included in Pi session usage totals. Only lossy operation metadata is sent.', 'warning');
    ctx.ui.setToolsExpanded(false);
    ctx.ui.setHiddenThinkingLabel('');
  });
  pi.registerMarkdownTransformer((text, context) => {
    if (!text.trim() || context.messageType === 'assistant-thinking') return text;
    return `**${context.messageType === 'user' ? 'You' : 'Pi'}**\n\n${text}`;
  });
}
