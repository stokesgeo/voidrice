import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireRegistryProject, createAttempt, projectManifest, sha256, inventory, verified } from './registry.mjs';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-acquire-tests-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
test('all admitted npm phases disable lifecycle scripts and select public registry', async () => {
  const { default: admission } = await import('../../npm-admission.cjs');
  for (const phase of ['lookup', 'resolution', 'ci']) {
    const args = admission.cliArgs(phase, '/fixture', 'fixture@1.0.0');
    assert(args.includes('--ignore-scripts'));
    assert(args.includes('--registry=https://registry.npmjs.org'));
    assert(args.includes('--allow-git=none'));
    assert(args.includes('--strict-ssl=true'));
  }
});
test('portable Board admits only exact production dependencies without SDK or development tools', () => {
  const here = new URL('./', import.meta.url);
  const upstream = JSON.parse(projectManifest(fs.readFileSync(new URL('board-upstream-package.json', here))));
  assert.deepEqual(upstream.dependencies, { '@xterm/headless': '^6.0.0', 'node-pty': '^1.1.0' });
  const portable = fs.readFileSync(new URL('board-package.json', here));
  const pkg = JSON.parse(portable);
  assert.deepEqual(pkg.dependencies, { '@xterm/headless': '6.0.0', 'node-pty': '1.1.0' });
  for (const key of ['devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[key], undefined);
  const inputs = JSON.parse(fs.readFileSync(new URL('inputs.json', here))).board;
  assert.equal(sha256(portable), inputs.manifestSha256);
  const lockBytes = fs.readFileSync(new URL('board-package-lock.json', here));
  assert.equal(sha256(lockBytes), inputs.lockSha256);
  const lock = JSON.parse(lockBytes);
  for (const entry of Object.values(lock.packages)) { assert.notEqual(entry.version, '0.79.8'); assert(!entry.hasShrinkwrap); }
  assert.deepEqual(Object.keys(lock.packages).sort(), ['', 'node_modules/@xterm/headless', 'node_modules/node-addon-api', 'node_modules/node-pty']);
  assert.equal(sha256(fs.readFileSync(new URL('board-upstream-package-lock.json', here))), '166561355bd7a4678d22d19885a70eefaf5a707a43f527f6346bde42f545ac20');
});
test('projection preserves dependency declarations and excludes execution controls', () => {
  const source = { name: 'fixture', version: '1.0.0', dependencies: { a: '1.0.0' }, devDependencies: { b: '2.0.0' }, optionalDependencies: { c: '3.0.0' }, peerDependencies: { d: '*' }, engines: { node: '>=24' }, scripts: { install: 'false' } };
  const projected = JSON.parse(projectManifest(JSON.stringify(source)));
  for (const key of ['name', 'version', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'engines']) assert.deepEqual(projected[key], source[key]);
  assert.equal(projected.scripts, undefined);
  assert.equal(projected.workspaces, undefined);
});
test('projection rejects resolution, publish, and bundled controls', () => {
  for (const key of ['workspaces', 'overrides', 'resolutions', 'bundleDependencies', 'bundledDependencies', 'config', 'publishConfig', 'link', 'inBundle']) assert.throws(() => projectManifest(JSON.stringify({ name: 'fixture', [key]: true })), /unsupported projection control/);
});
test('projection explicitly excludes only publish-only public access metadata', () => {
  assert.deepEqual(JSON.parse(projectManifest(JSON.stringify({ name: 'board', publishConfig: { access: 'public' } }))), { name: 'board' });
  for (const publishConfig of [{ registry: 'https://example.invalid' }, { access: 'public', registry: 'https://registry.npmjs.org' }, { access: 'restricted' }, null]) assert.throws(() => projectManifest(JSON.stringify({ publishConfig })), /publishConfig/);
});
test('source rejects hardlinks, writable files and symlink ancestors', () => {
  const file = path.join(scratch, 'trusted'); fs.writeFileSync(file, '{}', { mode: 0o600 });
  const hash = sha256(fs.readFileSync(file));
  const alias = path.join(scratch, 'hardlink'); fs.linkSync(file, alias);
  assert.throws(() => verified(file, hash), /single-link/); fs.unlinkSync(alias);
  fs.chmodSync(file, 0o666); assert.throws(() => verified(file, hash), /writable/); fs.chmodSync(file, 0o600);
  const link = path.join(scratch, 'ancestor'); fs.symlinkSync(scratch, link);
  assert.throws(() => verified(path.join(link, 'trusted'), hash), /link/);
});
test('fresh attempt refuses existing destination and strips inherited authentication and Node environment', () => {
  const attempt = createAttempt(path.join(scratch, 'fresh'));
  assert.throws(() => createAttempt(attempt.destination));
  assert.equal(attempt.env.NODE_OPTIONS, undefined);
  assert.equal(attempt.env.NODE_PATH, undefined);
  assert.equal(attempt.env.NPM_TOKEN, undefined);
  assert.equal(attempt.env.NPM_CONFIG_USERCONFIG, '/dev/null');
  assert.equal(attempt.env.HOME, path.join(attempt.destination, 'home'));
  assert.equal(fs.statSync(attempt.destination).mode & 0o777, 0o700);
});
test('scan duration accepts only the existing scanner bound', async () => {
  for (const scanSeconds of [0, -1, 3601, 1.5, '3600', Infinity]) await assert.rejects(acquireRegistryProject({ scanSeconds }), /invalid scan duration bound/);
});
test('source hash failure precedes destination creation and npm', async () => {
  const file = path.join(scratch, 'manifest.json');
  fs.writeFileSync(file, '{}');
  const destination = path.join(scratch, 'refused');
  await assert.rejects(acquireRegistryProject({ destination, manifest: file, manifestSha256: '0'.repeat(64), resolve: true }), /source hash mismatch/);
  assert.equal(fs.existsSync(destination), false);
});
test('graph, signature, scan failures and scan drift never produce receipts', async () => {
  const sourcePath = new URL('./registry.mjs', import.meta.url);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const base = new URL('../../', import.meta.url);
  const fixtureSource = source.replace("'../../npm-admission.cjs'", JSON.stringify(new URL('npm-admission.cjs', base).pathname)).replace("'../../security-checks.cjs'", JSON.stringify(new URL('security-checks.cjs', base).pathname)).replace("  run(attempt, phase, node, [snapshot, npm, phase, attempt.project, input]);", "  fs.writeFileSync(path.join(attempt.destination, phase + '-called'), '');");
  const modulePath = path.join(scratch, 'fixture.mjs'); fs.writeFileSync(modulePath, fixtureSource);
  const fixture = await import(modulePath);
  const latePath = path.join(scratch, 'late-fixture.mjs');
  fs.writeFileSync(latePath, fixtureSource.replace('  checkInputs();\n  const files = inventory(attempt.project);', "  fs.writeFileSync(path.join(attempt.project, 'late-drift'), 'changed');\n  checkInputs();\n  const files = inventory(attempt.project);"));
  const lateFixture = await import(latePath);
  const { default: security } = await import(new URL('security-checks.cjs', base));
  const saved = { graph: security.graph, signatures: security.signatures, scan: security.scan };
  const manifest = path.join(scratch, 'gate-package.json'), lock = path.join(scratch, 'gate-lock.json');
  fs.writeFileSync(manifest, '{}', { mode: 0o600 }); fs.writeFileSync(lock, '{}', { mode: 0o600 });
  try {
    for (const failure of ['graph', 'malicious', 'signatures', 'scan', 'drift']) {
      const destination = path.join(scratch, 'gate-' + failure);
      security.graph = async () => ({ status: failure === 'graph' ? 'unknown' : failure === 'malicious' ? 'malicious' : 'clean' });
      security.signatures = () => ({ status: failure === 'signatures' ? 'invalid' : 'clean' });
      security.scan = () => { if (failure === 'drift') fs.writeFileSync(path.join(destination, 'project/changed'), 'drift'); return { status: failure === 'scan' ? 'database-stale' : 'clean' }; };
      await assert.rejects(fixture.acquireRegistryProject({ destination, manifest, manifestSha256: sha256(fs.readFileSync(manifest)), lock, lockSha256: sha256(fs.readFileSync(lock)) }));
      assert.equal(fs.existsSync(path.join(destination, 'receipt.json')), false);
      if (['graph', 'malicious'].includes(failure)) assert.equal(fs.existsSync(path.join(destination, 'ci-called')), false);
      if (failure === 'signatures') assert.equal(fs.existsSync(path.join(destination, 'scan.json')), false);
    }
    security.graph = async () => ({ status: 'advisories', audit: { status: 'advisories', counts: { high: 1 } }, osv: { status: 'advisories', advisories: ['GHSA-fixture'] } });
    security.signatures = () => ({ status: 'clean' });
    let observedScanSeconds;
    security.scan = (paths, options) => { observedScanSeconds = options.seconds; return { status: 'clean' }; };
    const advisoryDestination = path.join(scratch, 'known-advisories');
    const accepted = await fixture.acquireRegistryProject({ destination: advisoryDestination, scanSeconds: 3600, manifest, manifestSha256: sha256(fs.readFileSync(manifest)), lock, lockSha256: sha256(fs.readFileSync(lock)) });
    assert.equal(observedScanSeconds, 3600);
    assert.equal(accepted.receipt.gates.graph.status, 'advisories');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(advisoryDestination, 'graph.json'))).osv.advisories, ['GHSA-fixture']);
    const lateDestination = path.join(scratch, 'late-drift');
    await assert.rejects(lateFixture.acquireRegistryProject({ destination: lateDestination, manifest, manifestSha256: sha256(fs.readFileSync(manifest)), lock, lockSha256: sha256(fs.readFileSync(lock)) }), /final installed tree changed/);
    assert.equal(fs.existsSync(path.join(lateDestination, 'receipt.json')), false);
  } finally { Object.assign(security, saved); }
});
test('inventory binds bytes, modes, and links and refuses escaping links', () => {
  const root = path.join(scratch, 'tree'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'file'), 'a', { mode: 0o600 });
  fs.symlinkSync('file', path.join(root, 'link'));
  const before = sha256(JSON.stringify(inventory(root)));
  fs.chmodSync(path.join(root, 'file'), 0o700);
  assert.notEqual(sha256(JSON.stringify(inventory(root))), before);
  fs.symlinkSync('/etc/passwd', path.join(root, 'escape'));
  assert.throws(() => inventory(root), /leaves project/);
});
