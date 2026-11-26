---
name: coding-workflow
description: Plan, implement, test and review bounded code or executable configuration changes.
---
# Code changes

Read the current source and local changes. Identify the requested outcome,
constraints and smallest sound change before editing; no change is an option.
Use established native interfaces before new dependencies or abstractions.
For consequential design, challenge assumptions with a fresh read-only reviewer
when available; no nested delegation or work ahead of an owner-review boundary.

Build a working slice and test the affected entrypoint immediately. Reproduce
bugs where practical. Check errors, interruption, trust boundaries and recovery
in proportion to risk. After repeated failed fixes, reassess the assumptions.
Prefer readable code; measure before claiming performance improvements.

Review the artifact against the actual request, independently for consequential
changes when possible. Give reviewers the question and artifact, not a defense.
Fix material findings and rerun affected tests. Report changed paths, executed
checks, failures, skips and unresolved evidence. Self-review is not independent.
No test result grants privilege, credential access, publication or deployment.
