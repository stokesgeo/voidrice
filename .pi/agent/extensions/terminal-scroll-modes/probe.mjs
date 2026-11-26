// Only fixed DECRQM queries; never set/reset modes or open another terminal.
export const MODES = Object.freeze([1049, 1000, 1002, 1003, 1004, 1006]);
export const QUERY = MODES.map(mode => `\x1b[?${mode}$p`).join('');
export const TIMEOUT_MS = 750;
const STATES = ['not-recognized', 'set', 'reset', 'permanently-set', 'permanently-reset'];

export async function probeModes(ctx, signal, input = process.stdin, output = process.stdout) {
  if (ctx.mode !== 'tui' || !ctx.hasUI || !input.isTTY || !input.isRaw || !output.isTTY ||
      typeof ctx.ui?.onTerminalInput !== 'function') {
    throw new Error('terminal_scroll_modes requires the attached interactive raw-input TUI.');
  }
  const replies = new Map();
  let unsubscribe;
  let timer;
  let finish;
  let settled = false;
  const completion = new Promise(resolve => {
    finish = status => {
      if (!settled) { settled = true; resolve(status); }
    };
  });
  const abort = () => finish('aborted');
  try {
    if (signal?.aborted) return { status: 'aborted', modes: rows() };
    unsubscribe = ctx.ui.onTerminalInput(data => {
      if (settled) return;
      // ProcessTerminal's StdinBuffer assembles CSI fragments BEFORE this hook.
      // Never swallow prefixes: native timeout-flushed fragments and all other
      // input must pass unchanged. No replay, editor mutation or second buffer.
      const match = /^\x1b\[\?(1049|1000|1002|1003|1004|1006);([0-4])\$y$/.exec(data);
      if (!match) return;
      const mode = Number(match[1]);
      if (replies.has(mode)) return;
      replies.set(mode, Number(match[2]));
      if (replies.size === MODES.length) finish('complete');
      return { consume: true };
    });
    timer = setTimeout(() => finish('timeout'), TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (!settled) {
      output.write(QUERY, error => { if (error) finish('write-error'); });
    }
    const status = await completion;
    return { status, modes: rows() };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    unsubscribe?.();
  }
  function rows() {
    return MODES.map(mode => {
      const value = replies.get(mode);
      return { mode, value: value ?? null, state: value === undefined ? 'no-reply' : STATES[value] };
    });
  }
}
