'use strict';
// Explicit, per-process npm integration, not an npm plugin or an OS sandbox.
// Only builtins load on import: missing/unqualified npm blocks apps, not HOME.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const implementation = fs.readFileSync(__filename);
const registry = 'https://registry.npmjs.org';
// Qualification of the installed OpenBSD linked-module layout and implementation,
// including ALL reachable runtime files and links, not just a claimed version.
// docs/man are nonruntime. Changes require review/requalification, not fallback.
const qualification = Object.freeze({ node: 'v24.22.3', npm: '11.19.1', entries: 1849,
  sha256: '61bbff7bd8a4ede4e0c56d81720362651f5adbf8cee94ed9cb11fce519694ee5' });
function deny(detail) { throw Object.assign(Error('npm admission: ' + detail), { code: 'ENPMADMISSION' }); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function distribution(root) {
  const anchor = path.dirname(root), seen = new Set(), entries = new Map(), files = new Set();
  function walk(file) {
    const rel = path.relative(anchor, file), st = fs.lstatSync(file);
    if (st.isSymbolicLink()) {
      const real = fs.realpathSync(file);
      if (!real.startsWith(anchor + path.sep)) deny('npm module link leaves installation');
      entries.set(rel, 'link:' + path.relative(anchor, real));
      walk(real);
    } else if (st.isDirectory()) {
      if (seen.has(file)) return;
      seen.add(file);
      for (const name of fs.readdirSync(file).sort()) {
        if (!['docs', 'man'].includes(name)) walk(path.join(file, name));
      }
    } else if (st.isFile()) {
      entries.set(rel, digest(fs.readFileSync(file))); files.add(file);
    } else deny('unexpected npm installation file type');
  }
  walk(root);
  const hash = createHash('sha256');
  for (const [name, value] of [...entries].sort((a, b) => a[0] < b[0] ? -1 : 1))
    hash.update(name + '\0' + value + '\n');
  return { sha256: hash.digest('hex'), entries: entries.size, files };
}
function qualify(npm) {
  if (process.version !== qualification.node) deny('Node implementation needs requalification');
  let cli;
  try { cli = fs.realpathSync(npm); } catch { deny('npm unavailable'); }
  const root = path.dirname(path.dirname(cli));
  if (cli !== path.join(root, 'bin/npm-cli.js') || json(path.join(root, 'package.json')).version !== qualification.npm)
    deny('npm CLI/layout/version needs requalification');
  const tree = distribution(root);
  if (tree.sha256 !== qualification.sha256 || tree.entries !== qualification.entries)
    deny('npm implementation/layout changed; requalification required');
  for (const file of tree.files) if (require.cache[file]) deny('npm loaded before admission binding');
  const from = file => createRequire(path.join(root, file));
  const req = from('package.json');
  const modules = Object.fromEntries(['make-fetch-happen', 'npm-registry-fetch', 'minipass-fetch',
    'npm-pick-manifest', 'npm-package-arg', 'pacote'].map(name => [name, req.resolve(name)]));
  // These are the actual request/selection paths. The complete closure digest
  // above also refuses new copies/consumers or a changed transport/loading path.
  for (const [file, name] of [['lib/commands/view.js', 'pacote'],
    ['../pacote/lib/registry.js', 'npm-registry-fetch'], ['../pacote/lib/remote.js', 'npm-registry-fetch'],
    ['../pacote/lib/registry.js', 'npm-pick-manifest'], ['../npm-registry-fetch/lib/index.js', 'make-fetch-happen'],
    ['../make-fetch-happen/lib/index.js', 'minipass-fetch']]) {
    if (from(file).resolve(name) !== modules[name]) deny('unrecognized npm request/selection copy');
  }
  return { root, cli, req, modules, identity: tree.sha256 };
}
function publicURL(value) {
  // Inspect the original authority, not a rewritten/normalized upstream URL.
  if (value instanceof URL) value = value.href;
  if (typeof value !== 'string' || /[\x00-\x20\x7f\\]/.test(value) ||
      !/^https:\/\/registry\.npmjs\.org(?::443)?(?:[/?#]|$)/.test(value))
    deny('request must use absolute public registry HTTPS without userinfo or nondefault port');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password)
    deny('request origin refused');
  return url.href;
}
function registrySpec(npa, name, spec) {
  if (typeof spec !== 'string') deny('dependency spec must be a registry string');
  let parsed;
  try { parsed = npa.resolve(name, spec); } catch { deny('unsupported dependency spec'); }
  const target = parsed.type === 'alias' ? parsed.subSpec : parsed;
  if (!target?.registry || !['version', 'range', 'tag'].includes(target.type))
    deny('nonregistry dependency spec refused before resolution');
  return parsed;
}
function declarations(npa, manifest, root = false) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) deny('malformed manifest');
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', ...(root ? ['devDependencies'] : [])]) {
    const deps = manifest[key];
    if (deps === undefined) continue;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) deny('malformed dependency declarations');
    for (const [name, spec] of Object.entries(deps)) registrySpec(npa, name, spec);
  }
  // Supporting embedded locks/bundles is a separate policy extension. Refuse,
  // never strip metadata, prune optional violations, or select an older version.
  if (manifest.hasShrinkwrap || manifest._hasShrinkwrap || manifest.inBundle || manifest.link ||
      [manifest.bundleDependencies, manifest.bundledDependencies].some(v => v && (!Array.isArray(v) || v.length)))
    deny('published shrinkwrap/bundle expansion is unsupported');
}
function project(npa, dir, phase, expectedLock) {
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o022)) deny('project must be a fresh owned private directory');
  const allowed = new Set(['package.json', ...(phase === 'ci' ? ['package-lock.json'] : []), 'build.log']);
  if (fs.readdirSync(dir).some(name => !allowed.has(name))) deny('unexpected project/config/lock/workspace input');
  const pkgFile = path.join(dir, 'package.json');
  if (!fs.lstatSync(pkgFile).isFile()) deny('project manifest must be regular');
  const pkg = json(pkgFile);
  // Owned rolling manifests have no overrides/workspaces or other resolution
  // controls. Unknown root controls need an explicit extension, not inheritance.
  if (Object.keys(pkg).some(key => !['name', 'version', 'private', 'description', 'dependencies',
    'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines'].includes(key)))
    deny('unsupported root manifest control');
  declarations(npa, pkg, true);
  const tarballs = new Map();
  if (phase === 'ci') {
    const lockFile = path.join(dir, 'package-lock.json');
    if (!fs.lstatSync(lockFile).isFile() || digest(fs.readFileSync(lockFile)) !== expectedLock)
      deny('validated public lock changed before ci');
    const lock = json(lockFile);
    if (![2, 3].includes(lock.lockfileVersion) || !lock.packages?.['']) deny('ci requires a resolved public lock');
    for (const [location, record] of Object.entries(lock.packages)) {
      declarations(npa, record, location === '');
      if (location === '') continue;
      const url = publicURL(record.resolved);
      if (typeof record.integrity !== 'string' || !/^(?:sha(?:1|256|384|512)-[A-Za-z0-9+/]+=*)(?:\s+sha(?:1|256|384|512)-[A-Za-z0-9+/]+=*)*$/.test(record.integrity))
        deny('ci requires authenticated public tarball integrity');
      const values = tarballs.get(url) || new Set(); values.add(record.integrity); tarballs.set(url, values);
    }
  }
  return tarballs;
}
function guardedFetch(raw, violation, tarballs) {
  if (typeof raw !== 'function' || typeof raw.defaults !== 'function' ||
      ['FetchError', 'Headers', 'Request', 'Response'].some(key => typeof raw[key] !== 'function'))
    deny('unrecognized make-fetch-happen export API');
  function guarded(url, opts = {}) {
    try {
      violation.check();
      const identity = publicURL(url);
      // For ci, URL extraction is admitted only for exact public-lock tarballs
      // with their retained integrity. Metadata remains same-origin too.
      if (tarballs) {
        const type = opts.headers?.['pacote-req-type'];
        if (type === 'tarball') {
          if (!opts.integrity || !tarballs.get(identity)?.has(String(opts.integrity)))
            deny('ci tarball is not authenticated by the admitted public lock');
        } else if (type !== 'packument' || opts.integrity)
          deny('ci request is neither public metadata nor an admitted lock tarball');
      }
      return raw(url, { ...opts, redirect: 'error', strictSSL: true }).catch(e => {
        if (e.code === 'ENOREDIRECT') {
          try { deny('registry redirects are refused before follow'); }
          catch (policy) { throw violation.record(policy); }
        }
        throw e;
      });
    } catch (e) { return Promise.reject(violation.record(e)); }
  }
  Object.assign(guarded, Object.fromEntries(['FetchError', 'Headers', 'Request', 'Response'].map(key => [key, raw[key]])));
  // Passing the guarded callable as wrappedFetch is essential. Copying the raw
  // defaults function would bind its original unguarded lexical default instead.
  guarded.defaults = (url, opts) => raw.defaults(url, opts, guarded);
  return guarded;
}
function bind(qualified, phase, tarballs) {
  const { req, modules } = qualified;
  let failure;
  const violation = {
    check() { if (failure) throw failure; },
    record(e) { failure ||= e; return failure; },
    failed() { return failure; },
  };
  // npm may prune a failed optional manifest. An admission violation remains a
  // whole-attempt failure even if npm catches it, with no subsequent requests.
  const exit = () => { if (failure) { process.stderr.write('npm admission: policy violation; attempt blocked; ' + failure.message + '\n'); process.exitCode = 1; } };
  // The qualified npm exit handler resets exitCode from process.exit's argument
  // in its own exit listener. Supply failure there, not merely in an earlier
  // listener which npm can overwrite after optional pruning.
  const nativeExit = process.exit;
  process.exit = code => nativeExit.call(process, failure ? 1 : code);
  process.on('exit', exit);
  const npa = req('npm-package-arg');
  const raw = req('make-fetch-happen');
  const fetch = guardedFetch(raw, violation, phase === 'ci' ? tarballs : undefined);
  require.cache[modules['make-fetch-happen']].exports = fetch;
  const pick = req('npm-pick-manifest');
  if (typeof pick !== 'function') deny('unrecognized manifest-selection API');
  require.cache[modules['npm-pick-manifest']].exports = (...args) => {
    violation.check();
    const manifest = pick(...args); // npm still selects the version, exactly once.
    try {
      declarations(npa, manifest);
      if (!manifest.dist?.tarball) deny('selected manifest lacks a public tarball');
      publicURL(manifest.dist.tarball);
      return manifest;
    } catch (e) { throw violation.record(e); }
  };
  return { violation, fetch, dispose() { process.removeListener('exit', exit); process.exit = nativeExit; } };
}
function cliArgs(phase, dir, input) {
  let command;
  if (phase === 'lookup') command = ['view', input, 'version', '--json'];
  else if (phase === 'resolution') command = ['install', '--package-lock-only'];
  else if (phase === 'ci') command = ['ci'];
  else deny('unknown admission phase');
  return [...command, '--prefix=' + dir, '--workspaces=false', '--include-workspace-root=true', '--global=false',
    '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict', '--registry=' + registry,
    '--replace-registry-host=never', '--strict-ssl=true', '--prefer-online', '--allow-git=none',
    '--allow-file=none', '--allow-directory=none', '--allow-remote=' + (phase === 'ci' ? 'all' : 'none')];
}
function main([npm, phase, dir, input]) {
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH || process.execArgv.length)
    deny('inherited Node preload/options refused');
  const qualified = qualify(npm);
  const npa = qualified.req('npm-package-arg');
  if (phase === 'lookup') {
    const parsed = npa(input);
    if (!parsed.name) deny('lookup requires a named registry package');
    registrySpec(npa, parsed.name, parsed.rawSpec);
  }
  const tarballs = project(npa, dir, phase, input);
  bind(qualified, phase, tarballs);
  process.chdir(dir);
  process.argv = [process.execPath, qualified.cli, ...cliArgs(phase, dir, input)];
  require(qualified.cli); // Trusted CLI loads only AFTER request/selection binding.
}
function snapshot(dir) {
  const file = path.join(dir, 'npm-admission.cjs');
  fs.writeFileSync(file, implementation, { mode: 0o600, flag: 'wx' });
  return file;
}
function invocation(file, npm, phase, dir, input = '') {
  return { command: process.execPath, args: [file, npm, phase, dir, input] };
}
module.exports = { identity: () => digest(implementation), snapshot, invocation,
  qualification, qualify, distribution, publicURL, registrySpec, declarations, project, guardedFetch, bind, cliArgs };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(e.code === 'ENPMADMISSION' ? e.message : 'npm admission: unrecognized installation or project input; blocked'); process.exitCode = 1; }
}
