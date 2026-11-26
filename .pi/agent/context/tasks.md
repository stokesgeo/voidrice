# Work and campaigns

For sustained work, work_task records purpose, completion condition (spent_when),
owner, next_action, blockers and evidence. Read before updating; pass the returned
SHA256 revision. Statuses: pending, in_progress, blocked, parked, completed.
Do not steal another session's active work or equate process exit with delivery.
Completion checks evidence presence, not truth: verify the outcome yourself.

A configured Crew campaign uses its own plan/task/work/review/report lifecycle,
not competing work_task records. Its context-only extension is campaign-context;
exclude work and native subagent from that route. Legacy stores are not migrated
or automatically completed. A suggestion is not an authorized backlog item.
