---
name: coding-workflow
description: Load before coding, scripts or executable configuration; use user:coding-workflow to invoke manually. Choose a scoped change and verify its actual entrypoint.
user-invocable: true
---

# Coding workflow

Before editing, identify the requested outcome, scope and invariants. Inspect
existing changes and the local idiom. For a clear fix, proceed directly; for a
consequential ambiguity, ask rather than silently choosing new scope.

Prefer the smallest sound solution, readable code and native tools. Check manuals
or upstream documentation when uncertain. Discussion alone is not permission to
edit, deploy, obtain credentials or perform privileged or destructive work.

Build a thin working slice. Reproduce bugs when practical, then test immediately
after each change, starting with targeted checks and the actual entrypoint.
Include trust boundaries and partial failure when relevant. Use synthetic secrets
and disposable state for tests, not live credentials or private user data.

Review the result against the ask: remove unnecessary state and indirection,
preserve unrelated behavior, and fix verified faults before rerunning checks.
Use independent review when it adds useful scrutiny and is available; self-review
is not independent review. Do not delegate just to satisfy a quota.

Hand off the changed paths, executed checks and concrete results. Separate failed,
skipped and untested checks from passes, and source edits from live installation.
Stop at missing authority or material missing evidence; do not hide it behind a
success claim. Record useful corrections briefly in the conversation, not a new
process or reporting system.
