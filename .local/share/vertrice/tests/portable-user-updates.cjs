'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../../../..');
const { loadInputs, updateApp, acceptPrepared, parseOptions } = require(path.join(repo, '.local/share/openbsd/user-updates.cjs'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-updater-'));
const pkg = '@earendil-works/pi-coding-agent';
function put(file, bytes, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { mode });
}
function fixture(name) {
  const home = path.join(root, name), dir = path.join(home, '.local/share/openbsd');
  for (const file of ['npm-admission.cjs', 'security-checks.cjs', 'source-channels.cjs'])
    put(path.join(dir, file), file === 'source-channels.cjs' ? 'module.exports=()=>42;' : 'module.exports={};');
  put(path.join(dir, 'pi/package.json'), JSON.stringify({ dependencies: { [pkg]: 'latest' } }));
  return { home, dir };
}
function acquisition(home) {
  const base = path.join(home, '.local/share/vertrice-pi/build-inputs');
  const roots = { pristineRoot: base + '/pristine/project', boardRoot: base + '/board', boardDependenciesRoot: base + '/board/dependencies/project', messengerRoot: base + '/messenger', toolRoot: base + '/tool/project/node_modules/esbuild', nativeBuildReceipt: base + '/board/build/receipt.json' };
  for (const [key, value] of Object.entries(roots)) if (key !== 'nativeBuildReceipt') fs.mkdirSync(value, { recursive: true, mode: 0o700 });
  fs.mkdirSync(home + '/.pi/agent', { recursive: true, mode: 0o700 });
  put(base + '/roots.json', JSON.stringify(roots));
  return roots;
}
function complete(dest) {
  put(path.join(dest, 'pi'), '#!/bin/sh\necho 1.6.0\n', 0o700);
  const outputs = [{ path: 'pi', mode: 0o700, sha256: hash(fs.readFileSync(path.join(dest, 'pi'))) }];
  put(path.join(dest, 'agent/native-context.md'), 'generic native stub\n');
  outputs.push({ path: 'agent/native-context.md', mode: 0o600, sha256: hash('generic native stub\n') });
  const profile = path.join(path.dirname(path.dirname(dest)), 'profile');
  const bindings = { agentDir: profile, nativeAgentDir: profile, nativeAuthStorage: profile + '/auth.json', runtimeRoot: dest, immutableResourceDir: dest + '/agent', launcher: dest + '/pi' };
  bindings.sessionDir = path.join(path.dirname(profile), 'state/sessions');
  bindings.workDir = path.join(path.dirname(profile), 'state/work');
  bindings.boardRoot = path.join(path.dirname(profile), 'state/board');
  for (const [file, value] of [['route.json', { schema: 1, instance: bindings }], ['instance.json', bindings]]) {
    const bytes = JSON.stringify(value); put(path.join(dest, file), bytes);
    outputs.push({ path: file, mode: 0o600, sha256: hash(bytes) });
  }
  const receipt = JSON.stringify({ schema: 1, complete: true, launchable: true, outputs, bindings });
  put(path.join(dest, 'portable-receipt.json'), receipt);
  return { dest, complete: true, launchable: true, receiptSha256: hash(receipt) };
}
async function appTrial(name, options = {}) {
  const home = path.join(root, name), app = path.join(home, '.local/share/vertrice-pi');
  const events = [], attempts = {}, checks = {};
  if (options.existing) put(path.join(app, 'node_modules/sentinel'), 'retained');
  const f = fixture(name);
  put(path.join(f.dir, 'pi/settings.json'), fs.readFileSync(path.join(repo, '.local/share/openbsd/pi/settings.json')));
  const realSeed = loadInputs(home, true).seedProfile;
  const context = {
    attempts, checks, npm: 'fixture', env: {}, scanOptions: {}, cleanHome: home, lookupProject: home,
    installFirst: options.installFirst, prepareOnly: options.prepareOnly, requestedVersion: options.version,
    seedProfile: realSeed,
    security: {
      async graph() { events.push('graph'); return { status: options.graph || 'clean' }; },
      signatures() { events.push('signatures'); return { status: options.signatures || 'clean' }; },
      scan() { events.push('scan'); return { status: options.scan || 'clean' }; },
    },
    admit(phase, stage) {
      events.push(phase);
      if (phase === 'lookup') return JSON.stringify(options.version || '1.6.0');
      if (phase === 'resolution') put(path.join(stage, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { [pkg]: '1.6.0' } } } }));
      if (phase === 'ci') {
        put(path.join(stage, 'node_modules', pkg, 'package.json'), JSON.stringify({ version: options.version || '1.6.0' }));
        put(path.join(stage, 'node_modules/.bin/pi'), '#!/bin/sh\nexit 0\n', 0o700);
      }
    },
    async preparePi(dest) {
      for (const [gate, status] of [['graph', options.graph], ['signatures', options.signatures], ['scan', options.scan]]) {
        events.push(gate);
        if (status && !(gate === 'graph' ? ['clean', 'advisories'] : ['clean']).includes(status)) throw Error(gate + ' gate blocked');
      }
      events.push('assemble');
      if (options.failure) throw Error('missing resource prerequisite');
      if (options.incomplete) return { dest, complete: false, launchable: false };
      const prepared = complete(dest);
      if (options.bindings) {
        const file = path.join(dest, 'portable-receipt.json'), receipt = JSON.parse(fs.readFileSync(file));
        if (options.bindings === 'missing') delete receipt.bindings;
        else receipt.bindings[options.bindings] = '/wrong-profile';
        const bytes = JSON.stringify(receipt); put(file, bytes); prepared.receiptSha256 = hash(bytes);
      }
      if (options.routing) {
        const receiptFile = path.join(dest, 'portable-receipt.json'), receipt = JSON.parse(fs.readFileSync(receiptFile));
        const file = options.routing.includes('instance') ? 'instance.json' : 'route.json';
        if (options.routing.startsWith('missing')) {
          receipt.outputs = receipt.outputs.filter(e => e.path !== file); fs.unlinkSync(path.join(dest, file));
        } else {
          const document = JSON.parse(fs.readFileSync(path.join(dest, file)));
          (file === 'route.json' ? document.instance : document).workDir = '/wrong-work';
          const bytes = JSON.stringify(document); put(path.join(dest, file), bytes);
          receipt.outputs.find(e => e.path === file).sha256 = hash(bytes);
        }
        const bytes = JSON.stringify(receipt); put(receiptFile, bytes); prepared.receiptSha256 = hash(bytes);
      }
      if (options.drift) put(path.join(dest, 'pi'), 'drift', 0o700);
      if (options.race) fs.symlinkSync('competitor', path.join(app, 'current'));
      return { ...prepared, pristineRoot: app + '/fixture-project', gateEvidence: { graph: { status: 'clean' }, signatures: { status: 'clean' }, scan: { status: 'clean' } } };
    },
  };
  let error;
  try { await updateApp({ pkg, app, legacy: app, bin: 'pi', manifest: { data: JSON.stringify({ dependencies: { [pkg]: 'latest' } }) } }, context); }
  catch (e) { error = e; }
  return { error, events, attempt: attempts[pkg], app, current: path.join(app, 'current') };
}
(async () => {
  try {
    const configured = fixture('configured');
    for (const file of ['package.json', 'browser-mcp-package.json', 'settings.json'])
      put(path.join(configured.dir, 'pi', file), fs.readFileSync(path.join(repo, '.local/share/openbsd/pi', file)));
    const configuredInputs = loadInputs(configured.home);
    for (const name of [pkg, 'chrome-devtools-mcp']) {
      assert(!configuredInputs.manifests[name].error);
      assert.equal(JSON.parse(configuredInputs.manifests[name].data).dependencies[name], 'latest');
    }
    const absentBrowser = fixture('absent-browser');
    assert.match(loadInputs(absentBrowser.home).manifests['chrome-devtools-mcp'].error, /browser-mcp-package/);
    const profileGeneration = root + '/profile-generation';
    put(profileGeneration + '/agent/native-context.md', 'generic native stub\n');
    const profile = configured.home + '/.local/share/vertrice-pi/profile';
    fs.mkdirSync(path.dirname(profile), { recursive: true, mode: 0o700 });
    put(configured.home + '/.pi/agent/AGENTS.md', 'source policy untouched');
    configuredInputs.seedProfile(profileGeneration);
    assert.equal(fs.readFileSync(profile + '/AGENTS.md', 'utf8'), 'generic native stub\n');
    assert.equal(JSON.parse(fs.readFileSync(profile + '/settings.json')).defaultProjectTrust, 'ask');
    assert.equal(fs.readFileSync(profile + '/auth.json', 'utf8'), '{}\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(profile + '/auth.json')), {});
    assert.equal(fs.statSync(profile + '/auth.json').mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(configured.home + '/.pi/agent/AGENTS.md', 'utf8'), 'source policy untouched');
    put(profile + '/AGENTS.md', 'owner instruction');
    put(profile + '/settings.json', 'owner settings');
    assert.throws(() => configuredInputs.seedProfile(profileGeneration), /profile already exists.*manual review/);
    assert.equal(fs.readFileSync(profile + '/AGENTS.md', 'utf8'), 'owner instruction');
    assert.equal(fs.readFileSync(profile + '/settings.json', 'utf8'), 'owner settings');
    const unsafeProfile = fixture('unsafe-profile');
    put(path.join(unsafeProfile.dir, 'pi/settings.json'), '{}');
    const unsafeApp = unsafeProfile.home + '/.local/share/vertrice-pi';
    fs.mkdirSync(unsafeApp, { mode: 0o700 });
    fs.symlinkSync(profile, unsafeApp + '/profile');
    assert.throws(() => loadInputs(unsafeProfile.home).seedProfile(profileGeneration), /profile already exists/);
    const partialProfile = fixture('partial-profile');
    put(path.join(partialProfile.dir, 'pi/settings.json'), '{}');
    fs.mkdirSync(partialProfile.home + '/.local/share/vertrice-pi/profile', { recursive: true, mode: 0o700 });
    assert.throws(() => loadInputs(partialProfile.home).seedProfile(profileGeneration), /profile already exists.*manual review/);
    assert.throws(() => configuredInputs.seedProfile(root + '/missing-profile-generation'), /ENOENT/);
    const missing = fixture('missing');
    const inputs = loadInputs(missing.home);
    assert.equal(inputs.source(), 42);
    assert(inputs.identities.piStrategy.error);
    await assert.rejects(inputs.preparePi(root + '/absent', root, root), /recipe unavailable/);
    for (const member of ['source-channels.cjs', '../npm-admission.cjs', '/npm-admission.cjs', 'pi/../../npm-admission.cjs']) {
      const f = fixture('unsafe-root-' + hash(member));
      put(path.join(f.dir, 'pi/portable/files.json'), JSON.stringify({ schema: 1, files: ['pi/portable/assemble.mjs', member] }));
      put(path.join(f.dir, 'pi/portable/assemble.mjs'), 'export function assemble() {}');
      const loaded = loadInputs(f.home);
      assert.equal(loaded.source(), 42);
      assert(loaded.identities.piStrategy.error, member);
    }
    for (const kind of ['writable-file', 'writable-directory', 'hardlink', 'symlink', 'escaping-parent', 'escaping-name']) {
      const f = fixture('unsafe-' + kind), portable = path.join(f.dir, 'pi/portable');
      put(portable + '/files.json', JSON.stringify({ schema: 1, files: ['pi/portable/assemble.mjs', ...(kind === 'escaping-name' ? ['pi/../outside.mjs'] : [])] }));
      put(portable + '/assemble.mjs', 'throw Error("UNSAFE RECIPE EXECUTED");');
      if (kind === 'writable-file') fs.chmodSync(portable + '/assemble.mjs', 0o622);
      if (kind === 'writable-directory') fs.chmodSync(f.dir, 0o722);
      if (kind === 'hardlink') fs.linkSync(portable + '/assemble.mjs', root + '/recipe-hardlink');
      if (kind === 'symlink') { fs.renameSync(portable + '/assemble.mjs', portable + '/other.mjs'); fs.symlinkSync('other.mjs', portable + '/assemble.mjs'); }
      if (kind === 'escaping-parent') { fs.renameSync(portable, root + '/escaped-recipe'); fs.symlinkSync(root + '/escaped-recipe', portable); }
      const loaded = loadInputs(f.home);
      assert.equal(loaded.source(), 42);
      assert(loaded.identities.piStrategy.error, kind);
      await assert.rejects(loaded.preparePi(root + '/unused', root, root), /recipe unavailable/);
    }
    for (const kind of ['writable-file', 'writable-directory', 'hardlink', 'symlink', 'escaping-link', 'receipt-hardlink']) {
      const dest = root + '/unsafe-generation-' + kind, prepared = complete(dest);
      if (kind === 'writable-file') fs.chmodSync(dest + '/pi', 0o722);
      if (kind === 'writable-directory') fs.chmodSync(dest, 0o722);
      if (kind === 'hardlink') fs.linkSync(dest + '/pi', root + '/generation-hardlink');
      if (kind === 'receipt-hardlink') fs.linkSync(dest + '/portable-receipt.json', root + '/receipt-hardlink');
      if (kind === 'symlink') { fs.renameSync(dest + '/pi', dest + '/other'); fs.symlinkSync('other', dest + '/pi'); }
      if (kind === 'escaping-link') {
        put(root + '/outside', 'outside'); fs.symlinkSync('../outside', dest + '/escape');
        const receipt = JSON.parse(fs.readFileSync(dest + '/portable-receipt.json'));
        receipt.outputs.push({ path: 'escape', link: '../outside' });
        const bytes = JSON.stringify(receipt); put(dest + '/portable-receipt.json', bytes); prepared.receiptSha256 = hash(bytes);
      }
      assert.throws(() => acceptPrepared(prepared, dest), /trusted|unsafe|identity|unreceipted/, kind);
    }
    const chained = root + '/chained-generation', chainedPrepared = complete(chained);
    put(root + '/outside', 'external target');
    put(chained + '/outside', 'internal decoy');
    fs.symlinkSync('.', chained + '/a');
    fs.symlinkSync('a/../outside', chained + '/0-escape');
    const chainedReceipt = JSON.parse(fs.readFileSync(chained + '/portable-receipt.json'));
    chainedReceipt.outputs.push(
      { path: 'outside', mode: 0o600, sha256: hash('internal decoy') },
      { path: 'a', link: '.' },
      { path: '0-escape', link: 'a/../outside' }
    );
    const chainedBytes = JSON.stringify(chainedReceipt);
    put(chained + '/portable-receipt.json', chainedBytes);
    chainedPrepared.receiptSha256 = hash(chainedBytes);
    assert.equal(fs.realpathSync.native(chained + '/0-escape'), root + '/outside');
    assert.throws(() => acceptPrepared(chainedPrepared, chained), /unsafe portable generation link/);
    const lazy = fixture('lazy');
    put(path.join(lazy.dir, 'pi/portable/files.json'), JSON.stringify({ schema: 1, files: ['pi/portable/assemble.mjs', 'pi/portable/companion.mjs'] }));
    put(path.join(lazy.dir, 'pi/portable/assemble.mjs'), "import { value } from './companion.mjs'; export async function assemble(dest,evidence,options) {return {dest,value,options};}");
    put(path.join(lazy.dir, 'pi/portable/companion.mjs'), "export const value='captured';");
    const expectedAcquisition = acquisition(lazy.home);
    const rootsFile = lazy.home + '/.local/share/vertrice-pi/build-inputs/roots.json';
    put(rootsFile, JSON.stringify({ ...expectedAcquisition, toolRoot: '/foreign/tool' }));
    const invalidRoots = loadInputs(lazy.home, true);
    await assert.rejects(invalidRoots.preparePi(root + '/unused', root, undefined, {installFirst:true}), /acquisition roots unavailable or invalid/);
    put(rootsFile, JSON.stringify(expectedAcquisition));
    const lazyFiles = ['pi/portable/assemble.mjs', 'pi/portable/companion.mjs', 'pi/portable/admission.mjs', 'pi/acquire/inputs.json', 'pi/acquire/registry.mjs'];
    put(path.join(lazy.dir, 'pi/portable/files.json'), JSON.stringify({schema:1,files:lazyFiles}));
    put(path.join(lazy.dir, 'pi/portable/admission.mjs'), 'export function admittedProject() {}');
    put(path.join(lazy.dir, 'pi/acquire/inputs.json'), JSON.stringify({pristine:{manifest:'pi-package.json',lock:'pi-package-lock.json'}}));
    const lazyPristine = lazy.home + '/.local/share/vertrice-pi/build-inputs/pristine/project';
    put(lazyPristine + '/node_modules/' + pkg + '/package.json', '{"version":"1.6.0"}');
    for (const gate of ['graph','signatures','scan']) put(path.join(path.dirname(lazyPristine),gate+'.json'), '{"status":"clean"}');
    put(path.join(lazy.dir, 'pi/acquire/registry.mjs'), `import fs from 'node:fs';import path from 'node:path';export async function acquireRegistryProject({destination}) {fs.mkdirSync(destination);const project=destination+'/project';fs.mkdirSync(project);fs.mkdirSync(project+'/node_modules/@earendil-works/pi-coding-agent',{recursive:true});fs.writeFileSync(project+'/node_modules/@earendil-works/pi-coding-agent/package.json','{"version":"1.6.0"}');for(const gate of ['graph','signatures','scan'])fs.writeFileSync(destination+'/'+gate+'.json','{"status":"clean"}');return {project};}`);
    const captured = loadInputs(lazy.home, true);

    put(path.join(lazy.dir, 'pi/portable/companion.mjs'), 'throw Error("late deployed source executed");');
    for (const name of ['board', 'messenger', 'resource', 'tool']) fs.mkdirSync(path.join(lazy.home, '.local/share/vertrice-pi/build-inputs', name, ...(name === 'tool' ? ['node_modules', 'esbuild'] : [])), { recursive: true });
    const evidence = root + '/snapshot-evidence'; fs.mkdirSync(evidence);
    const result = await captured.preparePi(root + '/unused', evidence, undefined, {installFirst:true});
    assert.equal(result.value, 'captured'); assert.equal(result.options.home, lazy.home);
    assert.equal(result.options.resourceRoot, lazy.home + '/.pi/agent');
    assert.equal(result.options.toolRoot, path.join(lazy.home, '.local/share/vertrice-pi/build-inputs/tool/project/node_modules/esbuild'));
    assert.equal(result.options.boardRoot, path.join(lazy.home, '.local/share/vertrice-pi/build-inputs/board'));
    const routineEvidence = root + '/routine-evidence'; fs.mkdirSync(routineEvidence);
    const routine = await captured.preparePi(root + '/routine-unused', routineEvidence);
    assert.equal(routine.pristineRoot, routineEvidence + '/pristine/project');
    assert.equal(routine.gateEvidence.signatures.status, 'clean');
    assert.equal(result.pristineRoot, expectedAcquisition.pristineRoot);
    const actual = fixture('actual');
    const installedData = path.join(repo, '.local/share/openbsd');
    const productionManifestFile = path.join(installedData, 'pi/portable/files.json');
    const productionManifest = JSON.parse(fs.readFileSync(productionManifestFile));
    for (const file of new Set(['pi/portable/files.json', ...productionManifest.files]))
      put(path.join(actual.dir, file), fs.readFileSync(path.join(installedData, file)));
    acquisition(actual.home);
    const actualInputs = loadInputs(actual.home, true);
    assert.equal(typeof actualInputs.identities.piStrategy, 'string', 'production recipe manifest must capture successfully');
    for (const name of ['board', 'messenger', 'resource', 'tool']) fs.mkdirSync(path.join(actual.home, '.local/share/vertrice-pi/build-inputs', name, ...(name === 'tool' ? ['node_modules', 'esbuild'] : [])), { recursive: true });
    const actualEvidence = root + '/actual-evidence', generations = root + '/actual-generations';
    fs.mkdirSync(actualEvidence); fs.mkdirSync(generations);
    await assert.rejects(actualInputs.preparePi(generations + '/candidate', actualEvidence, undefined, {installFirst:true}), /Portable complete generation unavailable|reviewed portable input identity missing|ENOENT/);
    assert(!fs.existsSync(generations + '/candidate'));
    let trial = await appTrial('fresh', { installFirst: true });
    assert.ifError(trial.error); assert.equal(trial.attempt.outcome, 'installed');
    assert.equal(fs.realpathSync(trial.current), trial.attempt.candidate.dest);
    assert.equal(fs.readFileSync(trial.app + '/profile/AGENTS.md', 'utf8'), 'generic native stub\n');
    assert.equal(fs.readFileSync(trial.app + '/profile/auth.json', 'utf8'), '{}\n');
    assert.equal(fs.statSync(trial.app + '/profile/auth.json').mode & 0o777, 0o600);
    assert.deepEqual(trial.events, ['graph', 'signatures', 'scan', 'assemble']);
    trial = await appTrial('prepare', { prepareOnly: true });
    assert.ifError(trial.error); assert.equal(trial.attempt.outcome, 'prepared'); assert(!fs.existsSync(trial.current));
    trial = await appTrial('ordinary', {});
    assert.ifError(trial.error); assert.equal(trial.attempt.outcome, 'prepared'); assert(!fs.existsSync(trial.current));
    for (const [name, opts, match] of [
      ...['route', 'instance', 'missing-route', 'missing-instance'].map(routing => ['routing-' + routing, { routing, installFirst: true }, /binding mismatch|receipted regular/]),
      ...['missing', 'agentDir', 'nativeAgentDir', 'nativeAuthStorage', 'runtimeRoot', 'immutableResourceDir', 'launcher'].map(bindings => ['binding-' + bindings, { bindings, installFirst: true }, /binding mismatch/]),
      ['existing', { existing: true, installFirst: true }, /refuses existing/],
      ['graph', { graph: 'unknown' }, /graph gate blocked/],
      ['signature', { signatures: 'unknown' }, /signatures gate blocked/],
      ['scanner', { scan: 'incomplete' }, /scan gate blocked/],
      ['recipe', { failure: true }, /missing resource/],
      ['incomplete', { incomplete: true, installFirst: true }, /complete launchable/],
      ['drift', { drift: true, installFirst: true }, /identity mismatch/],
      ['version', { version: '1.6.1' }, /needs-port/],
      ['race', { race: true, installFirst: true }, /selector drift|ENOENT/],
    ]) {
      trial = await appTrial(name, opts); assert(trial.error, name); assert.match(trial.error.message, match);
      if (name !== 'race') assert(!fs.existsSync(trial.current));
      assert(!fs.existsSync(trial.app + '/profile'), name + ' created profile');
      if (['existing', 'graph', 'signature', 'scanner', 'version'].includes(name)) assert(!trial.events.includes('assemble'));
      if (name === 'race') assert.equal(fs.readlinkSync(trial.current), 'competitor');
    }
    assert.throws(() => acceptPrepared({ complete: false }, '/unused'), /complete launchable/);
    assert.equal(parseOptions(['--pi', '--install-first']).installFirst, true);
    assert.throws(() => parseOptions(['--install-first']), /require --pi/);
    assert.throws(() => parseOptions(['--pi', '--install-first', '--prepare']), /cannot prepare/);
    const wrapperHome = root + '/wrapper', app = wrapperHome + '/.local/share/vertrice-pi';
    put(app + '/generations/portable/pi', '#!/bin/sh\nprintf "%s\\n" "$PI_SELF_UPDATE_COMMAND"\n', 0o700);
    put(app + '/node_modules/.bin/pi', '#!/bin/sh\necho WRONG\n', 0o700);
    fs.symlinkSync('generations/portable', app + '/current');
    let r = spawnSync('/bin/sh', [repo + '/.local/bin/openbsd/pi'], { env: { HOME: wrapperHome, PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), wrapperHome + '/.local/bin/openbsd/vertrice-update --pi');
    fs.unlinkSync(app + '/generations/portable/pi'); fs.symlinkSync('absent', app + '/generations/portable/pi');
    r = spawnSync('/bin/sh', [repo + '/.local/bin/openbsd/pi'], { env: { HOME: wrapperHome, PATH: process.env.PATH }, encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert(!r.stdout.includes('WRONG'));
    console.log('PASS portable updater: lazy captured import closure; actual incomplete recipe clean refusal; first-only receipt publication; prepare retention; gates; native version; selector race; wrapper no bypass');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
