# Tasks

`vertrice-agents task list` shows each task's owner and next action. Read one
with `task read ID` before changing it; `--help` lists the fields, kinds,
statuses and rules. Use the tool rather than hand-writing records: updates
are checked against the revision you read, so a stale write is refused.
Reread and reconcile; do not overwrite.

Kinds:

- `maybe`: whether to do it is undecided, but it has a proposed next action
  and finish line.
- `incubate`: committed, but needs shaping.
- `todo`: committed and ready.

An idea with no action or finish line yet is not a task. Write it under
Possibilities in `../vision.md`, and promote it if it becomes work.

`spent_when` is the agreed finish line; `evidence` is what showed it was met.

**Claims.** Use your harness's own session ID as ACTOR; when the harness sets
`VERTRICE_SESSION_ID`, the CLI requires it. An `in_progress` claim locks only
while its session's process (`VERTRICE_SESSION_PID`) is alive. Release work
back to `pending`, with a note, before you end. When a session has ended,
`task list` shows `"claim": "lapsed"` and anyone may take the task; a claim
with no declared process shows `"unchecked"` and does not lock.
