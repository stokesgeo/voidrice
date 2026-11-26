'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { isDeepStrictEqual } = require('node:util');
const implementation = fs.readFileSync(__filename);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const piPackage = '@earendil-works/pi-coding-agent';
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function exists(file) {
  try { fs.lstatSync(file); return true; }
  catch (e) { if (e.code !== 'ENOENT') throw e; return false; }
}
function realDirectories(dir) {
  if (!path.isAbsolute(dir) || path.normalize(dir) !== dir) throw Error('normalized absolute directory required');
  for (let parent = dir;; parent = path.dirname(parent)) {
    const st = fs.lstatSync(parent);
    if (!st.isDirectory() || ![0, process.getuid()].includes(st.uid) ||
        ((st.mode & 0o022) && !(parent === '/tmp' && st.uid === 0 && (st.mode & 0o1000))))
      throw Error('trusted nonwritable real directory required');
    if (parent === '/') break;
  }
}
function trustedSource(file) {
  realDirectories(path.dirname(file));
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.nlink !== 1 || ![0, process.getuid()].includes(st.uid) || (st.mode & 0o022))
    throw Error('trusted nonwritable single-link regular source required');
  return { bytes: fs.readFileSync(file), mode: st.mode & 0o777 };
}
function installed(dir, pkg, bin) {
  try {
    fs.accessSync(path.join(dir, 'node_modules/.bin', bin), fs.constants.X_OK);
    return json(path.join(dir, 'node_modules', pkg, 'package.json')).version;
  } catch { return undefined; }
}
function graph(file) {
  const lock = json(file);
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages?.[''])
    throw new Error('expected resolved packages in ' + file);
  const edges = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];
  const fields = [...edges, 'version', 'resolved', 'integrity', 'link', 'engines', 'os', 'cpu', 'libc',
    'optional', 'dev', 'devOptional', 'inBundle', 'hasInstallScript', 'bin'];
  const packages = Object.fromEntries(Object.entries(lock.packages).map(([location, record]) =>
    [location, Object.fromEntries((location === '' ? edges : fields)
      .filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]]))]));
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
    return value;
  }
  return JSON.stringify(ordered(packages));
}
function loadInputs(home, piOnly = false) {
  const dir = path.join(home, '.local/share/openbsd');
  const inputs = { coordinator: hash(implementation) };
  const load = (name, file) => {
    const full = path.join(dir, file);
    inputs[name] = hash(fs.readFileSync(full));
    return require(full);
  };
  const admission = load('npmAdmission', 'npm-admission.cjs');
  const security = load('security', 'security-checks.cjs');
  const source = piOnly ? undefined : load('source', 'source-channels.cjs');
  let recipe, recipeError;
  try {
    const manifestFile = 'pi/portable/files.json';
    const manifestBytes = trustedSource(path.join(dir, manifestFile)).bytes;
    const manifest = JSON.parse(manifestBytes);
    if (manifest.schema !== 1 || !Array.isArray(manifest.files) || !manifest.files.length)
      throw Error('invalid portable recipe manifest');
    const names = manifest.files.includes(manifestFile) ? manifest.files : [manifestFile, ...manifest.files];
    if (new Set(names).size !== names.length || !names.includes('pi/portable/assemble.mjs'))
      throw Error('incomplete portable recipe manifest');
    recipe = new Map();
    for (const file of names) {
      if (typeof file !== 'string' || (!['npm-admission.cjs', 'security-checks.cjs'].includes(file) && !file.startsWith('pi/')) || file.includes('consolidation-') ||
          file.includes('\\') || /[\x00-\x1f\x7f]/.test(file) ||
          file.split('/').some(part => !part || part === '.' || part === '..'))
        throw Error('unsafe portable recipe member');
      const full = path.join(dir, file);
      recipe.set(file, trustedSource(full));
    }
    inputs.piStrategy = hash(JSON.stringify([...recipe].map(([file, entry]) => [file, hash(entry.bytes), entry.mode])));
  } catch (e) {
    recipe = undefined;
    recipeError = 'portable Pi recipe unavailable or malformed; deploy reviewed recipe and companions';
    inputs.piStrategy = { error: recipeError };
  }
  let acquiredRoots, rootsError;
  try {
    const base = path.join(home, '.local/share/vertrice-pi/build-inputs');
    const captured = trustedSource(path.join(base, 'roots.json')).bytes;
    const actual = JSON.parse(captured);
    const expected = {
      pristineRoot: path.join(base, 'pristine/project'), boardRoot: path.join(base, 'board'),
      boardDependenciesRoot: path.join(base, 'board/dependencies/project'), messengerRoot: path.join(base, 'messenger'),
      toolRoot: path.join(base, 'tool/project/node_modules/esbuild'), nativeBuildReceipt: path.join(base, 'board/build/receipt.json'),
    };
    if (!isDeepStrictEqual(actual, expected)) throw Error('acquisition roots mismatch');
    acquiredRoots = Object.freeze(expected);
    inputs.piAcquisitionRoots = hash(captured);
  } catch {
    rootsError = 'portable Pi acquisition roots unavailable or invalid; complete reviewed acquisition required';
  }
  const preparePi = async (generation, evidence, pristineRoot, { installFirst = false } = {}) => {
    if (recipeError) throw Error(recipeError);
    if (rootsError) throw Error(rootsError);
    const roots = { boardRoot: acquiredRoots.boardRoot, messengerRoot: acquiredRoots.messengerRoot,
      toolRoot: acquiredRoots.toolRoot, resourceRoot: path.join(home, '.pi/agent') };
    for (const root of Object.values(roots)) {
      if (!exists(root) || !fs.lstatSync(root).isDirectory())
        throw Error('portable Pi build prerequisite missing: ' + root);
      realDirectories(root);
    }
    realDirectories(evidence);
    const snapshot = path.join(evidence, 'recipe');
    fs.mkdirSync(snapshot, { mode: 0o700 });
    for (const [file, entry] of recipe) {
      const target = path.join(snapshot, file);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, entry.bytes, { mode: entry.mode, flag: 'wx' });
      const captured = trustedSource(target);
      if (!captured.bytes.equals(entry.bytes) || captured.mode !== entry.mode) throw Error('recipe snapshot drift');
    }
    for (const [file, entry] of recipe) {
      const captured = trustedSource(path.join(snapshot, file));
      if (!captured.bytes.equals(entry.bytes) || captured.mode !== entry.mode) throw Error('recipe snapshot drift');
    }
    const portable = path.join(snapshot, 'pi/portable');
    const expectation = JSON.parse(trustedSource(path.join(snapshot, 'pi/acquire/inputs.json')).bytes).pristine;
    if (installFirst) pristineRoot = acquiredRoots.pristineRoot;
    else {
      const { acquireRegistryProject } = await import(pathToFileURL(path.join(snapshot, 'pi/acquire/registry.mjs')));
      const acquired = await acquireRegistryProject({ destination: path.join(evidence, 'pristine'),
        manifest: path.join(snapshot, 'pi/acquire', expectation.manifest), manifestSha256: expectation.manifestSha256,
        lock: path.join(snapshot, 'pi/acquire', expectation.lock), lockSha256: expectation.lockSha256 });
      pristineRoot = acquired.project;
    }
    const { admittedProject } = await import(pathToFileURL(path.join(portable, 'admission.mjs')));
    admittedProject(pristineRoot, { ...expectation, manifest: '../acquire/' + expectation.manifest,
      lock: '../acquire/' + expectation.lock }, portable);
    if (json(path.join(pristineRoot, 'node_modules', piPackage, 'package.json')).version !== '1.6.0')
      throw Error('Pi needs-port; only exact native 1.6.0 is reviewed');
    const gateEvidence = Object.fromEntries(['graph', 'signatures', 'scan'].map(gate =>
      [gate, JSON.parse(trustedSource(path.join(path.dirname(pristineRoot), gate + '.json')).bytes)]));
    const { assemble } = await import(pathToFileURL(path.join(portable, 'assemble.mjs')));
    if (typeof assemble !== 'function') throw Error('portable Pi assembler export unavailable');
    const prepared = await assemble(generation, evidence, { pristineRoot, ...roots, home });
    return { ...prepared, gateEvidence, pristineRoot };

  };
  let settings, settingsError;
  try {
    settings = trustedSource(path.join(dir, 'pi/settings.json')).bytes;
    JSON.parse(settings);
    inputs.piSettings = hash(settings);
  } catch {
    settingsError = 'generic Pi settings unavailable or malformed';
  }
  const seedProfile = generation => {
    if (settingsError) throw Error(settingsError);
    const stub = trustedSource(path.join(generation, 'agent/native-context.md')).bytes;
    const profile = path.join(home, '.local/share/vertrice-pi/profile');
    realDirectories(path.dirname(profile));
    try { fs.mkdirSync(profile, { mode: 0o700 }); }
    catch (e) {
      if (e.code === 'EEXIST') throw Error('portable Pi profile already exists; no overwrite or retry; manual review required: ' + profile);
      throw e;
    }
    try {
      realDirectories(profile);
      for (const [name, bytes] of [['settings.json', settings], ['AGENTS.md', stub], ['auth.json', '{}\n']])
        fs.writeFileSync(path.join(profile, name), bytes, { mode: 0o600, flag: 'wx' });
    } catch (e) {
      throw Error('portable Pi profile initialization incomplete; retained for manual review: ' + profile + '; ' + e.message);
    }
  };
  const manifests = {};
  for (const [pkg, file] of [[piPackage, 'package.json'], ...(!piOnly ? [['chrome-devtools-mcp', 'browser-mcp-package.json']] : [])]) {
    try {
      const bytes = fs.readFileSync(path.join(dir, 'pi', file));
      inputs[file] = hash(bytes);
      manifests[pkg] = { data: JSON.stringify(JSON.parse(bytes)) };
    } catch { manifests[pkg] = { error: 'rolling manifest unavailable or malformed: ' + file }; }
  }
  for (const entry of Object.values(manifests)) Object.freeze(entry);
  return Object.freeze({ admission, security, source, preparePi, seedProfile, manifests: Object.freeze(manifests), identities: Object.freeze(inputs) });
}
function acceptPrepared(prepared, generation) {
  if (prepared?.dest !== generation || prepared.complete !== true || prepared.launchable !== true ||
      !/^[a-f0-9]{64}$/.test(prepared.receiptSha256 || ''))
    throw Error('portable assembler did not return a complete launchable generation receipt');
  const receiptFile = path.join(generation, 'portable-receipt.json');
  realDirectories(generation);
  const bytes = trustedSource(receiptFile).bytes;
  if (hash(bytes) !== prepared.receiptSha256) throw Error('portable receipt identity mismatch');
  const receipt = JSON.parse(bytes);
  if (receipt.schema !== 1 || receipt.complete !== true || receipt.launchable !== true || !Array.isArray(receipt.outputs))
    throw Error('portable receipt is incomplete or not launchable');
  const profile = path.join(path.dirname(path.dirname(generation)), 'profile');
  const expectedBindings = {
    agentDir: profile, nativeAgentDir: profile, nativeAuthStorage: path.join(profile, 'auth.json'),
    runtimeRoot: generation, immutableResourceDir: path.join(generation, 'agent'), launcher: path.join(generation, 'pi'),
  };
  for (const [key, value] of Object.entries(expectedBindings))
    if (receipt.bindings?.[key] !== value) throw Error('portable receipt binding mismatch: ' + key);
  const members = new Map();
  for (const entry of receipt.outputs) {
    const file = entry.path;
    if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.includes('\\') ||
        /[\x00-\x1f\x7f]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..') ||
        file === 'portable-receipt.json' || members.has(file)) throw Error('unsafe portable receipt member');
    members.set(file, entry);
  }
  for (const file of ['route.json', 'instance.json'])
    if (!members.has(file) || members.get(file).link !== undefined) throw Error('portable routing document must be receipted regular output');
  function inspect(dir, prefix = '') {
    realDirectories(dir);
    for (const name of fs.readdirSync(dir)) {
      const file = prefix + name, full = path.join(dir, name), st = fs.lstatSync(full);
      if (st.isDirectory()) { inspect(full, file + '/'); continue; }
      if (file === 'portable-receipt.json') continue;
      const entry = members.get(file);
      if (!entry) throw Error('unreceipted portable generation member');
      if (st.isSymbolicLink()) {
        const link = fs.readlinkSync(full);
        if (![0, process.getuid()].includes(st.uid) || entry.link !== link || path.isAbsolute(link) ||
            !path.resolve(path.dirname(full), link).startsWith(generation + path.sep) ||
            !fs.realpathSync.native(full).startsWith(generation + path.sep))
          throw Error('unsafe portable generation link');
      } else {
        const source = trustedSource(full);
        if (entry.link !== undefined || entry.mode !== source.mode || hash(source.bytes) !== entry.sha256)
          throw Error('portable generation member identity mismatch');
      }
      members.delete(file);
    }
  }
  inspect(generation);
  if (members.size || !fs.lstatSync(path.join(generation, 'pi')).isFile()) throw Error('portable generation closure incomplete');
  fs.accessSync(path.join(generation, 'pi'), fs.constants.X_OK);
  const route = JSON.parse(trustedSource(path.join(generation, 'route.json')).bytes);
  const instance = JSON.parse(trustedSource(path.join(generation, 'instance.json')).bytes);
  if (route.schema !== 1 || !isDeepStrictEqual(route.instance, receipt.bindings) || !isDeepStrictEqual(instance, receipt.bindings))
    throw Error('portable route/instance binding mismatch');
  return prepared;
}
async function updateApp({ pkg, app, legacy, bin, manifest }, context) {
  const { checks, attempts, security, preparePi, seedProfile, npm, env, scanOptions, cleanHome, run, admit, lookupProject, prepareOnly = false, installFirst = false, requestedVersion, requestedPackage } = context;
  if (requestedPackage !== undefined && requestedPackage !== piPackage) throw Error('only the official Pi package is supported');
  if (requestedVersion !== undefined && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedVersion)) throw Error('exact semantic version required');
  const attempt = attempts[pkg] = { complete: false, phase: 'selection', outcome: 'failed',
    selectedAtStart: { kind: 'unresolved' }, finalSelection: { kind: 'unresolved' } };
  for (const gate of ['current', 'candidate', 'signatures', 'scan'])
    checks[pkg + ' ' + gate] = { status: 'unknown', detail: 'not performed in this attempt',
      role: gate === 'current' ? 'selected-at-start' : 'candidate' };
  const current = path.join(app, 'current');
  let selected = legacy;
  const hasSelector = exists(current);
  if (hasSelector) selected = fs.realpathSync(current);
  if (installFirst && (hasSelector || exists(path.join(legacy, 'node_modules')) || exists(path.join(legacy, 'pi'))))
    throw Error('first install refuses existing Pi installation; no migration or overwrite');
  const old = installed(selected, pkg, bin);
  const present = hasSelector || exists(path.join(selected, 'node_modules'));
  const initial = { kind: hasSelector ? 'selector' : present ? 'legacy' : 'absent', runtime: selected, version: old || null };
  attempt.selectedAtStart = initial;
  attempt.finalSelection = { ...initial };
  const currentKey = pkg + ' current'; // Kept for existing report readers; role is explicit.
  checks[currentKey] = present ? { ...await security.graph(selected, npm, env),
    role: 'selected-at-start', runtime: selected } : { status: 'skip', detail: 'no installed runtime at start', role: 'selected-at-start' };
  if (pkg === piPackage) {
    const latest = requestedVersion ?? '1.6.0';
    fs.mkdirSync(path.join(app, 'generations'), { recursive: true, mode: 0o700 });
    const evidence = path.join(app, 'preparations', 'attempt-' + randomUUID());
    fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
    attempt.phase = 'portable acquisition and assembly';
    if (latest !== '1.6.0') { attempt.outcome = 'needs-port'; throw Error('Pi ' + latest + ': needs-port; only exact native 1.6.0 is reviewed'); }
    if (typeof preparePi !== 'function') throw Error('portable assembler unavailable; no vanilla fallback');
    const generation = path.join(app, 'generations', latest + '-portable-' + randomUUID());
    try {
      const prepared = acceptPrepared(await preparePi(generation, evidence, undefined, { installFirst }), generation);
      for (const [gate, key] of [['graph', 'candidate'], ['signatures', 'signatures'], ['scan', 'scan']]) {
        const record = prepared.gateEvidence?.[gate];
        if (!record || !(gate === 'graph' ? ['clean', 'advisories'] : ['clean']).includes(record.status))
          throw Error('verified acquisition evidence unavailable: ' + gate);
        checks[pkg + ' ' + key] = { ...record, role: 'candidate', artifact: prepared.pristineRoot };
      }
      attempt.candidate = { ...prepared, version: latest };
    } catch (e) { attempt.outcome = 'needs-port'; throw e; }
    if ((exists(current) ? fs.realpathSync(current) : legacy) !== selected) throw Error('selector drift during preparation');
    if (installFirst) {
      if (initial.kind !== 'absent' || exists(path.join(legacy, 'node_modules')) || exists(path.join(legacy, 'pi')))
        throw Error('first install found existing Pi installation; selector unchanged');
      acceptPrepared(attempt.candidate, generation);
      if (typeof seedProfile !== 'function') throw Error('generic Pi profile seed unavailable');
      seedProfile(generation);
      acceptPrepared(attempt.candidate, generation);
      fs.symlinkSync(path.relative(app, generation), current);
      attempt.finalSelection = { kind: 'selector', runtime: generation, version: latest };
      Object.assign(attempt, { complete: true, phase: 'complete', outcome: 'installed' });
      console.log(`${pkg}: verified portable first selection published ${generation}.`);
    } else {
      Object.assign(attempt, { complete:true, phase:'complete', outcome:'prepared' });
      console.log(`${pkg}: portable generation prepared ${generation}; selector unchanged; independent review/publication required.`);
    }
    return;
  }
  attempt.phase = 'lookup';
  if (!npm) throw Error(pkg + ': npm unavailable; app channel not attempted');
  const requested = pkg === piPackage ? requestedVersion : undefined;
  const latest = JSON.parse(admit('lookup', lookupProject, undefined, pkg + '@' + (requested ?? 'latest')));
  if (requested !== undefined && latest !== requested) throw Error('requested pi.dev/registry version mismatch');
  if (typeof latest !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(latest))
    throw new Error('invalid latest version for ' + pkg);
  console.log(`${pkg}: installed=${old || 'absent'} latest=${latest} selected=${selected}`);
  const retainedLock = path.join(selected, 'package-lock.json');
  const previousGraph = exists(retainedLock) ? graph(retainedLock) : undefined;
  if (manifest.error) throw Error(manifest.error);
  const parsed = JSON.parse(manifest.data);
  if (parsed.dependencies?.[pkg] !== 'latest' || Object.keys(parsed.dependencies).length !== 1)
    throw new Error('expected single rolling dependency for ' + pkg);
  parsed.dependencies[pkg] = latest;
  fs.mkdirSync(path.join(app, 'generations'), { recursive: true, mode: 0o700 });
  const evidence = pkg === piPackage ? path.join(app, 'preparations', 'attempt-' + randomUUID()) : undefined;
  if (evidence) fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const stage = evidence ? path.join(evidence, 'pristine') : fs.mkdtempSync(path.join(app, 'generations/.candidate-'));
  if (evidence) fs.mkdirSync(stage, { mode: 0o700 });
  const log = path.join(evidence ?? stage, 'build.log');
  for (const gate of ['candidate', 'signatures', 'scan']) checks[pkg + ' ' + gate].artifact = stage;
  console.log(`${pkg}: staging ${stage}`);
  fs.writeFileSync(path.join(stage, 'package.json'), pkg === piPackage ? JSON.stringify({private:true, dependencies:{[piPackage]:latest}}) : JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
  attempt.phase = 'resolution';
  admit('resolution', stage, log);
  const lockIdentity = hash(fs.readFileSync(path.join(stage, 'package-lock.json')));
  const candidateGraph = graph(path.join(stage, 'package-lock.json'));
  attempt.phase = 'candidate graph';
  const candidateCheck = checks[pkg + ' candidate'] = { ...await security.graph(stage, npm, env),
    role: 'candidate', artifact: stage, phase: 'resolved-lock' };
  if (['unknown', 'malicious'].includes(candidateCheck.status))
    throw new Error(pkg + ': candidate security gate blocked; see security report');
  console.log(`${pkg}: graph selected=${previousGraph === undefined ? 'absent' : hash(previousGraph)} candidate=${hash(candidateGraph)}`);
  if (pkg !== piPackage && old === latest && previousGraph === candidateGraph) {
    fs.rmSync(stage, { recursive: true });
    for (const gate of ['signatures', 'scan']) checks[pkg + ' ' + gate] = {
      status: 'skip', detail: 'resolved graph unchanged; installation gate not performed', role: 'candidate', artifact: stage };
    Object.assign(attempt, { complete: true, phase: 'complete', outcome: 'unchanged' });
    console.log(`${pkg}: unchanged resolved graph; no install or activation.`);
    return;
  }
  attempt.phase = 'install';
  admit('ci', stage, log, lockIdentity);
  if (installed(stage, pkg, bin) !== latest) throw new Error('candidate version mismatch; see ' + log);
  attempt.phase = 'signatures';
  checks[pkg + ' signatures'] = { ...security.signatures(stage, npm, env),
    role: 'candidate', artifact: stage, phase: 'installed-before-local-patch' };
  if (checks[pkg + ' signatures'].status !== 'clean')
    throw new Error(pkg + ': candidate signatures blocked; see security report');
  attempt.phase = 'scan';
  checks[pkg + ' scan'] = { ...security.scan([stage], scanOptions),
    role: 'candidate', artifact: stage, phase: 'installed-before-local-patch' };
  if (checks[pkg + ' scan'].status !== 'clean')
    throw new Error(pkg + ': candidate scan blocked; see security report');
  attempt.phase = 'local patch';
  attempt.phase = 'smoke';
  const output = run(path.join(stage, 'node_modules/.bin', bin), ['--version'], cleanHome, log);
  if (output !== latest) throw new Error('candidate version smoke failed; see ' + log);
  attempt.phase = prepareOnly ? 'preparation' : 'activation';
  const generation = path.join(app, 'generations', latest + '-' + path.basename(stage).slice(11));
  fs.renameSync(stage, generation);
  if (prepareOnly) {
    attempt.candidate = { runtime: generation, version: latest };
    Object.assign(attempt, { complete: true, phase: 'complete', outcome: 'prepared' });
    console.log(`${pkg}: prepared ${generation}; selector unchanged; review before activation.`);
    return;
  }
  const next = path.join(app, '.next-' + process.pid);
  fs.symlinkSync(path.relative(app, generation), next);
  try { fs.renameSync(next, current); }
  finally { fs.rmSync(next, { force: true }); }
  attempt.finalSelection = { kind: 'selector', runtime: generation, version: latest };
  attempt.retainedAtStart = initial.kind !== 'absent';
  Object.assign(attempt, { complete: true, phase: 'complete', outcome: present ? 'replaced' : 'installed' });
  checks[pkg + ' final'] = { ...candidateCheck, role: 'final-selection', runtime: generation,
    detail: 'graph result from resolved candidate; signatures/scan ran before any local patch, smoke and activation; no new final-runtime security check' };
  if (attempt.retainedAtStart) checks[currentKey].retained = true;
  console.log(`${pkg}: activated ${generation}; previous runtime retained.`);
}
async function runUserUpdates(home, npm, { piOnly = false, prepareOnly = false, installFirst = false, requestedVersion, requestedPackage } = {}) {
  if (installFirst && (!piOnly || prepareOnly)) throw Error('--install-first requires --pi and cannot prepare only');
  if (prepareOnly && !piOnly) throw new Error('--prepare requires --pi');
  if (process.getuid() === 0) throw new Error('user updates refuse root');
  const inputs = loadInputs(home, piOnly);
  const { admission, security, source, preparePi, seedProfile, manifests } = inputs;
  const checks = piOnly ? {} : { Downloads: { status: 'unknown', detail: 'not performed in this attempt' } }, attempts = {};
  const scanOptions = { days: process.env.VERTRICE_SCAN_DB_DAYS || undefined,
    seconds: process.env.VERTRICE_SCAN_SECONDS || undefined };
  const state = path.join(home, '.local/share/vertrice-update');
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const lock = path.join(state, 'app.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw Error('app lock held; if interrupted, verify no updater is running before removing ' + lock);
  }
  const cleanup = () => fs.rmSync(lock, { recursive: true, force: true });
  let interruptReported = false;
  const interrupted = signal => {
    if (interruptReported) return;
    interruptReported = true;
    console.error('vertrice-update: interrupted by ' + signal + '; attempt incomplete.');
    try {
      security.report(home, 'update', checks, undefined, { apps: attempts, inputs: inputs.identities,
        attempt: { complete: false, outcome: 'interrupted', signal } });
    } catch (e) { console.error('vertrice-update: interrupted report failed: ' + e.message); }
    process.exit(1);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => interrupted(signal)]);
  process.on('exit', cleanup);
  for (const [signal, handler] of signals) process.on(signal, handler);
  try {
    fs.writeFileSync(path.join(lock, 'pid'), `${process.pid}\n`, { mode: 0o600 });
    const admissionFile = admission.snapshot(lock);
    const lookupProject = path.join(lock, 'lookup');
    fs.mkdirSync(lookupProject, { mode: 0o700 });
    fs.writeFileSync(path.join(lookupProject, 'package.json'), '{"private":true}\n', { mode: 0o600 });
    const cleanHome = path.join(lock, 'home');
    fs.mkdirSync(cleanHome, { mode: 0o700 });
    const emptyConfig = path.join(cleanHome, 'global.npmrc');
    fs.writeFileSync(emptyConfig, '', { mode: 0o600 });
    const env = {
      HOME: cleanHome, PATH: process.env.PATH, CI: '1',
      NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: emptyConfig,
      NPM_CONFIG_CACHE: path.join(state, 'npm-cache-public-v1'), NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0',
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1', CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
    };
    function run(command, args, cwd, log) {
      const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 300000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
      if (log) fs.appendFileSync(log, `$ ${path.basename(command)} ${args.join(' ')}\n${r.stdout || ''}${r.stderr || ''}`, { mode: 0o600 });
      if (r.error || r.status !== 0) {
        const reason = (r.stderr || '').split('\n').find(line => line.startsWith('npm admission: '));
        throw new Error(`${path.basename(command)} failed (${r.error?.code || r.status}); ${log ? 'see ' + log : reason || 'public registry lookup failed'}`);
      }
      return r.stdout.trim();
    }
    function admit(phase, dir, log, input) {
      const call = admission.invocation(admissionFile, npm, phase, dir, input);
      return run(call.command, call.args, dir, log);
    }
    let failed = false;
    function blocked(reason) { const e = new Error(reason); e.channelReason = true; throw e; }
    function channel(name, action) {
      try { action(); }
      catch (e) {
        failed = true;
        console.error(`${name}: BLOCKED (${e.channelReason ? e.message : 'local inspection failed'}).`);
      }
    }
    if (!piOnly) {
    channel('source channels', () => {
      if (exists(path.join(home, 'src/vertrice')) || exists(path.join(home, '.local/share/vertrice.git')))
        source(home, channel);
      else {
        console.log('source checkout: absent; no checkout installed.');
        console.log('source HOME: absent; no checkout installed.');
      }
    });
    channel('helper proc-cwd', () => {
      const dir = path.join(home, '.local/src/sd');
      const binary = path.join(dir, 'proc-cwd');
      if (!exists(binary)) { console.log('helper proc-cwd: absent; not installed.'); return; }
      if (!fs.lstatSync(binary).isFile()) blocked('installed helper is not a regular executable');
      fs.accessSync(binary, fs.constants.X_OK);
      const makefile = fs.readFileSync(path.join(dir, 'Makefile'), 'utf8')
        .split('\n').map(l => l.replace(/#.*/, '').trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
      if (makefile !== 'PROG= proc-cwd\nNOMAN= noman\nCFLAGS+=-Wall -Wextra\n.include <bsd.prog.mk>')
        blocked('Makefile dependencies or flags changed; rebuild needs review');
      const stage = fs.mkdtempSync(path.join(dir, '.proc-cwd-update-'));
      try {
        const candidate = path.join(stage, 'proc-cwd');
        const r = spawnSync('/usr/bin/cc', ['-Wall', '-Wextra', '-o', candidate, path.join(dir, 'proc-cwd.c')],
          { cwd: dir, env: { HOME: home, PATH: process.env.PATH }, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
        if (r.error || r.status !== 0) blocked('native compilation failed; previous executable retained');
        fs.renameSync(candidate, binary);
        console.log('helper proc-cwd: rebuilt atomically from installed local source; source freshness follows source channel.');
      } finally { fs.rmSync(stage, { recursive: true, force: true }); }
    });
    channel('Neovim plugins', () => {
      const locations = ['.config/nvim/autoload/plug.vim', '.config/nvim/plugged', '.config/nvim/pack',
        '.local/share/nvim/lazy', '.local/share/nvim/plugged', '.local/share/nvim/site/autoload/plug.vim',
        '.local/share/nvim/site/pack', '.local/share/nvim/pack',
        '.vim/autoload/plug.vim', '.vim/plugged', '.vim/pack', '.vim/bundle'];
      if (locations.some(p => exists(path.join(home, p))))
        blocked('plugin/manager footprint present; update not yet qualified; no bootstrap attempted');
      console.log('Neovim plugins: absent; no plugin/manager footprint, no bootstrap.');
    });
    }
    for (const [pkg, app, legacy, bin] of [
      [piPackage, path.join(home, '.local/share/vertrice-pi'), path.join(home, '.local/share/vertrice-pi'), 'pi'],
      ...(!piOnly ? [['chrome-devtools-mcp', path.join(home, '.local/share/vertrice-browser/mcp'), path.join(home, '.local/share/vertrice-browser/chrome-devtools-mcp-1.13.0'), 'chrome-devtools-mcp']] : []),
    ]) {
      try { await updateApp({ pkg, app, legacy, bin, manifest: manifests[pkg] },
        { checks, attempts, security, preparePi, seedProfile, npm, env, scanOptions, cleanHome, run, admit, lookupProject, prepareOnly, installFirst, requestedVersion, requestedPackage }); }
      catch (e) { failed = true; console.error('vertrice-update: ' + e.message); }
    }
    if (!piOnly) {
    try {
      const downloads = path.join(home, 'Downloads');
      checks.Downloads = exists(downloads) ? security.scan([downloads], scanOptions) : { status: 'skip', detail: 'Downloads absent' };
    } catch { checks.Downloads = { status: 'unknown', detail: 'Downloads inspection failed' }; }
    if (!['clean', 'skip'].includes(checks.Downloads.status)) failed = true;
    }
    security.report(home, 'update', checks, undefined, { apps: attempts, inputs: inputs.identities });
    return failed ? 1 : 0;
  } finally {
    cleanup();
    process.removeListener('exit', cleanup);
    for (const [signal, handler] of signals) process.removeListener(signal, handler);
  }
}
function parseOptions(args) {
  const options = {piOnly:false, prepareOnly:false};
  const seen = new Set();
  for (let i=0;i<args.length;i++) {
    const flag=args[i];
    if (seen.has(flag)) throw Error('duplicate update option');
    seen.add(flag);
    if (flag === '--pi') options.piOnly=true;
    else if (flag === '--prepare') options.prepareOnly=true;
    else if (flag === '--install-first') options.installFirst=true;
    else if (flag === '--version') options.requestedVersion=args[++i];
    else if (flag === '--package') options.requestedPackage=args[++i];
    else throw Error('unknown update option');
  }
  if ((options.prepareOnly || options.installFirst || seen.has('--version') || seen.has('--package')) && !options.piOnly) throw Error('Pi options require --pi');
  if (seen.has('--version') && (typeof options.requestedVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.requestedVersion))) throw Error('exact semantic version required');
  if (seen.has('--package') && options.requestedPackage !== piPackage) throw Error('only the official Pi package is supported');
  if (options.installFirst && options.prepareOnly) throw Error('first install cannot prepare only');
  return options;
}
module.exports = { acceptPrepared, loadInputs, updateApp, runUserUpdates, parseOptions };
if (require.main === module) {
  try {
    const [npm, ...args] = process.argv.slice(2);
    runUserUpdates(process.env.HOME, npm, parseOptions(args))
      .then(code => { process.exitCode = code; })
      .catch(e => { console.error('vertrice-update: ' + e.message); process.exitCode = 1; });
  } catch (e) { console.error('vertrice-update: ' + e.message); process.exitCode=2; }
}
