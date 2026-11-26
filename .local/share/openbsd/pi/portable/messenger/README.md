# Portable Messenger source overlay

Apply once to the stage111 Messenger source produced from the manifest's pinned
upstream commit and initial local patch. Import `applyOverlay` from
`./apply-overlay.mjs` and pass the absolute normalized Messenger source directory.
The helper verifies every base file and every overlay source before writing.
The manifest maps 41 complete source files, including four Crew presence modules
and four portable adaptations of the maintained native-trust adapters. A null
`baseSha256` denotes a new file. No historical diff or runtime inventory is shipped.
Preserve upstream license notices and unchanged files when assembling.

The runtime bundle belongs at `GEN/messenger/messenger-runtime.cjs`. The bundler
must preserve runtime `import.meta.url` semantics: for CommonJS, supply a runtime
URL derived from `__filename` through the bundler's supported shim. Never replace
it with the build machine's source filename or an empty object. The adapter uses
that runtime location to derive GEN. The parent recipe owns bundling and loading.

`GEN/messenger-contract.json` is generated routing configuration, not saved trust. It needs
schema 1 and these fields:

- `revision`: absolute normalized GEN; `runtimeRoot` must equal it (flattened
  native package layout).
- `home`: explicit runtime home; `agentDir` and `nativeAgentDir`: the same profile
  beneath home; `nativeAuthStorage`: explicit auth file beneath that profile.
- `stateRoot`: explicit local state root; `sessionDir`, `workDir`, `transportDir`,
  `teamProfileDir`: normalized children of that root.
- `campaignRoot`: explicit finite campaign directory.
- `packageRoot`: GEN/messenger; `immutableResourceDir`: child of GEN; `boardRoot`: child of `stateRoot`.
- `extensions`, `skills`, `prompts`, `themes`: finite arrays of unique paths beneath
  GEN. Extensions must contain exactly GEN/messenger/messenger-runtime.cjs as the
  only Messenger extension and a separate `contextExtension`. Skills must contain
  GEN/messenger/skills. No nested subagent dispatcher may be listed.

The launcher must set `HOME`, `PI_CA_MESSENGER_CONTRACT=GEN/messenger-contract.json`,
`PI_CODING_AGENT_DIR=agentDir`, `PI_CA_RUNTIME=GEN`, and
`PI_CA_NATIVE_AUTH_STORAGE=nativeAuthStorage`. Child routes preserve these and set
both child markers, suppress automatic extension/skill/prompt/theme discovery,
and load only explicitly configured resources. Children use the selected native
session model unless an explicit execution override is supplied. Protected child
environment overrides and nested Crew delegation fail closed.

Native Pi owns current project trust and action approvals. Callback, tool,
command and shortcut entrypoints consult native trust; shutdown cleanup remains
available after revocation. Routing checks and checked-path operations are
cooperative integration checks, not a sandbox or a substitute for OS permissions.
No auth, saved trust, profile contents or runtime state belongs in this overlay.

The overlay helper requires an exact 111-file stage tree without Git metadata,
extra files, links or extra directories. It verifies the exact 119-file result.
Any write or final-verification failure invalidates the disposable assembly scratch;
discard that owned scratch and start fresh. Do not resume or reuse partial output.

## Source-only regression tests

Run from any directory with Node and an explicitly supplied installed TypeScript
module; tests do not install dependencies or access provider/auth/profile state:

```sh
MESSENGER_TYPESCRIPT=/absolute/toolchain/typescript/lib/typescript.js node /absolute/overlay/tests/contract.mjs
MESSENGER_TYPESCRIPT=/absolute/toolchain/typescript/lib/typescript.js node /absolute/overlay/tests/revocation.mjs
node /absolute/overlay/tests/overlay.mjs /absolute/pinned-stage111-source
```

`contract.mjs` constructs separate native bindings and full Messenger contract,
then tests routing, child arguments/environment, model selection, no delegation,
checked paths and native entrypoint trust. `revocation.mjs` captures real source
callbacks with synthetic filesystem/UI adapters and exercises true-to-false live
trust for watcher/debounce, heartbeat and presence without consuming queued mail.
`overlay.mjs` needs no compiler; it copies only hash-verified stage111 entries into
owned scratch and tests rejection, exact output closure and repeat application.
Temporary filesystem tests honor `TMPDIR`, create unique owned directories and
remove those directories in `finally`. The supplied stage111 source is read-only.
