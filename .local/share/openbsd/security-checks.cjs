'use strict';
// Unprivileged checks only. No fixes, quarantine, deletion, or dependency execution.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const registry = 'https://registry.npmjs.org';
const nameRE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const versionRE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const unknown = detail => ({ status: 'unknown', detail });
const declarationFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
function identities(lock) {
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages?.['']) throw Error('unsupported lock');
  const found = new Map(), byLocation = new Map(), aliases = new Set(), referenced = new Set();
  for (const [location, p] of Object.entries(lock.packages)) {
    if (!location) continue;
    if (!p || p.link || p.inBundle || !versionRE.test(p.version) || typeof p.resolved !== 'string')
      throw Error('excluded or unresolved lock entry');
    const parts = location.split('node_modules/');
    const local = parts.pop();
    if (parts[0] !== '' || !nameRE.test(local) || parts.slice(1).some(x => !nameRE.test(x.slice(0, -1))))
      throw Error('ambiguous lock location');
    const u = new URL(p.resolved);
    if (u.origin !== registry || u.username || u.password || u.search || u.hash || !p.resolved.startsWith(registry + '/'))
      throw Error('non-public registry identity');
    const pathname = decodeURIComponent(u.pathname);
    const match = pathname.match(/^\/((?:@[^/]+\/)?[^/]+)\/-\/([^/]+)\.tgz$/);
    if (!match || !nameRE.test(match[1])) throw Error('ambiguous tarball identity');
    const name = match[1];
    if (match[2] !== name.split('/').pop() + '-' + p.version ||
        (p.name !== undefined && p.name !== name) || (local !== name && p.name !== name))
      throw Error('lock name/version mismatch (aliases require explicit name)');
    byLocation.set(location, { name, local });
    found.set(name + '@' + p.version, { name, version: p.version });
  }
  // Audit can also read dependency declarations. Reject nonregistry specs even
  // when a superficially public resolved record has been placed beside them.
  for (const [location, p] of Object.entries(lock.packages)) {
    for (const field of declarationFields) {
      if (p[field] === undefined) continue;
      if (!p[field] || typeof p[field] !== 'object' || Array.isArray(p[field])) throw Error('invalid dependency edges');
      for (const [local, spec] of Object.entries(p[field])) {
        if (!nameRE.test(local) || typeof spec !== 'string') throw Error('invalid dependency spec');
        const alias = spec.match(/^npm:((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@(.+))?$/);
        const range = alias ? (alias[2] || 'latest') : spec;
        if (!/^[a-zA-Z0-9.*~^<>=|+ -]+$/.test(range)) throw Error('nonregistry dependency spec');
        let parent = location, target;
        for (;;) {
          const key = (parent ? parent + '/' : '') + 'node_modules/' + local;
          if (byLocation.has(key)) { target = key; break; }
          if (!parent) break;
          const at = parent.lastIndexOf('/node_modules/');
          parent = at < 0 ? '' : parent.slice(0, at);
        }
        if (target) {
          referenced.add(target);
          if (byLocation.get(target).name !== (alias ? alias[1] : local)) throw Error('edge/registry identity mismatch');
          if (alias) aliases.add(target);
        } else if (alias || ['dependencies', 'devDependencies'].includes(field)) throw Error('unresolved dependency edge');
      }
    }
  }
  for (const [location, id] of byLocation) {
    if (!referenced.has(location)) throw Error('unreferenced lock identity');
    if (id.name !== id.local && !aliases.has(location)) throw Error('unverified alias identity');
  }
  if (!found.size) throw Error('empty dependency graph');
  return [...found.values()].sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));
}
function command(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, ...options });
}
function auditResult(r) {
  try {
    const j = JSON.parse(r.stdout);
    if (r.error || ![0, 1].includes(r.status) || j.error || j.auditReportVersion !== 2 ||
        !j.vulnerabilities || typeof j.vulnerabilities !== 'object' || Array.isArray(j.vulnerabilities) ||
        !j.metadata?.vulnerabilities) return unknown('npm audit operational failure');
    const severities = ['info', 'low', 'moderate', 'high', 'critical'];
    const reportedCounts = j.metadata.vulnerabilities;
    for (const k of [...severities, 'total'])
      if (!Number.isSafeInteger(reportedCounts[k]) || reportedCounts[k] < 0) return unknown('malformed npm audit counts');
    const entries = Object.entries(j.vulnerabilities);
    if (severities.reduce((n, k) => n + reportedCounts[k], 0) !== reportedCounts.total)
      return unknown('inconsistent npm audit counts');
    if (entries.length !== reportedCounts.total || entries.some(([name, v]) => !v || v.name !== name ||
        !severities.includes(v.severity) || !Array.isArray(v.via) ||
        !Array.isArray(v.nodes) || !Array.isArray(v.effects) || typeof v.range !== 'string' ||
        v.nodes.some(n => typeof n !== 'string') || v.effects.some(n => typeof n !== 'string') ||
        v.via.some(a => typeof a !== 'string' && (!a || !Number.isSafeInteger(a.source) ||
          typeof a.name !== 'string' || typeof a.title !== 'string' || typeof a.range !== 'string'))))
      return unknown('incomplete npm audit vulnerabilities');
    // Count the full validated set, never the bounded display evidence below.
    const counts = Object.fromEntries(severities.map(k => [k, 0]));
    counts.total = entries.length;
    for (const [, v] of entries) counts[v.severity]++;
    if (severities.some(k => counts[k] !== reportedCounts[k])) return unknown('inconsistent npm audit severity counts');
    if ((r.status === 0) !== (counts.total === 0)) return unknown('inconsistent npm audit exit');
    return { status: counts.total ? 'advisories' : 'clean', counts,
      vulnerabilities: entries.slice(0, 100).map(([name, v]) => ({ name, severity: v.severity, range: v.range })) };
  } catch { return unknown('npm audit malformed output'); }
}
async function request(url, body) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
    // Synchronous npm/scanner children can defer idle-socket close processing.
    signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw Error('OSV HTTP failure');
  let text = '', size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw Error('OSV response limit');
    text += Buffer.from(chunk).toString('utf8');
  }
  return JSON.parse(text);
}
async function osv(ids, transport = request) {
  try {
    const active = new Set(), advisories = new Set(), records = new Map();
    // Sequential bounded batches and pagination, including continuation queries.
    let budget = 1000;
    for (let start = 0; start < ids.length; start += 100) {
      let pending = ids.slice(start, start + 100).map(id => ({ package: { name: id.name, ecosystem: 'npm' }, version: id.version }));
      const seen = new Set();
      while (pending.length) {
        if (--budget < 0) throw Error('OSV page bound');
        const j = await transport('https://api.osv.dev/v1/querybatch', { queries: pending });
        if (!Array.isArray(j.results) || j.results.length !== pending.length) throw Error('OSV partial results');
        const next = [];
        for (let i = 0; i < pending.length; i++) {
          const result = j.results[i];
          if (!result || typeof result !== 'object' || Array.isArray(result) ||
              Object.keys(result).some(k => !['vulns', 'next_page_token'].includes(k)) ||
              (result.vulns !== undefined && !Array.isArray(result.vulns))) throw Error('OSV malformed result');
          for (const v of result.vulns || []) {
            if (!v || typeof v.id !== 'string' || v.id.length > 200 || !/^[A-Za-z0-9._-]+$/.test(v.id) || (typeof v.modified !== 'string' || !Number.isFinite(Date.parse(v.modified))))
              throw Error('OSV malformed vulnerability');
            if (v.id.startsWith('MAL-')) {
              if (!records.has(v.id)) {
                if (--budget < 0) throw Error('OSV record bound');
                const full = await transport('https://api.osv.dev/v1/vulns/' + encodeURIComponent(v.id));
                if (full.id !== v.id || typeof full.modified !== 'string' || !Number.isFinite(Date.parse(full.modified)) ||
                    (full.withdrawn !== undefined && (typeof full.withdrawn !== 'string' || !Number.isFinite(Date.parse(full.withdrawn)))) ||
                    (!full.withdrawn && (!Array.isArray(full.affected) || !full.affected.length)) ||
                    (full.affected !== undefined && (!Array.isArray(full.affected) || full.affected.some(a => !a?.package ||
                      a.package.ecosystem !== 'npm' || !nameRE.test(a.package.name) ||
                      (!Array.isArray(a.ranges) && !Array.isArray(a.versions)) ||
                      (a.versions !== undefined && (!Array.isArray(a.versions) || a.versions.some(v => typeof v !== 'string'))) ||
                      (a.ranges !== undefined && (!Array.isArray(a.ranges) || a.ranges.some(r =>
                        !r || !['SEMVER', 'ECOSYSTEM', 'GIT'].includes(r.type) || !Array.isArray(r.events) || !r.events.length ||
                        r.events.some(e => !e || Object.keys(e).length !== 1 || Object.entries(e).some(([k, v]) =>
                          !['introduced', 'fixed', 'last_affected', 'limit'].includes(k) || typeof v !== 'string'))))) ||
                      !(a.versions?.length || a.ranges?.length)))))
                  throw Error('OSV malformed MAL record');
                records.set(v.id, full);
              }
              const full = records.get(v.id);
              if (!full.withdrawn && !full.affected.some(a => a.package.name === pending[i].package.name)) throw Error('OSV MAL identity mismatch');
              if (!full.withdrawn) active.add(v.id);
            } else advisories.add(v.id);
          }
          if (result.next_page_token !== undefined) {
            if (typeof result.next_page_token !== 'string' || !result.next_page_token) throw Error('OSV invalid page');
            const q = { ...pending[i], page_token: result.next_page_token };
            const key = JSON.stringify(q);
            if (seen.has(key)) throw Error('OSV repeated page');
            seen.add(key); next.push(q);
          }
        }
        pending = next;
      }
    }
    return { status: active.size ? 'malicious' : advisories.size ? 'advisories' : 'clean',
      malicious: [...active].sort().slice(0, 100), advisories: [...advisories].sort().slice(0, 100),
      maliciousCount: active.size, advisoryCount: advisories.size };
  } catch { return unknown('OSV unavailable, malformed, or incomplete'); }
}
function inputPreflight(dir, ancestors = false, installedDependency = false) {
  for (let p = fs.realpathSync(dir);; p = path.dirname(p)) {
    for (const name of ['npm-shrinkwrap.json', '.npmrc'])
      try { fs.lstatSync(path.join(p, name)); throw Error('unexpected npm input'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    const file = path.join(p, 'package.json');
    if (!installedDependency && fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).workspaces !== undefined)
      throw Error('workspace input');
    if (!ancestors || p === path.dirname(p)) break;
  }
}
// npm reads only this private project, never the original project or its parents.
function isolated(dir, npm, args, env, tree = false, validated) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vertrice-audit-'));
  try {
    fs.chmodSync(scratch, 0o700);
    for (const file of ['package.json', 'package-lock.json']) {
      if (validated) fs.writeFileSync(path.join(scratch, file), JSON.stringify(validated[file]), { mode: 0o600 });
      else fs.copyFileSync(path.join(dir, file), path.join(scratch, file));
    }
    if (tree) fs.cpSync(path.join(dir, 'node_modules'), path.join(scratch, 'node_modules'), { recursive: true });
    if (tree) {
      // npm's hidden lock is not the validated retained lock. Force actual-tree loading.
      fs.rmSync(path.join(scratch, 'node_modules/.package-lock.json'), { force: true });
      inputPreflight(scratch); installedGraph(scratch, true);
    }
    const config = path.join(scratch, 'empty-config');
    fs.writeFileSync(config, '', { mode: 0o600 });
    // npm 11's workspace exclusion filter also drops root signature edges.
    // Root/ancestor workspaces were rejected; ignored dependency declarations
    // were removed from this copy. Do not activate that filter.
    return command(npm, [...args, '--prefix=' + scratch, ...(tree ? [] : ['--workspaces=false']), '--include=dev',
      '--include=optional', '--include=peer', '--ignore-scripts', '--registry=' + registry], {
      cwd: scratch, env: { PATH: env.PATH, HOME: scratch, CI: '1',
        NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: config,
        NPM_CONFIG_CACHE: path.join(scratch, 'cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
    });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
async function graph(dir, npm, env, transport) {
  let ids, validated;
  try {
    inputPreflight(dir);
    const file = path.join(dir, 'package-lock.json');
    if (fs.statSync(file).size > 32 * 1024 * 1024) throw Error('lock size bound');
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const field of declarationFields) {
      const actual = Object.entries(manifest[field] || {}).sort(([a], [b]) => a.localeCompare(b));
      const retained = Object.entries(lock.packages?.['']?.[field] || {}).sort(([a], [b]) => a.localeCompare(b));
      if (JSON.stringify(actual) !== JSON.stringify(retained)) throw Error('manifest/lock mismatch');
    }
    ids = identities(lock);
    validated = { 'package.json': manifest, 'package-lock.json': lock };
  }
  catch { return { status: 'unknown', identity: unknown('graph not completely public/resolved; no audit/OSV sent') }; }
  let audit;
  try { audit = auditResult(isolated(dir, npm, ['audit', '--json', '--package-lock-only'], env, false, validated)); }
  catch { audit = unknown('isolated npm audit failed'); }
  const osvResult = await osv(ids, transport);
  return { status: osvResult.status === 'malicious' ? 'malicious' : [audit, osvResult].some(x => x.status === 'unknown') ? 'unknown' :
    [audit, osvResult].some(x => x.status === 'advisories') ? 'advisories' : 'clean', audit, osv: osvResult };
}
// Signature audit loads the actual tree, unlike --package-lock-only. Validate
// its manifests too: a tarball must not introduce private specs or extra nodes.
// npm 11.19 Arborist node.js loads dev edges only for tree tops (not these
// nonlinked dependency nodes). verify-signatures.js sends only resolved edge
// name/version metadata requests, not manifests. Remove ignored non-root dev
// declarations in the isolated copy as defense in depth, never from the source.
// load-actual.js maps workspaces only on the actual root; regular nonlinked
// installed nodes are not workspace roots. Strip their ignored workspaces too,
// including retained lock metadata, without changing root/ancestor guards.
function installedGraph(dir, sanitize = false) {
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  identities(lock);
  const root = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const field of declarationFields) {
    const entries = p => Object.entries(p[field] || {}).sort(([a], [b]) => a.localeCompare(b));
    if (JSON.stringify(entries(root)) !== JSON.stringify(entries(lock.packages[''])))
      throw Error('manifest/lock mismatch');
  }
  lock.packages[''] = root;
  const seen = new Set();
  let count = 0;
  function walk(modules, depth) {
    if (++count > 100000 || depth > 64) throw Error('installed graph bound');
    if (!fs.existsSync(modules)) return;
    if (!fs.lstatSync(modules).isDirectory()) throw Error('non-directory node_modules');
    for (const name of fs.readdirSync(modules)) {
      if (['.bin', '.package-lock.json'].includes(name)) continue;
      const node = path.join(modules, name);
      if (!fs.lstatSync(node).isDirectory()) throw Error('unresolved installed node');
      if (name.startsWith('@')) { walk(node, depth + 1); continue; }
      // lstat above excludes links; this is a non-root node_modules package.
      // Only its workspace declaration is ignored, never nested npm config.
      inputPreflight(node, false, true);
      const location = path.relative(dir, node), p = lock.packages[location];
      const manifestFile = path.join(node, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (manifest.workspaces !== undefined && !fs.lstatSync(manifestFile).isFile())
        throw Error('workspace input');
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        if (manifest[field] !== undefined && (!manifest[field] || typeof manifest[field] !== 'object' || Array.isArray(manifest[field])))
          throw Error('invalid dependency edges');
        for (const [name, spec] of Object.entries(manifest[field] || {})) {
          const range = typeof spec === 'string' ? spec.replace(/^npm:((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@|$)/, '') : null;
          if (!nameRE.test(name) || range === null || !/^[a-zA-Z0-9.*~^<>=|+ -]*$/.test(range))
            throw Error('installed nonregistry declaration');
        }
      }
      const expected = p?.name || location.split('node_modules/').pop();
      if (!p || manifest.name !== expected || manifest.version !== p.version) throw Error('installed identity mismatch');
      for (const field of declarationFields) {
        // Published development dependencies are not part of the installed tree.
        if (field === 'devDependencies') { delete p[field]; continue; }
        if (manifest[field] === undefined) delete p[field]; else p[field] = manifest[field];
      }
      delete p.workspaces;
      if (sanitize && (manifest.devDependencies !== undefined || manifest.workspaces !== undefined)) {
        delete manifest.devDependencies;
        delete manifest.workspaces;
        fs.writeFileSync(path.join(node, 'package.json'), JSON.stringify(manifest), { mode: 0o600 });
      }
      seen.add(location); walk(path.join(node, 'node_modules'), depth + 1);
    }
  }
  walk(path.join(dir, 'node_modules'), 0);
  for (const [location, p] of Object.entries(lock.packages))
    if (location && !seen.has(location) && !p.optional) throw Error('missing installed identity');
  identities(lock);
  if (sanitize) fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock), { mode: 0o600 });
}
function signatureResult(r) {
  if (r.error || ![0, 1].includes(r.status)) return unknown('signature process failure');
  let j;
  try { j = JSON.parse(r.stdout); } catch { return unknown('signature malformed JSON'); }
  if (j?.error) {
    // npm sometimes omits error.code. Match fixed summaries, never echo text,
    // package names, URLs, stderr, credentials, or arbitrary upstream codes.
    const summary = typeof j.error.summary === 'string' ? j.error.summary : '';
    const category = /found no dependencies to audit that were installed from a supported registry/.test(summary) ? 'no supported dependencies' :
      /found no installed dependencies to audit/.test(summary) ? 'no installed dependencies' :
      ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(j.error.code) ? 'network failure' : 'operational failure';
    return unknown('signature ' + category);
  }
  if (!j || !Array.isArray(j.invalid) || !Array.isArray(j.missing)) return unknown('signature unsupported response');
  const identity = p => p && typeof p.name === 'string' && nameRE.test(p.name) &&
    typeof p.version === 'string' && versionRE.test(p.version) &&
    [registry, registry + '/'].includes(p.registry) && typeof p.location === 'string';
  if (j.invalid.some(p => !identity(p) || !['EINTEGRITYSIGNATURE', 'EATTESTATIONVERIFY'].includes(p.code)) || j.missing.some(p => !identity(p)))
    return unknown('signature malformed findings');
  if (j.invalid.length || j.missing.length) return { status: 'invalid', detail: 'invalid or missing registry signature/provenance',
    invalidCount: j.invalid.length, missingCount: j.missing.length };
  return r.status === 0 ? { status: 'clean', detail: 'supported registry signatures verified; provenance not required' } :
    unknown('signature inconsistent exit');
}
function signatures(dir, npm, env) {
  try {
    inputPreflight(dir, true);
    installedGraph(dir);
    // Revalidate the copied tree too, before npm can read any copied bytes.
    const r = isolated(dir, npm, ['audit', 'signatures', '--json'], env, true);
    return signatureResult(r);
  } catch (e) {
    const categories = {
      'installed nonregistry declaration': 'nonpublic installed edge',
      'installed identity mismatch': 'installed identity mismatch',
      'missing installed identity': 'missing installed identity',
      'unresolved dependency edge': 'unresolved installed edge',
      'manifest/lock mismatch': 'root manifest/lock mismatch',
      'unexpected npm input': 'unexpected npm input',
      'workspace input': 'workspace input',
    };
    return unknown('signature preflight/copy: ' + (categories[e.message] || 'unresolved or malformed installed graph'));
  }
}
function positive(value, fallback, max) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw Error('invalid scan bound');
  return n;
}
function scan(paths, options = {}) {
  let roots;
  try { roots = paths.map(p => path.resolve(p)); }
  catch { return unknown('invalid scan paths'); }
  return { ...scanRoots(roots, options), paths: roots };
}
function scanRoots(roots, options) {
  try {
    const days = positive(options.days, 3, 30), seconds = positive(options.seconds, 1800, 3600);
    if (!roots.length) return unknown('no explicit scan paths');
    let entries = 0;
    const deadline = performance.now() + 10000;
    function inspect(p, device, depth) {
      if (performance.now() > deadline) throw Error('incomplete: preflight elapsed bound');
      if (++entries > 100000 || depth > 64) throw Error('incomplete: traversal bound');
      const s = fs.lstatSync(p);
      if (s.isSymbolicLink()) return; // Deliberately outside the scan scope.
      if (s.dev !== device) throw Error('incomplete: filesystem boundary');
      if (s.isDirectory()) for (const name of fs.readdirSync(p)) inspect(path.join(p, name), device, depth + 1);
      else if (!s.isFile()) throw Error('incomplete: special file');
      else if (s.size > 100 * 1024 * 1024) throw Error('incomplete: file exceeds 100 MiB');
    }
    for (const root of roots) {
      if (root === '/') throw Error('refusing filesystem root');
      let p = '/';
      for (const part of root.split('/').filter(Boolean)) {
        p = path.join(p, part);
        if (fs.lstatSync(p).isSymbolicLink()) throw Error('refusing symlink scan root/ancestor');
      }
      inspect(root, fs.lstatSync(root).dev, 0);
    }
    const r = (options.run || command)('/usr/local/bin/clamscan', [
      '--recursive', '--suppress-ok-results', '--follow-dir-symlinks=0', '--follow-file-symlinks=0', '--cross-fs=no',
      '--alert-exceeds-max=yes', '--alert-encrypted=yes', '--max-filesize=100M', '--max-scansize=400M',
      '--max-files=10000', '--max-recursion=17', '--max-dir-recursion=65', '--max-scantime=120000',
      '--fail-if-cvd-older-than=' + days, ...roots,
    ], { timeout: seconds * 1000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    const text = (r.stdout || '') + (r.stderr || '');
    // Scanner output is ambiguous for newline-bearing filenames. Retain bounded
    // raw finding records, not purportedly authoritative parsed filenames. JSON
    // serialization escapes newlines/control characters; never use this in commands.
    const findings = [], coverageEvidence = [], coverageRecords = [];
    let evidenceBytes = 64, evidenceTruncated = false, actualDetection = false, coverageIncomplete = false;
    const retain = (target, record) => {
      const bytes = Buffer.byteLength(JSON.stringify(record)) + 1;
      if (findings.length + coverageEvidence.length >= 10 || evidenceBytes + bytes > 8192) {
        evidenceTruncated = true; return;
      }
      target.push(record); evidenceBytes += bytes;
    };
    const coverageRE = /Heuristics\.(?:Limits|Encrypted)|\b(?:WARNING|ERROR)\b|not scanned|size limit|recursion limit/i;
    // Keep continuation lines so spaces and literal newlines in paths survive.
    let pending = [];
    for (const line of text.split('\n')) {
      pending.push(line);
      const hit = line.match(/: ([^:\r\n]+) FOUND\r?$/);
      if (hit) {
        const limited = /^Heuristics\.(?:Limits|Encrypted)(?:\.|$)/i.test(hit[1]);
        if (limited) coverageIncomplete = true; else actualDetection = true;
        if (limited) coverageRecords.push(pending.join('\n'));
        else retain(findings, pending.join('\n'));
        pending = [];
      } else if (coverageRE.test(line)) {
        coverageIncomplete = true; coverageRecords.push(pending.join('\n')); pending = [];
      } else if (!line.trim()) pending = [];
    }
    const processIncomplete = r.error || ![0, 1].includes(r.status);
    if (processIncomplete) coverageRecords.unshift('scanner error/timeout/output bound');
    for (const record of coverageRecords) retain(coverageEvidence, record);
    if (actualDetection) return { status: 'detected', detail: 'scanner detection; files left untouched',
      findings, coverageIncomplete: Boolean(coverageIncomplete || processIncomplete), coverageEvidence, evidenceTruncated };
    if (/(?:database|CVD).*?(?:older|outdated)|(?:older|outdated).*?(?:database|CVD)/i.test(text)) return { status: 'database-stale' };
    if (/no supported database|can't open.*(?:cvd|cld)|no such file.*(?:cvd|cld)|can't get.*database|database.*(?:missing|not found)/i.test(text))
      return { status: 'database-missing' };
    if (processIncomplete) return { ...unknown('scanner error/timeout/output bound'), native: {
      status: Number.isSafeInteger(r.status) ? r.status : null,
      signal: typeof r.signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(r.signal) ? r.signal : null,
      errorCode: typeof r.error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(r.error.code) ? r.error.code : null,
    } };
    // Limit/encryption alerts are incomplete coverage, not malware diagnoses.
    if (coverageIncomplete)
      return { status: 'incomplete', detail: 'scanner limit, encryption, or warning',
        coverageIncomplete: true, coverageEvidence, evidenceTruncated };
    if (r.status === 1) return { status: 'detected', detail: 'scanner detection; files left untouched',
      findings, coverageIncomplete: false, coverageEvidence, evidenceTruncated };
    return { status: 'clean', detail: 'no detection within no-symlink, same-filesystem scope' };
  } catch (e) {
    if (e.message.startsWith('incomplete:')) return { status: 'incomplete', detail: e.message };
    return unknown(e.code ? 'scan paths inaccessible' : e.message);
  }
}
function session(home) {
  try {
    const file = path.join(home, '.cache/session-env'), s = fs.lstatSync(file);
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o022) || s.size > 8192) return null;
    const text = fs.readFileSync(file, 'utf8');
    const env = {};
    // Accept only literal display/bus assignments, including the login's one-line export.
    const re = /(?:^|[\s;])(?:export\s+)?(DISPLAY|DBUS_SESSION_BUS_ADDRESS)=(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;]+))/g;
    for (const m of text.matchAll(re)) {
      const v = m[2] ?? m[3] ?? m[4];
      if (m[1] === 'DISPLAY' && /^:\d+(?:\.\d+)?$/.test(v)) env.DISPLAY = v;
      if (m[1] === 'DBUS_SESSION_BUS_ADDRESS' && /^unix:path=\/[A-Za-z0-9_./%-]+(?:,guid=[a-f0-9]+)?$/.test(v)) env.DBUS_SESSION_BUS_ADDRESS = v;
    }
    return env.DISPLAY && env.DBUS_SESSION_BUS_ADDRESS ? env : null;
  } catch { return null; }
}
function publishReport(file, result) {
  const temp = file + '.' + process.pid;
  let fd, owned = false;
  try {
    fd = fs.openSync(temp, 'wx', 0o600); owned = true;
    fs.writeFileSync(fd, JSON.stringify(result, null, 2) + '\n');
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (owned) fs.rmSync(temp, { force: true });
  }
}
function report(home, kind, checks, run = command, context = {}) {
  // Scan callers need no app metadata. Update callers identify start/final
  // selection and completion independently of which security gates were reached.
  checks = { ...checks };
  if (context.attempt?.complete === false)
    checks['update attempt'] = unknown('attempt interrupted by ' + context.attempt.signal);
  for (const [pkg, attempt] of Object.entries(context.apps || {}))
    checks[pkg + ' attempt'] = attempt.complete ? { status: 'clean', detail: attempt.outcome } :
      unknown('attempt incomplete at ' + attempt.phase);
  const dir = path.join(home, '.local/share/vertrice-update');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'security-' + kind + '.json');
  let previous = {};
  try {
    if (fs.statSync(file).size <= 128 * 1024) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Only delivery state survives replacement; this is not a findings ledger.
      previous = { notified: saved.notified, notifiedProblem: saved.notifiedProblem };
    }
  } catch {}
  const actionable = (name, c) => {
    if (['clean', 'skip'].includes(c.status)) return false;
    if (c.status !== 'advisories') return true;
    if (name.endsWith(' candidate')) return false; // Runtime advisories, not every disposable resolution.
    const counts = c.audit?.counts || c.counts;
    return (counts?.high || 0) + (counts?.critical || 0) > 0;
  };
  const complete = c => ['clean', 'skip', 'advisories', 'malicious', 'invalid', 'detected'].includes(c.status) &&
    !c.coverageIncomplete && [c.audit, c.osv, c.identity].filter(Boolean).every(complete);
  let latest = { checks, ...context, complete: Object.values(checks).every(complete) };
  const state = { time: new Date().toISOString(), scope: 'latest-attempt',
    notified: /^[a-f0-9]{64}$/.test(previous.notified) ? previous.notified : null,
    notifiedProblem: previous.notifiedProblem === true };
  // Include formatted/delivery overhead. Overflow retains identities, not large
  // evidence arrays. Hash the exact key-normalized scope BEFORE any omission.
  const fits = value => Buffer.byteLength(JSON.stringify({ ...value, ...state, problem: false,
    notified: '0'.repeat(64), notifiedProblem: false, delivery: 'deduplicated' }, null, 2) + '\n') <= 64 * 1024;
  if (!fits(latest)) {
    const fields = ['role', 'runtime', 'artifact', 'phase', 'paths'];
    const checkScope = Object.fromEntries(Object.entries(checks).map(([name, c]) =>
      [name, Object.fromEntries(fields.filter(k => c[k] !== undefined).map(k => [k, c[k]]))]));
    const scope = { checkScope, apps: context.apps, inputs: context.inputs, attempt: context.attempt };
    function ordered(value) {
      if (Array.isArray(value)) return value.map(ordered);
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])]));
      return value;
    }
    const digest = createHash('sha256').update(JSON.stringify(ordered(scope))).digest('hex');
    const scopeIdentity = { digest, counts: { checks: Object.keys(checks).length,
      paths: Object.values(checkScope).reduce((n, c) => n + (c.paths?.length || 0), 0),
      apps: Object.keys(context.apps || {}).length, inputs: Object.keys(context.inputs || {}).length },
      enumeration: 'complete', omitted: [] };
    latest = { ...scope, scopeIdentity, checks: { report: {
      ...unknown('report size bound exceeded; results incomplete'), scopeDigest: digest,
      ...(Object.values(checks).some(c => c.native) ? { nativeFactsTruncated: true } : {}) } }, complete: false };
    // Omit the largest enumeration first so oversized paths do not discard
    // small app/input identities (or oversized inputs discard small path sets).
    const sections = ['checkScope', 'apps', 'inputs', 'attempt'].filter(k => latest[k] !== undefined)
      .sort((a, b) => Buffer.byteLength(JSON.stringify(latest[b], null, 2)) - Buffer.byteLength(JSON.stringify(latest[a], null, 2)));
    for (const key of sections) {
      if (fits(latest)) break;
      delete latest[key];
      scopeIdentity.enumeration = 'omitted/incomplete';
      scopeIdentity.omitted.push(key);
    }
  }
  const findings = Object.fromEntries(Object.entries(latest.checks).filter(([name, c]) => actionable(name, c)).map(([name, c]) => {
    if (c.status !== 'advisories') return [name, c];
    const audit = c.audit || c;
    return [name, { status: c.status, role: c.role, runtime: c.runtime, artifact: c.artifact, phase: c.phase,
      high: audit.counts?.high, critical: audit.counts?.critical,
      vulnerabilities: audit.vulnerabilities?.filter(v => ['high', 'critical'].includes(v.severity)) }];
  }).sort(([a], [b]) => a.localeCompare(b)));
  const problem = Object.keys(findings).length > 0;
  const digest = createHash('sha256').update(JSON.stringify(findings)).digest('hex');
  const result = { ...latest, ...state, problem, delivery: 'not-needed' };
  let desktop;
  if ((problem || previous.notifiedProblem) && digest !== previous.notified) {
    desktop = session(home);
    result.delivery = desktop ? 'pending' : 'no-session';
  } else if (problem) result.delivery = 'deduplicated';
  // Facts must be visible BEFORE an external notification can name this file.
  // Failure here sends nothing; failure of the second publication leaves these
  // current facts with pending delivery and only previously persisted dedup state.
  publishReport(file, result);
  if (desktop) {
    const r = run('notify-send', ['--', 'Vertrice security',
      (problem ? 'Latest attempt: findings or unknown/incomplete checks. ' :
        'Latest attempt: no actionable findings within the reported scope. ') +
        'This does not resolve earlier or out-of-scope findings. Report: ' + file],
    { env: { HOME: home, PATH: process.env.PATH, ...desktop }, timeout: 10000 });
    result.delivery = !r.error && r.status === 0 ? 'delivered' : 'failed';
    if (result.delivery === 'delivered') { result.notified = digest; result.notifiedProblem = problem; }
    publishReport(file, result);
  }
  console.log('Security report: ' + file + ' (notification: ' + result.delivery + ')');
  return result;
}
module.exports = { identities, auditResult, signatureResult, osv, graph, signatures, scan, report, session };
if (require.main === module) {
  if (process.getuid() === 0) { console.error('vertrice-scan refuses root'); process.exitCode = 1; }
  else {
    const result = scan(process.argv.slice(2), { days: process.env.VERTRICE_SCAN_DB_DAYS, seconds: process.env.VERTRICE_SCAN_SECONDS });
    report(process.env.HOME, 'scan', { explicit: result });
    process.exitCode = result.status === 'clean' ? 0 : 1;
  }
}
