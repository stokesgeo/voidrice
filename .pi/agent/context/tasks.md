# Durable tasks and work visibility

Use `work_task` for multi-step work, multiple requests, follow-on or deferred
work. Create at the start, not retrospectively. List/read existing tasks before
duplicating them. A task records its purpose, completion condition, current
owner, next action, blockers and outcome evidence; notes carry the reasoning.
Temporary session steps may belong to a durable task without each becoming
an independent permanent backlog item.

Statuses: pending, in_progress, blocked, parked, completed. Claiming active work
uses the current Pi session id. Complete only after the agreed outcome is
verified and delivered; evidence text is a record of that check, not a tool's
independent certification. Blocked work names what must change. Parking does
not mean completion. Dates are not required; do not manufacture deadline pressure.

Read returns a SHA256 revision. Update requires that revision; a stale update
fails rather than replacing someone else's change. An active task owned by
another session is not automatically stolen. Its owner can return it to pending
with an explicit next action/owner handoff. On abandoned-session recovery,
inspect the record/process and obtain an owner decision before a deliberate
file repair; no expiry timer is evidence that work stopped.

Files use a narrow header: one known field per line, JSON-encoded values,
between `---` boundaries, followed by free Markdown notes. This is not a
general YAML parser. Dedicated file tools remain usable for deliberate repairs,
but must preserve the schema; they do not participate in the tool's write lock.

These instructions describe the local tool's record format, not a migration of
another task system.
