// Isolated real Neovim IPC, synthetic prose only; no production editor/config/state.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
const exec = promisify(execFile);
process.umask(0o077); // Same private creation policy as the ipe-pi launcher.
const source = path.resolve(process.argv[2] || '.');
const { editorRequest } = await import(pathToFileURL(path.join(source, '.pi/agent/ipe-client.mjs')));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-ipe-'));
const file = path.join(dir, 'page with quote\' space.md');
const socket = path.join(dir, 'editor.sock');
await fs.writeFile(file, 'alpha  \nbeta\ngamma\n');
const env = { ...process.env, NVIM_APPNAME: 'ipe-pi', XDG_CONFIG_HOME: path.join(source, '.config'),
  XDG_DATA_HOME: path.join(dir, 'data'), XDG_STATE_HOME: path.join(dir, 'state'), XDG_CACHE_HOME: path.join(dir, 'cache'),
  IPE_BACKUP_DIR: path.join(dir, 'backups'), IPE_PI_ROOT: dir, IPE_PI_AUTOSTART: '0' };
const child = spawn('nvim', ['--headless', '--listen', socket, file], { env, cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = ''; child.stderr.on('data', x => { stderr += x; });
const remote = async code => {
  const expression = code.includes(';') ? `(function() ${code}; return true end)()` : code;
  return (await exec('nvim', ['--server', socket, '--remote-expr', `luaeval(${JSON.stringify(expression)})`], { env })).stdout.trim();
};
let checks = 0;
const check = (a, b) => { assert.deepEqual(a, b); checks++; };
const rejects = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
try {
  const durability = await exec('nvim', ['--headless', '-u', 'NONE', '-i', 'NONE', '-n', '-l',
    path.join(source, '.local/share/vertrice/tests/pi-ipe-durability.lua'), source, dir], { env });
  console.log(durability.stdout + durability.stderr);
  for (let i = 0; ; i++) {
    try { env.IPE_PI_ID = await remote("require('ipe.pi').id"); break; }
    catch (e) { if (i > 100 || child.exitCode !== null) throw new Error(`startup: ${stderr} ${e}`); await new Promise(r => setTimeout(r, 30)); }
  }
  env.NVIM = socket;
  const call = q => editorRequest(q, undefined, env);
  // A schema-valid megabyte request must be refused before RPC, not fail E2BIG
  // with an unknown outcome. Linux's per-argument cap is below ARG_MAX too.
  const untouched = await call({ action: 'read' });
  await rejects(() => call({ action: 'apply', path: file, revision: untouched.revision,
    operations: [{ start: 1, before: 'x'.repeat(500000), after: 'y'.repeat(500000) }] }), /not executed:.*execve budget/);
  check((await call({ action: 'read' })).revision, untouched.revision);
  // Exercise a substantial accepted request through the actual transport.
  const large = 'x'.repeat(32000), replacement = 'y'.repeat(32000);
  await remote(`vim.api.nvim_buf_set_lines(0,0,-1,true,{string.rep('x',32000)})`);
  const largeState = await call({ action: 'read' });
  await call({ action: 'apply', path: file, revision: largeState.revision,
    operations: [{ start: 1, before: large, after: replacement }] });
  check((await call({ action: 'read' })).lines, [replacement]);
  await remote("vim.api.nvim_buf_set_lines(0,0,-1,true,{'alpha  ','beta','gamma'})");
  // getconf remains available, but nvim cannot spawn. No RPC was executed.
  const noEditor = path.join(dir, 'no-editor');
  await fs.mkdir(noEditor);
  const getconf = (await exec('which', ['getconf'])).stdout.trim();
  await fs.symlink(getconf, path.join(noEditor, 'getconf'));
  await rejects(() => editorRequest({ action: 'read' }, undefined, { ...env, PATH: noEditor }), /not executed:.*ENOENT/);
  await remote("vim.api.nvim_buf_set_lines(0, 1, 2, true, {'LIVE beta'})");
  let s = await call({ action: 'read' });
  check(s.lines, ['alpha  ', 'LIVE beta', 'gamma']);
  check(await fs.readFile(file, 'utf8'), 'alpha  \nbeta\ngamma\n');
  check(s.modified, true);
  const diff = await call({ action: 'diff', path: file, revision: s.revision });
  assert.match(diff.diff, /\+LIVE beta/); checks++;
  check((await call({ action: 'read' })).cursor, s.cursor);
  await remote("require('ipe.pi').capture(false)");
  check((await call({ action: 'read' })).selection.fresh, true);
  await remote("vim.cmd('normal! ggVj'); require('ipe.pi').capture(true); vim.cmd('normal! ' .. string.char(27))");
  check((await call({ action: 'read' })).selection.first, 1);
  check((await call({ action: 'read' })).selection.last, 2);
  const initial = s.revision;
  const seq = Number(await remote('vim.fn.undotree().seq_cur'));
  const applied = await call({ action: 'apply', path: file, revision: initial, operations: [
    { start: 1, before: 'alpha  ', after: 'changed  ' }, { start: 3, before: 'gamma', after: 'third\nfourth' } ] });
  check(applied.saved, false);
  check(Number(await remote('vim.fn.undotree().seq_cur')), seq + 1);
  check((await call({ action: 'read' })).lines, ['changed  ', 'LIVE beta', 'third', 'fourth']);
  check((await call({ action: 'read' })).selection.fresh, false);
  await rejects(() => call({ action: 'apply', path: file, revision: initial, operations: [{ start: 1, before: 'alpha  ', after: 'bad' }] }), /revision mismatch/);
  await remote("vim.cmd('undo')");
  check((await call({ action: 'read' })).lines, s.lines);
  s = await call({ action: 'read' });
  await rejects(() => call({ action: 'apply', path: file, revision: s.revision, operations: [
    { start: 1, before: 'alpha  ', after: 'bad' }, { start: 3, before: 'WRONG', after: 'bad' }] }), /before-text mismatch/);
  check((await call({ action: 'read' })).revision, s.revision);
  await rejects(() => call({ action: 'apply', path: file, revision: s.revision, operations: [
    { start: 1, before: 'alpha  \nLIVE beta', after: 'bad' }, { start: 2, before: 'LIVE beta', after: 'bad' }] }), /overlaps/);
  await rejects(() => editorRequest({ action: 'read' }, undefined, { ...env, IPE_PI_ID: 'wrong' }), /identity mismatch/);
  await rejects(() => editorRequest({ action: 'read' }, undefined, { ...env, NVIM: '' }), /No inherited/);
  await rejects(() => call({ action: 'save', path: '/etc/passwd', revision: s.revision }), /outside seat/);
  const backup = await call({ action: 'backup', path: file, revision: s.revision });
  check(await fs.readFile(backup.snapshot, 'utf8'), s.lines.join('\n') + '\n');
  check(await fs.readFile(file, 'utf8'), 'alpha  \nbeta\ngamma\n');
  check((await call({ action: 'backup', path: file, revision: s.revision })).result, 'unchanged');
  check((await call({ action: 'save', path: file, revision: s.revision })).saved, true);
  check(await fs.readFile(file, 'utf8'), s.lines.join('\n') + '\n');
  if (process.env.PI_IPE_NATIVE_BIN) {
    const agent = path.join(dir, 'agent');
    await fs.mkdir(path.join(agent, 'extensions'), { recursive: true });
    await fs.copyFile(path.join(source, '.pi/agent/ipe-client.mjs'), path.join(agent, 'ipe-client.mjs'));
    await fs.copyFile(path.join(source, '.pi/agent/extensions/ipe.ts'), path.join(agent, 'extensions/ipe.ts'));
    let protocolError;
    const server = http.createServer(async (req, res) => {
      try {
        let raw = ''; for await (const part of req) raw += part;
        const body = JSON.parse(raw);
        assert(body.tools.some(t => t.function?.name === 'ipe_editor'));
        const values = body.messages.filter(m => m.role === 'tool').map(m => {
          const text = typeof m.content === 'string' ? m.content : m.content.map(x => x.text || '').join('\n');
          return JSON.parse(text.slice(text.indexOf('{')));
        });
        const step = values.length;
        let args;
        if (step === 0 || step === 2 || step === 4) args = { action: 'read' };
        else if (step === 1) args = { action: 'apply', path: file, revision: values[0].revision,
          operations: [{ start: 2, before: 'LIVE beta', after: 'PI native edit  ' }] };
        else if (step === 3) {
          assert.equal(values[2].lines[1], 'PI native edit  ');
          assert.equal(values[2].modified, true);
          assert.equal(await fs.readFile(file, 'utf8'), 'alpha  \nLIVE beta\ngamma\n');
          args = { action: 'save', path: file, revision: values[2].revision };
        } else {
          assert.equal(values[4].modified, false);
          assert.equal(values[4].lines[1], 'PI native edit  ');
        }
        const delta = args ? { role: 'assistant', tool_calls: [{ index: 0, id: `ipe-${step}`, type: 'function',
          function: { name: 'ipe_editor', arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'IPE_NATIVE_DONE' };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const base = { id: 'ipe-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture' };
        for (const chunk of [ { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: args ? 'tool_calls' : 'stop' }] },
          { ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } ]) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.end('data: [DONE]\n\n');
      } catch (error) { protocolError = error; res.writeHead(500); res.end('fixture assertion failed'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await fs.writeFile(path.join(agent, 'models.json'), JSON.stringify({ providers: { qualification: {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-only', api: 'openai-completions',
        models: [{ id: 'fixture', name: 'IPE fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
      const pending = exec(process.env.PI_IPE_NATIVE_BIN, ['--provider', 'qualification', '--model', 'fixture',
        '--mode', 'json', '--print', '--no-session', '--no-mcp', 'ipe-flow'],
        { env: { ...env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1' }, cwd: dir, timeout: 60000, maxBuffer: 8000000 });
      pending.child.stdin.end(); // Pi consumes non-TTY stdin before starting.
      const native = await pending;
      await fs.writeFile(path.join(dir, 'native-pi.jsonl'), native.stdout);
      await fs.writeFile(path.join(dir, 'native-pi.stderr'), native.stderr);
      if (protocolError) throw protocolError;
      assert.match(native.stdout, /IPE_NATIVE_DONE/);
      const events = native.stdout.split('\n').filter(x => x.startsWith('{')).map(x => JSON.parse(x)).filter(x => x.type === 'tool_execution_end');
      check(events.length, 5);
      check(events.every(x => x.toolName === 'ipe_editor' && !x.result.isError), true);
      check(await fs.readFile(file, 'utf8'), 'alpha  \nPI native edit  \ngamma\n');
      // Same actual Pi tool flow inside Neovim's native retained terminal.
      await remote("vim.api.nvim_buf_set_lines(0,0,-1,true,{'alpha  ','LIVE beta','gamma'}); vim.cmd('silent write')");
      const paneCommand = [process.env.PI_IPE_NATIVE_BIN, '--provider', 'qualification', '--model', 'fixture',
        '--mode', 'json', '--print', '--no-session', '--no-mcp', 'ipe-flow'];
      await remote(`vim.env.PI_CODING_AGENT_DIR = ${JSON.stringify(agent)}; require('ipe.pi').command = vim.json.decode(${JSON.stringify(JSON.stringify(paneCommand))}); require('ipe.pi').reveal()`);
      for (let i = 0; await remote("require('ipe.pi').alive()") === 'true'; i++) {
        if (i > 500) throw new Error('Native Pi terminal failed to exit');
        await new Promise(r => setTimeout(r, 50));
      }
      if (protocolError) throw protocolError;
      check(await fs.readFile(file, 'utf8'), 'alpha  \nPI native edit  \ngamma\n');
      const paneText = await remote("table.concat(vim.api.nvim_buf_get_lines(require('ipe.pi').pane.buf,0,-1,true),'\\n')");
      assert.match(paneText.replace(/\n/g, ''), /IPE_NATIVE_DONE/); checks++;
      await fs.writeFile(path.join(dir, 'native-pane.txt'), paneText);
      await remote("vim.api.nvim_set_current_win(require('ipe.pi').win)");
      console.log('PASS actual Pi extension read/apply/read/separate-save/read with deterministic local provider; no real-model claim');
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
  await remote("vim.api.nvim_buf_set_lines(0, 0, -1, true, {'---', 'state: locked', '---', 'protected', '[EDIT]', 'editable'})");
  s = await call({ action: 'read' });
  await rejects(() => call({ action: 'apply', path: file, revision: s.revision, operations: [{ start: 4, before: 'protected', after: 'bad' }] }), /locked span/);
  await call({ action: 'apply', path: file, revision: s.revision, operations: [{ start: 6, before: 'editable', after: 'allowed' }] }); checks++;
  await remote("vim.api.nvim_buf_set_lines(0, 4, 5, true, {'inline [EDIT] mention'})");
  s = await call({ action: 'read' });
  await rejects(() => call({ action: 'apply', path: file, revision: s.revision, operations: [{ start: 6, before: 'allowed', after: 'bad' }] }), /locked span/);
  // Failure to write a named new file retains the dirty buffer.
  const missing = path.join(dir, 'missing', 'page.md');
  await remote(`vim.cmd('enew'); vim.api.nvim_buf_set_name(0, ${JSON.stringify(missing)}); vim.api.nvim_buf_set_lines(0,0,-1,true,{'retained'})`);
  s = await call({ action: 'read' });
  await rejects(() => call({ action: 'save', path: missing, revision: s.revision }), /save failed; live edits retained/);
  check((await call({ action: 'read' })).lines, ['retained']);
  await remote("vim.cmd('enew')");
  check((await call({ action: 'read' })).path, '');
  await rejects(() => call({ action: 'apply', path: '', revision: s.revision, operations: [] }), /named buffer required/);
  // Real native terminal lifecycle, not buffer-name or stubbed liveness.
  await remote("require('ipe.pi').command = {'/bin/sh','-c','sleep 30'}; require('ipe.pi').reveal()");
  check(await remote("require('ipe.pi').alive()"), 'true');
  const job = await remote("require('ipe.pi').pane.job");
  await remote("require('ipe.pi').toggle(); require('ipe.pi').reveal()");
  check(await remote("require('ipe.pi').pane.job"), job);
  await remote("vim.fn.jobstop(require('ipe.pi').pane.job); vim.wait(2000,function() return not require('ipe.pi').alive() end); require('ipe.pi').reveal()");
  assert.notEqual(await remote("require('ipe.pi').pane.job"), job); checks++;
  check((await call({ action: 'read' })).path, ''); // terminal focus still reads primary
  await remote("vim.fn.jobstop(require('ipe.pi').pane.job)");
  // Explicit identity never crosses a symlink escape, even for nonexistent files.
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-ipe-outside-'));
  await fs.symlink(outside, path.join(dir, 'escape'));
  await rejects(() => call({ action: 'save', path: path.join(dir, 'escape', 'new.md'), revision: s.revision }), /outside seat/);
  const bytesFile = path.join(dir, 'bytes.md');
  const bytes = 'left  \r\nright\t';
  await fs.writeFile(bytesFile, bytes);
  await remote(`vim.api.nvim_set_current_win(require('ipe.pi').win); vim.cmd('edit ' .. vim.fn.fnameescape(${JSON.stringify(bytesFile)}))`);
  s = await call({ action: 'read' });
  check(s.endofline, false);
  check(s.fileformat, 'dos');
  await call({ action: 'save', path: bytesFile, revision: s.revision });
  check(await fs.readFile(bytesFile, 'utf8'), bytes);
  await remote("vim.api.nvim_buf_set_lines(0,1,2,true,{'unsaved recovery'})");
  s = await call({ action: 'read' });
  const recover = await call({ action: 'backup', path: bytesFile, revision: s.revision });
  check(await fs.readFile(bytesFile, 'utf8'), bytes);
  check(await fs.readFile(recover.snapshot, 'utf8'), 'left  \nunsaved recovery\n');
  assert.match(await fs.readFile(recover.log, 'utf8'), /unsaved recovery/); checks++;
  check((await fs.stat(recover.snapshot)).mode & 0o777, 0o600);
  await remote("vim.cmd('enew'); vim.api.nvim_buf_set_lines(0,0,-1,true,{'unnamed'})");
  s = await call({ action: 'read' });
  await rejects(() => call({ action: 'backup', path: '', revision: s.revision }), /named buffer required/);
  await remote("vim.api.nvim_win_close(require('ipe.pi').win,true)");
  await rejects(() => call({ action: 'read' }), /primary editor window closed/);
  await rejects(() => call({ action: 'save', path: bytesFile, revision: s.revision }), /primary editor window closed/);
  // Production one-command launcher, with a harmless retained cat in place of Pi.
  // Actual Pi protocol-in-terminal is tested above when PI_IPE_NATIVE_BIN is set.
  const launchPage = path.join(dir, 'launch.md'), launchSocket = path.join(dir, 'launch.sock');
  await fs.writeFile(launchPage, 'launcher page  \n');
  await fs.mkdir(path.join(dir, 'bin'));
  await fs.symlink('/bin/cat', path.join(dir, 'bin/pi'));
  const launched = spawn('/bin/sh', [path.join(source, '.local/bin/openbsd/ipe-pi'), '--headless', '--listen', launchSocket, launchPage],
    { env: { ...env, PATH: path.join(dir, 'bin') + ':' + env.PATH }, cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  let launchError = ''; launched.stderr.on('data', x => { launchError += x; });
  const probe = code => exec('nvim', ['--server', launchSocket, '--remote-expr', `luaeval(${JSON.stringify(code)})`], { env });
  try {
    for (let i = 0; ; i++) {
      try { if ((await probe("require('ipe.pi').alive()")).stdout.trim() === 'true') break; } catch {}
      if (i > 100 || launched.exitCode !== null) throw new Error('launcher failed: ' + launchError);
      await new Promise(r => setTimeout(r, 30));
    }
    check(await fs.realpath((await probe("vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(require('ipe.pi').win))")).stdout.trim()), await fs.realpath(launchPage));
    check(await fs.readFile(launchPage, 'utf8'), 'launcher page  \n');
  } finally {
    try { await probe("vim.cmd('qa!')"); } catch {}
    if (launched.exitCode === null) await new Promise(resolve => { launched.once('exit', resolve); setTimeout(() => { launched.kill('SIGTERM'); resolve(); }, 3000).unref(); });
  }
  console.log(`PASS ${checks} real-editor IPC/transaction/lock/backup/save/refusal/pane assertions`);
  console.log(`Evidence scratch retained: ${dir}`);
} finally {
  try { await remote("vim.cmd('qa!')"); } catch {}
  if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 3000).unref(); });
  if (child.exitCode && !process.exitCode) console.error(stderr);
}
