'use strict';
// Recurring source reads/deployment only. Adoption owns refs, config and index
// normalization; this module never operates on the developer worktree/index.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const publicSource = 'https://github.com/stokesgeo/voidrice.git';
const identities = [publicSource, 'git@github.com:stokesgeo/voidrice.git'];
const selectionSource = '.local/share/openbsd/sparse-checkout';
const rootTemplates = new Set(['apm-suspend', 'dictd.conf', 'doas.conf', 'doas-agent.conf', 'fbtab',
  'freshclam.conf', 'hotplug-attach', 'hotplug-detach', 'pf.conf', 'pkglist', 'pkglist.extra',
  'root.kshrc', 'updates.cron', 'upgrade.cron', 'upgrade.sh', 'usbctl', 'wsconsctl.conf']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function stop(reason) { const e = new Error(reason); e.channelReason = true; throw e; }
function stat(file) {
  try { return fs.lstatSync(file); }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
}
const records = text => text.split('\0').filter(Boolean);
function safe(file) {
  if (!file || file.includes('\\') || /[\x00-\x1f\x7f]/.test(file) ||
      path.isAbsolute(file) || file.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git'))
    stop('unsafe incoming path');
}
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

module.exports = function sourceChannels(home, channel) {
  const canonical = path.join(home, 'src/vertrice');
  const env = {
    HOME: home, PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null',
    GIT_ASKPASS: '/usr/bin/false', SSH_ASKPASS: '/usr/bin/false',
  };
  // Repository access: constrained Git, with no developer-index refresh.
  function repository(dir, bare) {
    const gitdir = bare ? dir : path.join(dir, '.git');
    if (!stat(gitdir)?.isDirectory() || stat(gitdir).isSymbolicLink() || fs.realpathSync(dir) !== dir)
      stop('unrecognized repository layout');
    const worktree = bare ? home : dir;
    function git(args, { optional = false, input, extra = [], readHome = home, indexFile, gitDir = gitdir, encoding = 'utf8' } = {}) {
      const r = spawnSync('git', ['--no-optional-locks', '--git-dir=' + gitDir, '--work-tree=' + worktree,
        '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
        '-c', 'submodule.recurse=false', '-c', 'merge.autoStash=false',
        '-c', 'credential.helper=', '-c', 'credential.username=', '-c', 'credential.interactive=false',
        '-c', 'http.extraHeader=', '-c', 'http.cookieFile=', '-c', 'http.saveCookies=false',
        '-c', 'http.sslVerify=true', '-c', 'http.followRedirects=false',
        '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.file.allow=always',
        ...extra, ...args], { cwd: worktree, env: { ...env, HOME: readHome, ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}) },
        input, encoding, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
      if (r.error || r.status !== 0) {
        if (optional) return null;
        // Git stderr can contain credentials, private paths and URLs. Never emit it.
        stop('Git ' + args[0] + ' failed');
      }
      return r.stdout;
    }
    const config = (key, type) => git(['config', ...(type ? ['--' + type] : []), '--get', key], { optional: true })?.trim();
    const values = key => git(['config', '--get-all', key], { optional: true })?.trim().split('\n') || [];
    const ref = name => {
      const oid = git(['show-ref', '--verify', '--hash', name], { optional: true })?.trim();
      if (!/^[a-f0-9]{40,64}$/.test(oid || '')) stop('required source ref unavailable');
      if (git(['cat-file', '-t', oid]).trim() !== 'commit') stop('source ref is not a commit');
      return oid;
    };
    if (config('core.bare', 'bool') !== String(bare)) stop('unrecognized repository type');
    function transport() {
      // Command overrides clear ordinary helpers/headers. URL-scoped transport
      // settings and rewrites could bypass those overrides; do not use them.
      const keys = records(git(['config', '--null', '--name-only', '--list']));
      if (keys.some(k => /^url\..*\.(insteadof|pushinsteadof)$/i.test(k) ||
          /^(http|credential)\..*\./i.test(k) ||
          /^http\.(sslcert|sslkey|proxy|emptyauth|delegation)$/i.test(k)))
        stop('source transport configuration needs review');
    }
    function fetch(source, spec, remote) {
      transport();
      // libcurl can consult ~/.netrc independently of credential.helper. Public
      // reads therefore use an empty HOME as well as disabled helpers/prompts.
      const readHome = source === publicSource ? fs.mkdtempSync(path.join(os.tmpdir(), 'vertrice-source-read-')) : home;
      try {
        git(['fetch', '--no-tags', '--no-prune', '--no-prune-tags', '--refmap=',
          '--no-recurse-submodules', '--no-auto-maintenance', '--no-write-fetch-head', source, spec],
        { readHome, extra: remote ? ['-c', 'remote.' + remote + '.uploadpack=git-upload-pack'] : [] });
      } finally { if (readHome !== home) fs.rmSync(readHome, { recursive: true, force: true }); }
    }
    return { git, gitdir, config, values, ref, fetch };
  }
  // Capture the local pin before public I/O, then qualify the HOME deployment.
  let accepted;
  channel('source checkout', () => {
    if (!stat(canonical)) { console.log('source checkout: absent; no checkout installed.'); return; }
    const source = repository(canonical, false);
    const urls = source.values('remote.origin.url');
    const resolved = source.git(['remote', 'get-url', '--all', 'origin'], { optional: true })?.trim().split('\n');
    if (urls.length !== 1 || !identities.includes(urls[0]) || resolved?.length !== 1 || !identities.includes(resolved[0]))
      stop('origin identity not recognized');
    // Pin accepted local master BEFORE public I/O. Public failure/ahead does not
    // invalidate that committed snapshot, even with an unrelated branch or dirt.
    accepted = { ...source, oid: source.ref('refs/heads/master') };
    source.fetch(publicSource, 'refs/heads/master:refs/remotes/origin/master');
    const upstream = source.ref('refs/remotes/origin/master');
    const counts = source.git(['rev-list', '--left-right', '--count', accepted.oid + '...' + upstream]).trim().split(/\s+/).map(Number);
    if (counts.length !== 2 || !counts.every(Number.isSafeInteger)) stop('invalid source ancestry');
    if (counts[1]) stop(counts[0] ? 'public master diverges; unintegrated source requires developer review' :
      'public master ahead; unintegrated source requires developer review');
    console.log(`source checkout: fetched public master; accepted=${accepted.oid} local-ahead=${counts[0]}; developer tree/index untouched.`);
  });
  channel('source HOME', () => {
    const dir = path.join(home, '.local/share/vertrice.git');
    if (!stat(dir)) { console.log('source HOME: absent; no checkout installed.'); return; }
    const r = repository(dir, true), { git, config, ref, gitdir } = r;
    // One directory level only: any retained entry is ambiguous, including a
    // failed merge with unchanged HEAD. Never inspect recursively or remove it.
    if (fs.readdirSync(gitdir).some(name => name.startsWith('source-update-')))
      stop('retained source-update candidate; manual recovery review required');
    function qualifyConfig() {
      // Names only: command values may contain secrets. Even unused configured
      // filters are unsupported; --no-ext-diff/--no-textconv do not disable them.
      const keys = records(git(['config', '--null', '--name-only', '--list']));
      const autocrlf = config('core.autocrlf');
      if (keys.some(key => /^filter\..*\.(clean|smudge|process)$/i.test(key)) ||
          (autocrlf !== undefined && autocrlf !== 'false') || config('core.eol') !== undefined)
        stop('deployment content configuration needs review');
    }
    qualifyConfig();
    const branch = 'refs/heads/deployed/openbsd', tracking = 'refs/remotes/canonical/master';
    if (git(['symbolic-ref', '--quiet', 'HEAD'], { optional: true })?.trim() !== branch ||
        config('branch.deployed/openbsd.remote') !== 'canonical' ||
        config('branch.deployed/openbsd.merge') !== 'refs/heads/master' ||
        git(['rev-parse', '--symbolic-full-name', '@{upstream}'], { optional: true })?.trim() !== tracking)
      stop('deployment branch/upstream not adopted');
    if (r.values('remote.canonical.url').length !== 1 || r.values('remote.canonical.url')[0] !== canonical ||
        git(['remote', 'get-url', '--all', 'canonical'], { optional: true })?.trim() !== canonical)
      stop('canonical remote is not the exact developer directory');
    if (!accepted) stop('accepted local source unavailable');
    if (config('core.sparseCheckout', 'bool') !== 'true' || config('core.sparseCheckoutCone', 'bool') !== 'false' ||
        config('index.sparse', 'bool') === 'true') stop('expected non-cone full sparse index not adopted');
    const rulesFile = path.join(gitdir, 'info/sparse-checkout');
    if (!stat(path.dirname(rulesFile))?.isDirectory() || stat(path.dirname(rulesFile)).isSymbolicLink() ||
        !stat(rulesFile)?.isFile() || stat(rulesFile).isSymbolicLink()) stop('unsafe selection rules');
    const rules = fs.readFileSync(rulesFile), selection = hash(rules);
    if (config('vertrice.sourceSelectionHash') !== selection) stop('effective selection changed; scoped adoption decision required');
    for (const name of ['index.lock', 'HEAD.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'])
      if (stat(path.join(gitdir, name))) stop('deployment Git operation already in progress');
    const before = ref(branch), pin = accepted.oid;
    // Local-only object transfer, immutable refspec, non-force remote tracking.
    r.fetch('canonical', pin + ':' + tracking, 'canonical');
    if (ref(tracking) !== pin) stop('fetched source pin changed');
    if (git(['merge-base', '--is-ancestor', before, pin], { optional: true }) === null)
      stop('accepted local master is not a fast-forward');
    // Baseline: index semantics, attributes, sparse selection and raw live bytes.
    const indexFile = path.join(gitdir, 'index');
    if (!stat(indexFile)?.isFile() || stat(indexFile).isSymbolicLink()) stop('unsafe deployment index');
    const indexHash = () => hash(fs.readFileSync(indexFile));
    const originalIndex = indexHash();
    function tree(oid) {
      const entries = new Map();
      for (const line of records(git(['ls-tree', '-r', '-z', oid]))) {
        const match = /^(\d+) (\S+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
        if (!match) stop('unrecognized source tree');
        entries.set(match[4], match[1] + ' ' + match[3]);
      }
      return entries;
    }
    const old = tree(before), next = tree(pin), index = new Map();
    // Disable sparse *inspection* here: ordinary ls-files silently clears S in
    // memory for materialized files, which would conceal an unsafe on-disk bit.
    const inspect = ['-c', 'core.sparseCheckout=false'];
    for (const line of records(git(['ls-files', '--stage', '-z'], { extra: inspect }))) {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(line);
      if (!match || match[3] !== '0' || index.has(match[4])) stop('unmerged index');
      index.set(match[4], match[1] + ' ' + match[2]);
    }
    if (old.size !== index.size || [...old].some(([file, entry]) => index.get(file) !== entry))
      stop('staged index differs from deployed HEAD');
    // ls-files' mode/OID/stage and H/S cannot distinguish an empty-blob ITA
    // entry from a real tracked empty file. Native write-tree omits ITA. Run it
    // only on a disposable copy; never write/refresh the owner's real index.
    function checkSemanticTree(index, oid) {
      const proof = fs.mkdtempSync(path.join(gitdir, 'source-index-check-'));
      try {
        const copy = path.join(proof, 'index');
        fs.copyFileSync(index, copy, fs.constants.COPYFILE_EXCL);
        if (git(['write-tree'], { indexFile: copy, extra: inspect }).trim() !== git(['rev-parse', oid + '^{tree}']).trim())
          stop('deployment index semantic tree differs; inspect recovery');
      } finally { fs.rmSync(proof, { recursive: true, force: true }); }
    }
    checkSemanticTree(indexFile, before);
    const files = [...new Set([...old.keys(), ...next.keys()])];
    function qualifyAttributes() {
      qualifyConfig();
      // Native, read-only resolution includes info/attributes, configured/global
      // attributes, macros and nested rules. Check live, index and incoming
      // checkout views BEFORE content inspection. Do not emulate conversion or
      // assume core.attributesFile alone overrides repository attributes.
      for (const view of [[], ['--cached'], ['--source=' + pin]]) {
        const fields = git(['check-attr', ...view, '--all', '-z', '--stdin'], { input: files.join('\0') + '\0' }).split('\0');
        if (fields.pop() !== '' || fields.length % 3) stop('unrecognized deployment attributes');
        for (let i = 0; i < fields.length; i += 3)
          // check-attr renders false and the literal value "unset" identically.
          // Keep the supported domain conservative: no transform attributes.
          if (['filter', 'text', 'crlf', 'eol', 'ident', 'working-tree-encoding'].includes(fields[i + 1]))
            stop('deployment content attributes need review');
      }
    }
    qualifyAttributes();
    const selected = new Set(records(git(['sparse-checkout', 'check-rules', '-z'], { input: files.join('\0') + '\0' })));
    function checkFlags(indexFile) {
      const exceptions = [];
      for (const line of records(git(['ls-files', '-v', '-z'], { extra: inspect, indexFile }))) {
        const flag = line[0], file = line.slice(2), present = stat(path.join(home, file));
        if (flag !== 'H' && flag !== 'S') stop('assume-unchanged or unrecognized index flags');
        if ((flag === 'S' && (selected.has(file) || present)) || (flag === 'H' && !selected.has(file) && !present))
          stop('unsafe index/selection mismatch');
        if (!selected.has(file) && present) exceptions.push(file);
      }
      return exceptions;
    }
    const exceptions = checkFlags();
    // --numstat asks diff to inspect content, unlike --name-only's stat-only
    // shortcut (a just-materialized clean exception has no cached stat data).
    const differences = records(git(['diff-files', '--numstat', '--no-renames', '--no-ext-diff', '--no-textconv', '-z']))
      .map(line => line.slice(line.indexOf('\t', line.indexOf('\t') + 1) + 1));
    const changed = files.filter(file => old.get(file) !== next.get(file));
    const selectionChanged = old.get(selectionSource) !== next.get(selectionSource);
    // Manual selection adoption binds effective rules, the immutable template
    // and raw live bytes of this one fixed asset; never reapply selection here.
    const selectionReview = () => git(['config', '--local', '--null', '--get-all', 'vertrice.reviewedSourceSelection'], { optional: true });
    const reviewedSelection = selectionChanged ? selectionReview() : undefined;
    let reviewedAsset;
    if (selectionChanged) {
      const review = /^([a-f0-9]{64}):([a-f0-9]{64}):([a-f0-9]{64})\0$/.exec(reviewedSelection || '');
      reviewedAsset = liveTarget(selectionSource);
      if (!review || !/^100644 /.test(old.get(selectionSource) || '') ||
          !/^100644 /.test(next.get(selectionSource) || '') || !/^100644 /.test(reviewedAsset?.entry || '') ||
          review[1] !== selection || review[2] !== hash(git(['cat-file', 'blob', next.get(selectionSource).slice(7)], { encoding: null })) ||
          review[3] !== hash(reviewedAsset.bytes))
        stop('incoming selection change; scoped adoption decision required');
    }
    const selectionReviewValid = () => !selectionChanged ||
      (selectionReview() === reviewedSelection && unchangedTarget(selectionSource, reviewedAsset));
    const incoming = changed.filter(file => selected.has(file));
    // Snapshot raw bytes, mode and absence without Git stat caches or filters.
    // Symlink targets are deliberately not adopted, even if their text matches.
    function liveTarget(file) {
      const parents = [], parts = file.split('/');
      let dir = home;
      for (const part of parts.slice(0, -1)) {
        dir = path.join(dir, part);
        const st = stat(dir);
        if (st && (!st.isDirectory() || st.isSymbolicLink())) return false;
        parents.push([dir, st]);
      }
      const same = (a, b) => !a || !b ? a === b : a.dev === b.dev && a.ino === b.ino &&
        a.mode === b.mode && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
      const safeParents = () => parents.every(([dir, st]) => {
        const now = stat(dir);
        return same(st, now) && (!now || (now.isDirectory() && !now.isSymbolicLink()));
      });
      const target = path.join(home, file), want = next.get(file) || old.get(file), st = stat(target);
      if (!st) return safeParents() ? { entry: undefined } : undefined;
      if (!st.isFile() || !/^(100644|100755) /.test(want || '')) return undefined;
      let fd;
      try { fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
      catch (e) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code)) return false; throw e; }
      try {
        if (!same(st, fs.fstatSync(fd))) return false;
        const bytes = fs.readFileSync(fd);
        if (!same(st, fs.fstatSync(fd)) || !same(st, stat(target)) || !safeParents()) return false;
        const mode = st.mode & 0o100 ? '100755' : '100644';
        const oid = createHash(pin.length === 64 ? 'sha256' : 'sha1')
          .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
        return { entry: mode + ' ' + oid, bytes };
      } finally { fs.closeSync(fd); }
    }
    function unchangedTarget(file, initial) {
      const now = liveTarget(file);
      return now && now.entry === initial.entry && (!initial.bytes || now.bytes.equals(initial.bytes));
    }
    // Proof only: native built-in merge-file must produce exactly ours, never
    // new worktree bytes. No attributes, merge drivers, filters or object writes.
    // merge-file has no mode semantics: unchanged committed mode separately
    // permits an owner executable-bit overlay on a live regular file.
    function alreadyWithOverlay(file, live) {
      const base = old.get(file), target = next.get(file);
      if (!base || !target || !live.bytes || live.entry === base || !/^(100644|100755) /.test(base) ||
          base.slice(0, 6) !== target.slice(0, 6) || !/^(100644|100755) /.test(live.entry)) return false;
      const contents = [live.bytes, git(['cat-file', 'blob', base.slice(7)], { encoding: null }),
        git(['cat-file', 'blob', target.slice(7)], { encoding: null })];
      // Restrict this exception to NUL-free UTF-8 text; exact-target recognition
      // above still supports arbitrary regular-file bytes without a merge.
      if (contents.some(bytes => bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes))) return false;
      const proof = fs.mkdtempSync(path.join(gitdir, 'source-proof-'));
      try {
        const names = ['ours', 'base', 'theirs'].map(name => path.join(proof, name));
        names.forEach((name, i) => fs.writeFileSync(name, contents[i], { mode: 0o600, flag: 'wx' }));
        const result = git(['merge-file', '--stdout', '--quiet', '--no-diff3', '--diff-algorithm=myers', ...names],
          { optional: true, encoding: null });
        return result !== null && result.equals(live.bytes);
      } finally { fs.rmSync(proof, { recursive: true, force: true }); }
    }
    // Overlap proof: acknowledge only exact targets or the existing text proof.
    const applied = new Map();
    let overlays = 0;
    // New excluded source paths must not turn materialized owner files into
    // invisible S entries either. They have no deployment bytes, but still
    // change index ownership; inspect all changed paths for those collisions.
    const removed = new Set(incoming.filter(file => old.has(file) && !next.has(file)));
    function removedDirectory(dir, prefix) {
      const children = fs.readdirSync(dir);
      if (!children.length) return false;
      return children.every(name => {
        const file = prefix + '/' + name, target = path.join(dir, name), st = fs.lstatSync(target);
        return st.isDirectory() && !st.isSymbolicLink() ? removedDirectory(target, file) : removed.has(file);
      });
    }
    for (const file of changed) {
      safe(file);
      if (['src/vertrice', '.local/share/vertrice.git', '.local/share/vertrice-update'].some(dir => overlaps(file, dir)))
        stop('incoming path crosses repository/update-state boundary');
      for (const entry of [old.get(file), next.get(file)].filter(Boolean))
        if (!/^(100644|100755|120000) /.test(entry)) stop('unsupported incoming path type');
      const live = liveTarget(file);
      if (file === selectionSource && reviewedAsset) {
        if (!live || live.entry !== reviewedAsset.entry || !live.bytes?.equals(reviewedAsset.bytes))
          stop('reviewed selection asset changed during preflight');
        // Explicit manual review may resolve merge-file context conflicts only
        // for this asset. All other paths retain the generic native proof.
        applied.set(file, reviewedAsset);
        if (live.entry !== next.get(file)) overlays++;
      } else if (live && live.entry === next.get(file)) applied.set(file, live);
      else if (live && alreadyWithOverlay(file, live)) { applied.set(file, live); overlays++; }
      // Independently of Git's normalization and cached stat data, incoming
      // regular-file edits/deletions must not hide differing raw owner bytes.
      if (selected.has(file) && old.has(file) && live?.bytes && live.entry !== old.get(file) && !applied.has(file))
        stop('incoming source overlaps local tracked differences (raw bytes)');
    }
    // An acknowledged leaf is safe only when every overlapping owner difference is
    // that same leaf. Never use it to excuse an ancestor/descendant collision.
    if (changed.some(file => exceptions.some(local => overlaps(file, local) && !(file === local && applied.has(file)))))
      stop('incoming source overlaps materialized selection exceptions');
    if (incoming.some(file => differences.some(local => overlaps(file, local) && !(file === local && applied.has(file)))))
      stop('incoming source overlaps local tracked differences');
    for (const file of changed) {
      const parts = file.split('/');
      let target = home;
      for (let i = 0; i < parts.length; i++) {
        target = path.join(target, parts[i]);
        const st = stat(target);
        if (!st) continue;
        if (i < parts.length - 1) {
          if (!st.isDirectory() || st.isSymbolicLink()) stop('incoming ancestor collides with local data');
        } else if (!old.has(file) && !applied.has(file) && !(selected.has(file) && st.isDirectory() && !st.isSymbolicLink() && removedDirectory(target, file)))
          stop('incoming path collides with local untracked or ignored data');
        else if (old.has(file) && st.isDirectory()) stop('incoming type collides with local data');
      }
    }
    const meta = `accepted=${pin} selection=${selection} selected-changes=${incoming.length} preserved-local-differences=${differences.length} materialized-exceptions=${exceptions.length} already-applied=${applied.size} already-applied-with-overlay=${overlays}`;
    if (before === pin) { console.log('source HOME: unchanged; ' + meta + '.'); return; }
    // Sparse merge can delete clean materialized exceptions and, in Git 2.55,
    // overwrite ignored additions even with --no-overwrite-ignore. Use ordinary
    // merge protections WITHOUT reapplying sparsity: in a disposable native
    // index, preload excluded absent changes and proven already-applied targets.
    // Merge has no worktree changes to make there. Existing excluded targets
    // stay visible H, never S. No live flags/rules are edited during preflight.
    // Bind native merge to an owned detached HEAD, not the mutable real symref.
    // commondir shares objects/config/refs; HEAD, ORIG_HEAD and index stay private.
    // This is disposable transaction state, not a second deployment repository.
    const stage = fs.mkdtempSync(path.join(gitdir, 'source-update-'));
    const candidate = path.join(stage, 'index'), indexLock = indexFile + '.lock', headLock = path.join(gitdir, 'HEAD.lock');
    let fd, ownedLock, headFd, ownedHeadLock, published = false, mergeStarted = false;
    const qualifyPrivateConfig = () => {
      // Conditional/relative includes can resolve differently in another GIT_DIR.
      // Prove native equivalence, without logging configuration values.
      const args = ['config', '--null', '--list'];
      if (!git(args, { encoding: null }).equals(git(args, { gitDir: stage, encoding: null })))
        stop('private deployment configuration differs; inspect recovery');
    };
    const held = (file, owner) => {
      const now = stat(file);
      return owner && now?.ino === owner.ino && now.dev === owner.dev;
    };
    try {
      fs.writeFileSync(path.join(stage, 'commondir'), gitdir + '\n', { mode: 0o600, flag: 'wx' });
      fs.writeFileSync(path.join(stage, 'HEAD'), before + '\n', { mode: 0o600, flag: 'wx' });
      // If enabled, native Git must read the same per-worktree config too.
      fs.symlinkSync(path.join(gitdir, 'config.worktree'), path.join(stage, 'config.worktree'));
      fs.copyFileSync(indexFile, candidate, fs.constants.COPYFILE_EXCL);
      const preloaded = changed.filter(file => !selected.has(file) || applied.has(file));
      if (preloaded.length) {
        const input = preloaded.map(file => (next.get(file) || '0 ' + '0'.repeat(pin.length)) + '\t' + file + '\0').join('');
        git(['update-index', '-z', '--index-info'], { input, indexFile: candidate, extra: inspect });
        const skipped = preloaded.filter(file => next.has(file) && !selected.has(file) && !applied.has(file));
        if (skipped.length) git(['update-index', '--skip-worktree', '-z', '--stdin'],
          { input: skipped.join('\0') + '\0', indexFile: candidate, extra: inspect });
        const visible = preloaded.filter(file => next.has(file) && applied.has(file));
        if (visible.length) git(['update-index', '--no-skip-worktree', '-z', '--stdin'],
          { input: visible.join('\0') + '\0', indexFile: candidate, extra: inspect });
      }
      // Hold the ACTUAL HEAD lock before revalidation or any mutating merge.
      // The private context uses its own native HEAD/index locks. Neither real
      // lock spans fetching. Direct target-ref competitors are handled by CAS.
      try { fd = fs.openSync(indexLock, 'wx', 0o600); }
      catch (e) { if (e.code === 'EEXIST') stop('deployment index lock held'); throw e; }
      ownedLock = fs.fstatSync(fd);
      try { headFd = fs.openSync(headLock, 'wx', 0o600); }
      catch (e) { if (e.code === 'EEXIST') stop('deployment HEAD lock held'); throw e; }
      ownedHeadLock = fs.fstatSync(headFd);
      const lockHeld = () => held(indexLock, ownedLock) && held(headLock, ownedHeadLock);
      qualifyPrivateConfig();
      qualifyAttributes();
      if (!lockHeld() || ref(branch) !== before || git(['symbolic-ref', '--quiet', 'HEAD']).trim() !== branch ||
          indexHash() !== originalIndex || hash(fs.readFileSync(rulesFile)) !== selection ||
          config('vertrice.sourceSelectionHash') !== selection || !selectionReviewValid())
        stop('deployment HEAD/index/selection changed during preflight');
      if ([...applied].some(([file, initial]) => !unchangedTarget(file, initial))) stop('already-applied target changed during preflight');
      if (!lockHeld()) stop('deployment index lock changed during preflight');
      mergeStarted = true;
      try {
        git(['merge', '--ff-only', '--no-autostash', '--no-overwrite-ignore', '--no-edit', '--no-stat', pin],
          { gitDir: stage, indexFile: candidate, extra: inspect });
      } catch { stop('Git merge failed; candidate retained; real ref not published; inspect recovery'); }
      if (git(['rev-parse', '--verify', 'HEAD'], { gitDir: stage }).trim() !== pin ||
          git(['symbolic-ref', '--quiet', 'HEAD'], { gitDir: stage, optional: true }) !== null)
        stop('private deployment HEAD verification failed; candidate retained');
      const staged = records(git(['ls-files', '--stage', '-z'], { extra: inspect, indexFile: candidate }));
      if (staged.length !== next.size || staged.some(line => {
        const m = /^(\d+) ([a-f0-9]+) 0\t([\s\S]+)$/.exec(line);
        return !m || next.get(m[3]) !== m[1] + ' ' + m[2];
      })) stop('deployment index verification failed; candidate retained');
      checkSemanticTree(candidate, pin);
      if ([...applied].some(([file, initial]) => !unchangedTarget(file, initial)))
        stop('post-merge already-applied target changed; candidate retained; inspect recovery');
      // Late materialization must not be published as S or called a success.
      try { checkFlags(candidate); }
      catch { stop('post-merge index/selection mismatch; real ref not published, candidate retained; inspect recovery'); }
      qualifyPrivateConfig();
      qualifyAttributes();
      if (!lockHeld() || ref(branch) !== before ||
          git(['symbolic-ref', '--quiet', 'HEAD'], { optional: true })?.trim() !== branch ||
          indexHash() !== originalIndex || hash(fs.readFileSync(rulesFile)) !== selection ||
          config('vertrice.sourceSelectionHash') !== selection || !selectionReviewValid())
        stop('deployment HEAD/index/selection changed during merge; candidate retained');
      const result = fs.readFileSync(candidate);
      // Publish only this named ref, never dereference a competing symref. Use
      // the detached context: real Git would otherwise try to relock HEAD for
      // the checked-out branch. Native expected-old CAS is the write guard.
      try { git(['update-ref', '--no-deref', branch, pin, before], { gitDir: stage }); }
      catch { stop('deployment ref publication failed; candidate retained; inspect ref/worktree/index'); }
      if (!lockHeld() || ref(branch) !== pin || git(['symbolic-ref', '--quiet', 'HEAD'], { optional: true })?.trim() !== branch)
        stop('deployment ref publication changed; candidate retained; inspect ref/worktree/index');
      fs.writeFileSync(fd, result); fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(indexLock, indexFile);
      if (indexHash() !== hash(result)) stop('deployment index publication verification failed; candidate retained');
      published = true;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (headFd !== undefined) fs.closeSync(headFd);
      if (held(indexLock, ownedLock)) fs.unlinkSync(indexLock);
      if (held(headLock, ownedHeadLock)) fs.unlinkSync(headLock);
      // Retain the private HEAD/index after ANY attempted worktree merge, even
      // when the real ref is still old. No automatic rollback, index repair,
      // stale-lock removal or owner reset; the retained-entry gate blocks reruns.
      if (published || (!mergeStarted && ref(branch) === before)) fs.rmSync(stage, { recursive: true, force: true });
    }
    console.log(`source HOME: fast-forwarded from=${before}; ${meta}; hooks disabled.`);
    // User modules/manifests are deployed here, not root/service templates.
    const templates = incoming.filter(file => {
      const prefix = '.local/share/openbsd/';
      if (!file.startsWith(prefix)) return false;
      const local = file.slice(prefix.length);
      return rootTemplates.has(local) || local.startsWith('login.conf.d/') || local.startsWith('mail/');
    }).length;
    if (templates) console.log(`source HOME: root/service templates changed=${templates}; maintenance/restart review required; no installer run.`);
  });
};
