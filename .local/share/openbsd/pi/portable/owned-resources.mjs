// Bounded, best-effort observation of reviewed inputs, not atomic load identity.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const states = new WeakMap();
const hash = value => createHash('sha256').update(value).digest('hex');
const trees = ['extensions', 'skills', 'prompts', 'themes'];
const files = ['AGENTS.md', 'SYSTEM.md', 'APPEND_SYSTEM.md', 'work-store.mjs', 'context/manifest.json'];
const excluded = relative => relative.split(path.sep).some(name => name === 'node_modules' || name === '.git' || /^(auth|accounts?|settings|tasks?|logs?|sessions?)(\.|$)/i.test(name));
// Check every ancestor before opening a leaf, including ancestors of agentDir.
function noLinks(file) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Owned resource symlink blocked: ${current}`); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
  }
}
function boundedRead(file, budget) {
  noLinks(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`Unsupported owned resource: ${file}`);
    const chunks = [];
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, budget.left + 1));
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!n) return Buffer.concat(chunks);
      budget.left -= n;
      if (budget.left < 0) throw new Error('Owned resource byte limit exceeded');
      chunks.push(buffer.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
}
export function observeOwned(root) {
  noLinks(root);
  const entries = [], budget = { left: 16 * 1024 * 1024 };
  let count = 0, manifestBytes;
  function visit(relative, recursive = false) {
    const full = path.join(root, relative);
    noLinks(full);
    let stat;
    try { stat = fs.lstatSync(full); } catch (e) {
      if (e.code === 'ENOENT') { entries.push([relative, 'missing']); return; }
      throw e;
    }
    if (++count > 2000) throw new Error('Owned resource file limit exceeded');
    if (stat.isDirectory() && recursive) {
      entries.push([relative, 'directory']);
      const dir = fs.opendirSync(full);
      try {
        let entry;
        while ((entry = dir.readSync())) {
          // Count even excluded entries: directory enumeration itself is bounded.
          if (++count > 2000) throw new Error('Owned resource file limit exceeded');
          const name = entry.name;
          if (excluded(name)) continue;
          visit(path.join(relative, name), true);
        }
      } finally { dir.closeSync(); }
    } else if (stat.isFile()) {
      const data = boundedRead(full, budget);
      if (relative === 'context/manifest.json') manifestBytes = data;
      entries.push([relative, hash(data)]);
    } else throw new Error(`Unsupported owned resource: ${relative}`);
  }
  for (const name of trees) visit(name, true);
  for (const name of files) visit(name);
  if (manifestBytes) {
    const data = JSON.parse(manifestBytes.toString('utf8'));
    if (data.schema !== 1 || !Array.isArray(data.files) || data.files.length > 100) throw new Error('Invalid context manifest');
    for (const item of data.files) {
      if (typeof item.path !== 'string' || !/^[a-zA-Z0-9_./-]+\.md$/.test(item.path) || path.isAbsolute(item.path) || item.path.split('/').includes('..')) throw new Error('Invalid context path');
      if (excluded(item.path)) continue;
      visit(item.path);
      if (entries.at(-1)[1] !== item.sha256) throw new Error('Context changed since manifest generation; refresh package index');
    }
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return { selected: new Set(entries.filter(([, value]) => value !== 'missing').map(([name]) => name)),
    fingerprint: hash(JSON.stringify(entries)), topology: hash(JSON.stringify(entries.map(([name, value]) => [name, value === 'missing' ? 'missing' : 'present']))) };
}
function loaderInputs(loader) {
  const budget = { left: 1024 * 1024 };
  return hash(JSON.stringify([path.join(loader.agentDir, 'settings.json'), path.join(loader.cwd, '.pi/settings.json'), path.join(loader.agentDir, 'package.json')].map(file => {
    try { return [file, hash(boundedRead(file, budget))]; } catch (e) { if (e.code === 'ENOENT') return [file, null]; throw e; }
  })));
}
const helperFile = fileURLToPath(import.meta.url);
const loadedHelperHash = hash(boundedRead(helperFile, { left: 1024 * 1024 }));
function externalReason(loader, observation) {
  if (hash(boundedRead(helperFile, { left: 1024 * 1024 })) !== loadedHelperHash) return 'Automatic reload unavailable: native owned-resources helper changed; restart this generation.';
  const root = path.resolve(loader.agentDir);
  function owned(file) {
    if (typeof file !== 'string') return false;
    if (file.startsWith('builtin:')) return true;
    const absolute = path.resolve(loader.cwd, file);
    const relative = path.relative(root, absolute);
    // Eligibility is exact observation membership, never merely a tree prefix.
    // Check all ancestors even for explicitly selected context/helper paths.
    if (excluded(relative) || !observation.selected.has(relative)) return false;
    noLinks(absolute);
    return true;
  }
  const inputs = [...(loader.agentsFiles ?? []).map(r => r.path), loader.systemPromptSourcePath,
    ...(loader.appendSystemPromptSourcePaths ?? []), ...(loader.lastSkillPaths ?? []), ...(loader.lastPromptPaths ?? []), ...(loader.lastThemePaths ?? []),
    ...(loader.getExtensions().extensions ?? []).map(e => e.path),
    ...(loader.additionalExtensionPaths ?? []), ...(loader.additionalSkillPaths ?? []), ...(loader.additionalPromptTemplatePaths ?? []), ...(loader.additionalThemePaths ?? [])].filter(Boolean);
  for (const resolved of Object.values(loader._ownedPaths ?? {})) {
    for (const kind of trees) for (const resource of resolved[kind] ?? []) {
      if (resource.enabled !== false) {
        if (resource.metadata?.packageRoot) return 'Automatic reload unavailable: external package resources; use /reload.';
        inputs.push(resource.path);
      }
    }
  }
  for (const source of [loader.systemPromptSource, ...(loader.appendSystemPromptSource ?? [])]) {
    if (typeof source === 'string' && fs.existsSync(source)) inputs.push(path.resolve(source));
  }
  // Check only native discovery locations, never walk project contents/import closures.
  if (!loader.noContextFiles) {
    const candidates = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];
    for (const name of candidates) if (fs.existsSync(path.join(root, name))) inputs.push(path.join(root, name));
    let dir = path.resolve(loader.cwd);
    for (let n = 0; ; n++) {
      if (n > 100) return 'Automatic reload unavailable: context ancestor limit; use /reload.';
      for (const name of candidates) if (fs.existsSync(path.join(dir, name))) inputs.push(path.join(dir, name));
      const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
    }
  }
  for (const method of ['discoverSystemPromptFile', 'discoverAppendSystemPromptFile']) {
    const file = loader[method]?.(); if (file) inputs.push(file);
  }
  if (inputs.length > 2000 || inputs.some(file => !owned(file))) return 'Automatic reload unavailable: non-owned resource/context inputs; use /reload.';
  if (loader.extensionFactories?.length || ['extensionsOverride', 'skillsOverride', 'promptsOverride', 'themesOverride', 'agentsFilesOverride', 'systemPromptOverride', 'appendSystemPromptOverride'].some(key => loader[key])) return 'Automatic reload unavailable: custom resource overrides; use /reload.';
}
export function captureOwnedPaths(loader) {
  const state = states.get(loader);
  if (state) state.pendingTrust = loader.settingsManager.isProjectTrusted();
}
function diagnostics(loader) {
  return [...loader.getExtensions().errors.map(e => `${e.path}: ${e.error}`),
    ...[loader.getSkills(), loader.getPrompts(), loader.getThemes()].flatMap(r => r.diagnostics.filter(d => d.type === 'error').map(d => `${d.path}: ${d.message}`))];
}
export function ownedStatus(loader) {
  const state = states.get(loader);
  try {
    const current = observeOwned(loader.agentDir);
    return { baseline: state?.baseline, current: current.fingerprint, dirty: !!state?.dirty, failed: !!state?.dirty && state?.failed === current.fingerprint,
      blocked: state?.dirty && state?.failed === current.fingerprint ? 'Previous native reload failed; edit the resources or use /reload.' : !state?.baseline ? 'No successful native owned-resource baseline; use /reload.' :
        externalReason(loader, current) ?? (loaderInputs(loader) !== state.inputs || loader.settingsManager.isProjectTrusted() !== state.trust ? 'Loader inputs changed; use /reload.' :
        current.topology !== state.topology ? 'Owned resource paths changed; use /reload.' : undefined) };
  } catch (e) { return { baseline: state?.baseline, dirty: !!state?.dirty, blocked: String(e.message) }; }
}
export function preflightOwned(loader) {
  const status = ownedStatus(loader);
  if (status.blocked) throw new Error(status.blocked);
}
export function beginOwned(loader, automatic) {
  if (automatic) preflightOwned(loader);
  let before, inputs;
  try { before = observeOwned(loader.agentDir); inputs = loaderInputs(loader); }
  catch (e) { if (automatic) throw e; }
  states.set(loader, { ...states.get(loader), before, pendingInputs: inputs, dirty: true });
}
export function failOwned(loader) {
  const state = states.get(loader);
  // Suppress only the attempted bytes, never a later edit made during failure.
  states.set(loader, { ...state, dirty: true, failed: state?.before?.fingerprint });
}
export function finishOwned(loader, strict = false, runtimeErrors = []) {
  const state = states.get(loader);
  try {
    const errors = [...diagnostics(loader), ...runtimeErrors];
    if (errors.length) throw new Error(`Resource loading diagnostics: ${errors.join('; ')}`);
    const after = observeOwned(loader.agentDir);
    if (!state?.before || state.before.fingerprint !== after.fingerprint || state.pendingInputs !== loaderInputs(loader) || state.pendingTrust !== loader.settingsManager.isProjectTrusted()) throw new Error('Resources changed while loading; use /reload.');
    states.set(loader, { ...state, baseline: after.fingerprint, topology: after.topology, inputs: state.pendingInputs, trust: state.pendingTrust, dirty: false, failed: undefined });
  } catch (e) { failOwned(loader); if (strict) throw e; }
}
// Called once at native TUI startup, after its initial settings persistence.
export function finalizeOwnedStartup(loader) {
  const state = states.get(loader);
  if (state?.baseline && !state.dirty) {
    try {
      if (observeOwned(loader.agentDir).fingerprint !== state.baseline) throw new Error('Owned resources changed during startup; use /reload.');
      state.inputs = loaderInputs(loader);
    } catch { failOwned(loader); }
  }
}
