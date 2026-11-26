import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAttempt, run, node, sha256, verified, projectManifest, acquireRegistryProject, inventory, trusted } from './registry.mjs';
import { stage } from './messenger/stage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(fs.readFileSync(path.join(here, 'sources.json')));
const inputs = JSON.parse(fs.readFileSync(path.join(here, 'inputs.json')));
function git(attempt, label, args, cwd = attempt.destination) {
  run(attempt, label, '/usr/local/bin/git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'submodule.recurse=false', ...args], { cwd, env: { ...attempt.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', GIT_CEILING_DIRECTORIES: path.dirname(cwd) } });
}
function source(attempt, name) {
  const pin = pins[name], destination = path.join(attempt.destination, name + '-source');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.git$/.test(pin.upstream) || !/^[a-f0-9]{40}$/.test(pin.commit)) throw Error('invalid public source pin');
  git(attempt, name + '-init', ['init', '--template=', destination]);
  git(attempt, name + '-fetch', ['fetch', '--no-tags', '--no-recurse-submodules', '--depth=1', pin.upstream, pin.commit], destination);
  git(attempt, name + '-checkout', ['checkout', '--detach', pin.commit], destination);
  git(attempt, name + '-head', ['rev-parse', 'HEAD'], destination);
  const head = fs.readFileSync(path.join(attempt.destination, 'logs', name + '-head.log'), 'utf8').trim();
  if (head !== pin.commit) throw Error('source commit mismatch');
  git(attempt, name + '-status', ['status', '--porcelain=v1', '--untracked-files=all'], destination);
  if (fs.readFileSync(path.join(attempt.destination, 'logs', name + '-status.log'), 'utf8') !== '') throw Error('source not clean');
  git(attempt, name + '-submodules', ['ls-tree', '-r', pin.commit], destination);
  if (/^160000 /m.test(fs.readFileSync(path.join(attempt.destination, 'logs', name + '-submodules.log'), 'utf8'))) throw Error('submodule source unsupported');
  return destination;
}
function registryInput(name) {
  const input = inputs[name];
  for (const key of ['manifest', 'lock']) if (path.basename(input[key]) !== input[key]) throw Error('source input path invalid');
  return { ...input, manifest: path.join(here, input.manifest), lock: path.join(here, input.lock) };
}
export function buildNative(attempt, boardSource, board, boardRoot) {
  const buildRoot = path.join(boardRoot, 'build');
  fs.mkdirSync(buildRoot, { mode: 0o700 });
  const boardBuild = path.join(buildRoot, 'project');
  fs.cpSync(boardSource, boardBuild, { recursive: true, verbatimSymlinks: true });
  fs.cpSync(path.join(board.project, 'node_modules'), path.join(boardBuild, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const nativeBefore = inventory(path.join(boardBuild, 'node_modules'));
  if (sha256(JSON.stringify(nativeBefore)) !== sha256(JSON.stringify(inventory(path.join(board.project, 'node_modules'))))) throw Error('native dependency copy changed');
  const gyp = '/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js'; trusted(gyp);
  const gypEntrySha256 = sha256(fs.readFileSync(gyp));
  const toolchain = {};
  for (const [name, executable, args] of [
    ['node', node, ['-p', 'JSON.stringify({version:process.version,modules:process.versions.modules,platform:process.platform,arch:process.arch})']],
    ['nodeGyp', node, ['/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js', '--version']],
    ['make', '/usr/local/bin/gmake', ['--version']],
    ['python', '/usr/local/bin/python3', ['--version']],
    ['compiler', '/usr/bin/c++', ['--version']]
  ]) {
    const real = fs.realpathSync.native(executable); trusted(real, false, true);
    run(attempt, 'toolchain-' + name, executable, args);
    const output = fs.readFileSync(path.join(attempt.destination, 'logs', 'toolchain-' + name + '.log'), 'utf8').trim();
    toolchain[name] = name === 'node' ? JSON.parse(output) : { executable, real, sha256: sha256(fs.readFileSync(real)), output };
  }
  toolchain.nodeGyp.entrySha256 = gypEntrySha256;
  const header = '/usr/local/include/node/node_version.h'; trusted(header);
  toolchain.headers = { nodedir: '/usr/local', versionHeaderSha256: sha256(fs.readFileSync(header)) };
  const args = ['/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js', 'rebuild', '--nodedir=/usr/local', '--make=gmake'];
  run(attempt, 'node-pty-build', node, args, { cwd: path.join(boardBuild, 'node_modules/node-pty'), env: { ...attempt.env, MAKE: 'gmake', PYTHON: '/usr/local/bin/python3' } });
  const release = path.join(boardBuild, 'node_modules/node-pty/build/Release');
  for (const relative of ['pty.node', 'obj.target/pty.node']) {
    const file = path.join(release, relative), st = fs.lstatSync(file);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022)) throw Error('untrusted native build output');
    const bytes = fs.readFileSync(file);
    fs.unlinkSync(file);
    fs.writeFileSync(file, bytes, { mode: st.mode & 0o777, flag: 'wx' });
  }
  const addon = path.join(release, 'pty.node');
  trusted(addon);
  run(attempt, 'node-pty-load', node, ['-e', 'const p=require(process.argv[1]);const t=p.spawn("/bin/sh",["-c","exit 0"],{env:{PATH:"/bin:/usr/bin"}});t.onExit(e=>{if(e.exitCode!==0)process.exitCode=1});', path.join(boardBuild, 'node_modules/node-pty')]);
  const nativeReceipt = { schema: 1, status: 'clean', nodeABI: toolchain.node.modules, toolchain, project: boardBuild, registryProject: board.project, addonSha256: sha256(fs.readFileSync(addon)), registryReceiptSha256: sha256(fs.readFileSync(path.join(board.destination, 'receipt.json'))), lockSha256: inputs.board.lockSha256, upstreamLockSha256: pins.board.lockfileSha256, command: [node, ...args], env: { MAKE: 'gmake', PYTHON: '/usr/local/bin/python3' }, inputsSha256: sha256(JSON.stringify(nativeBefore)), files: inventory(path.join(boardBuild, 'node_modules')), qualification: 'addon load and shell PTY exit only; Board API/executed graph qualification remains separate' };
  fs.writeFileSync(path.join(buildRoot, 'receipt.json'), JSON.stringify(nativeReceipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return path.join(buildRoot, 'receipt.json');
}
export async function prepare(destination) {
  const attempt = createAttempt(destination);
  const boardBase = path.join(destination, 'board');
  fs.mkdirSync(boardBase, { mode: 0o700 });
  const boardAcquired = source(attempt, 'board');
  const boardSource = path.join(boardBase, 'source');
  fs.renameSync(boardAcquired, boardSource);
  const messengerSource = source(attempt, 'messenger');
  const patch = verified(path.join(here, 'board.patch'), pins.board.patchSha256);
  verified(path.join(boardSource, 'package-lock.json'), pins.board.lockfileSha256);
  git(attempt, 'board-patch-check', ['apply', '--check', path.join(here, 'board.patch')], boardSource);
  const upstreamManifest = fs.readFileSync(path.join(boardSource, 'package.json'));
  if (sha256(upstreamManifest) !== sha256(fs.readFileSync(path.join(here, 'board-upstream-package.json')))) throw Error('Board upstream manifest mismatch');
  const upstream = JSON.parse(projectManifest(upstreamManifest));
  if (JSON.stringify(upstream.dependencies) !== JSON.stringify({ '@xterm/headless': '^6.0.0', 'node-pty': '^1.1.0' })) throw Error('Board production source declarations changed');
  const portableManifest = JSON.parse(verified(path.join(here, inputs.board.manifest), inputs.board.manifestSha256));
  if (JSON.stringify(portableManifest.dependencies) !== JSON.stringify({ '@xterm/headless': '6.0.0', 'node-pty': '1.1.0' }) || portableManifest.devDependencies || portableManifest.peerDependencies) throw Error('Board production contract mismatch');
  const pristine = await acquireRegistryProject({ destination: path.join(destination, 'pristine'), ...registryInput('pristine') });
  const board = await acquireRegistryProject({ destination: path.join(boardBase, 'dependencies'), ...registryInput('board') });
  const tool = await acquireRegistryProject({ destination: path.join(destination, 'tool'), ...registryInput('tool') });
  const boardRoot = boardBase;
  const nativeBuildReceipt = buildNative(attempt, boardSource, board, boardRoot);
  const toolRoot = path.join(tool.project, 'node_modules/esbuild');
  run(attempt, 'esbuild-binary', path.join(tool.project, 'node_modules/@esbuild/openbsd-x64/bin/esbuild'), ['--version']);
  if (fs.readFileSync(path.join(destination, 'logs/esbuild-binary.log'), 'utf8').trim() !== '0.25.5') throw Error('esbuild binary version mismatch');
  const messengerRoot = path.join(destination, 'messenger');
  const oldPath = process.env.PATH;
  process.env.PATH = attempt.env.PATH;
  try { stage(messengerSource, messengerRoot); } finally { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; }
  const roots = { pristineRoot: pristine.project, boardRoot, boardDependenciesRoot: board.project, messengerRoot, toolRoot, nativeBuildReceipt };
  fs.writeFileSync(path.join(destination, 'roots.json'), JSON.stringify(roots, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return roots;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [destination, extra] = process.argv.slice(2);
  if (!destination || extra) throw Error('usage: node prepare.mjs /absolute/new-build-inputs');
  console.log(JSON.stringify(await prepare(destination), null, 2));
}
