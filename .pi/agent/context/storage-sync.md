# Local state

work_task defaults to ~/.local/share/vertrice-work/tasks/<uuid>.md.
VERTRICE_WORK_DIR overrides the root; relative values resolve once at startup.
Records are local runtime data, never packaged source. The widget is a view,
refreshed on tool/turn events, not global fleet state or a second database.

Revision checks and a directory lock protect local cooperative mutations.
Inspect a stale lock before deliberate recovery; do not silently remove it.
These mechanisms are not distributed coordination or a hostile-user boundary.
No automatic Git sync, conflict resolution, remote delivery or state migration
is supplied. Preserve both sides of a conflict and verify the intended outcome.
