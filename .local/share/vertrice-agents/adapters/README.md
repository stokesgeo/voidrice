# Harness notes

Each harness keeps its own settings, sign-in and session database. These notes
say what reaches the shared home today and what is still to be checked in the
real harness. The repository tests have run; the in-harness checks below have
not. Merge settings into what
you have; never replace an owner's existing configuration.

Skills in `~/.agents/skills` are owner data: adopt them through the harness's
own skill discovery after review. For any harness, launch it with
`VERTRICE_SESSION_PID` naming its process so its claims lock while it lives
(see [Tasks](../templates/tasks/README.md)).

## Pi (1.6.0)

New Vertrice Pi builds use `~/.agents` for tasks and `~/.agents/sessions/pi`
for sessions; an explicit `--session-dir` or environment setting still wins,
and this default outranks a saved `sessionDir` setting. Crew, Pi's separate
campaign mode, keeps its own roots and does not load the shared extensions. Older stores are not migrated:
the work widget names them once per session, with the command to reopen old
sessions. An existing build picks up the shared task home only if it loads
this work extension. `shared-instructions.mjs` appends `~/.agents/AGENTS.md`
to the prompt once per process; `/shared-home` shows the file and its SHA-256.

To check: run `sh .local/share/vertrice/tests/run agents_ pi_work pi_self select`,
then `adapters/pi/native-loader-smoke.mjs` with the installed 1.6.0 package
directory (it exits 77 without one). In a freshly built generation, confirm
the owner text appears once in the prompt, a missing file falls back cleanly,
an exact-ID session restart works, the CLI and `work_task` see the same task,
and Crew stays separate. Activating a build needs its own approval.

## Crush (v0.102.0, commit `c62fa029f743047ab70fcc88cef9029be6c5beff`)

`.config/crush/crushrc` keeps the baseline settings and adds
`$HOME/.agents/AGENTS.md` after the native context paths. To check: in an
isolated HOME, confirm the shared text loads alongside the native context, that
absent files are harmless, and that a named session can be exported into
`~/.agents/sessions/crush`.

## OpenCode (V2 2.4.2)

To adopt: add `~/.agents/AGENTS.md` to the installed version's instruction
list without replacing existing entries, and add a shared skill path only once
native discovery of it is confirmed. Keep its session database native and
export named sessions into `~/.agents/sessions/opencode`; never copy the live
SQLite file as a backup. To check: the shared text is read exactly once in a
fresh session, owner instructions are kept, one shared skill works, and a
session reopens by ID. Sources: https://opencode.ai/docs/instructions,
https://opencode.ai/docs/skills.

## Hermes (0.23.4)

To adopt: add `~/.agents/skills` through `skills.external_dirs` without
replacing existing entries; a reviewed bootstrap skill may point at
`~/.agents/AGENTS.md`, but loading a pointer does not prove the file was read.
Leave `SOUL.md`, `HERMES_HOME` and Hermes's own memory alone. To check: the
shared instructions are read by a tool call, owner settings are kept, and a
named session exports into `~/.agents/sessions/hermes`. Source:
https://github.com/NousResearch/hermes-agent/tree/v0.23.4.
