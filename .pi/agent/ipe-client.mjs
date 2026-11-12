import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

async function checkArgv(args, env) {
  // execve counts argv AND environment. Like POSIX xargs, leave 2048 bytes
  // of headroom; count pointers conservatively at 8 bytes plus terminators.
  const limit = Number((await run('getconf', ['ARG_MAX'], { env })).stdout.trim());
  if (!Number.isSafeInteger(limit) || limit <= 2048) throw new Error('Cannot determine editor transport ARG_MAX');
  const strings = ['nvim', ...args, ...Object.entries(env).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`)];
  const bytes = strings.reduce((n, s) => n + Buffer.byteLength(s) + 1 + 8, 16);
  // Linux also limits each argument to MAX_ARG_STRLEN (32 pages).
  let single = Infinity;
  if (process.platform === 'linux') {
    const page = Number((await run('getconf', ['PAGESIZE'], { env })).stdout.trim());
    if (!Number.isSafeInteger(page) || page <= 0) throw new Error('Cannot determine editor transport page size');
    single = 32 * page;
  }
  if (bytes > limit - 2048 || strings.some(s => Buffer.byteLength(s) + 1 > single)) {
    throw new Error(`argv/environment exceeds host execve budget (ARG_MAX=${limit}${Number.isFinite(single) ? `, single-argument limit=${single}` : ''}); reduce the request`);
  }
}

// Explicit inherited socket only. No probing, fallback, socket deletion or restart.
export async function editorRequest(params, signal, env = process.env) {
  if (!env.NVIM || !env.IPE_PI_ID) throw new Error('No inherited IPE Pi seat; use disk tools only outside live seats');
  if (signal?.aborted) throw new Error('Cancelled before editor request');
  const body = JSON.stringify({ ...params, identity: env.IPE_PI_ID });
  if (Buffer.byteLength(body) > 2000000) throw new Error('Editor request not executed: exceeds 2 MB');
  const encoded = Buffer.from(body).toString('base64');
  // Base64 alphabet carries no Vim/Lua quote or expression delimiters.
  const expression = `luaeval("require('ipe.pi').rpc('${encoded}')")`;
  const args = ['--server', env.NVIM, '--remote-expr', expression];
  try { await checkArgv(args, env); }
  catch (error) { throw new Error(`Editor request not executed: ${error.message}`); }
  if (signal?.aborted) throw new Error('Cancelled before editor request; not executed');
  let stdout;
  try { ({ stdout } = await run('nvim', args,
    { signal, timeout: 15000, maxBuffer: 8 * 1024 * 1024, env })); }
  catch (error) {
    if (error.syscall?.startsWith('spawn')) throw new Error(`Editor request not executed: ${error.message}`);
    throw new Error(`Editor RPC failed; outcome may be unknown. Reread before any retry; never fall back to disk: ${error.message}`);
  }
  const reply = JSON.parse(stdout);
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}
