---
name: self-maintain
description: Change reusable agent resources, verify explicit hashes and distinguish source reload from sealed generation replacement.
---
# Agent resource changes

Locate the source checkout and the process's actual resource/profile roots;
never assume a developer path or replace user settings/auth with source defaults.
Edit only authorized source. Preserve unrelated changes and known-good builds.
Test schemas, import closure and changed behavior before refreshing manifests.

context/manifest.json selects text sources explicitly. Run the shipped helper:
`node "$HOME/.local/share/openbsd/pi/context-index.mjs" /absolute/agent-root`,
then repeat with `--check`. Pass the actual editable source resource root, not a
sealed generation. If the helper is absent, report the provisioning gap.
Add reviewed paths explicitly; never discover/admit directories or private data.
resources.json binds generation files, modes and loader entrypoints; sourceOnly
lists development files retained in source but excluded from packaging. Refresh
selected hashes after changes. The manifest's own bytes belong in the generation
receipt, not a recursive self-hash.

For editable resources, native /reload at idle reloads supported resources;
reload_runtime is an optional extension request, not proof of success. Verify
the new behavior. Reload does not upgrade native core or re-resolve a selector.
Never edit receipt-sealed generation bytes in place: build a fresh complete
generation, review its receipt, obtain separate publication authority, then
start a new process. Source editing does not authorize activation or acceptance.
