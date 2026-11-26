# Working on Vertrice

## Source and installation

This repository mirrors HOME paths but is not the installed HOME worktree.
Inspect staged and unstaged changes before editing. The shell `config` command
addresses the separate bare HOME repository, not this development checkout.
Source changes, installation, running-process adoption and publication are
separate actions. Preserve local settings and unrelated changes; do not run the
system installer as a test.

OpenBSD is the primary target; preserve the existing macOS paths without making
OpenBSD changes depend on Mac parity. There is no top-level application build.
Read component callers before choosing standalone Node or Python test arguments.

## Checks

Run from this checkout:

```sh
.local/share/vertrice/tests/run --list PREFIX
.local/share/vertrice/tests/run PREFIX
.local/share/vertrice/tests/run --selftest
python3 .local/share/vertrice/tests/candidate-selection.py
node .local/share/vertrice/tests/portable-user-updates.cjs
python3 .local/share/vertrice/tests/crush-portable.py /absolute/path/to/crush
```

Runner arguments match case-name prefixes, not filenames. `-k` retains scratch
output. The mocked suite enters native ksh and uses per-case HOME and command
fixtures. Do not confuse it with `--live` or the installed-system `tests/check`.
Keep external command dependencies mocked; do not let a missing mock contact the
real display, network or services. Report skips separately from passed checks.

Check shell syntax with `ksh -n PATH`. Permanent scripts target portable POSIX sh;
use native ksh88 only where intended. Do not assume GNU flags, Linux interfaces,
bash syntax or ksh93 features. Native C helper Makefiles use OpenBSD
`<bsd.prog.mk>`; build with base cc/make.

## Integration boundaries

- `.profile` and `.config/shell/profile` establish command routing. Platform
  `.local/bin/openbsd` precedes system commands; ordinary helper directories
  follow them. Test repeated profile loading and inherited PATH preservation.
- `.config/x11` launches the cwm session; `.config/cwm/cwmrc` binds helpers.
  `sbar` supervises status blocks; blocks print one item or nothing. Configuration
  parsing alone does not prove desktop, backlight or power behavior.
- `.local/share/openbsd/user-updates.cjs` captures update inputs before source
  deployment. Preserve registry admission, graph, signature and scanner gates;
  never replace a broken generation with a silent vanilla fallback.
- Pi resource selection is explicit in `.pi/agent/resources.json`; its context
  manifest separately binds selected text hashes. Runtime code and generic
  resource inputs are not local auth, sessions or work stores. Keep fresh
  installation separate from migration of an existing profile.
- Crush's generic configuration contains no provider account defaults. Native
  source/build qualification is separate from configuration-loading tests. The
  synthetic provider fixture proves its named flows, not authenticated service
  acceptance or an OS sandbox.
- IPE applies against live buffer revisions; applying is not saving. Reread after
  ambiguous transport errors rather than blindly retrying or writing underneath
  a live editor.

## Packaging and release

Every source path must be selected by a platform or classified repository-only.
Use `.local/share/openbsd/sparse-checkout`, the unchanged macOS selection and
`.local/share/vertrice/repo-only`. Selection tests must include untracked additions
without staging unrelated work. Runtime licenses stay with distributed code;
standalone regression tests need not be installed.

Keep identity, account details, credentials, conversations, runtime stores,
acceptance records and machine-local development paths out of public defaults.
Inspect complete patch contents, including deleted text. A clean tip does not
sanitize private Git history. Do not commit, push, activate or deploy without the
corresponding authority.
