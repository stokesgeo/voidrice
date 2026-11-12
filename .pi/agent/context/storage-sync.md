# Task storage, restart and synchronization

Default: `~/.local/share/vertrice-work/tasks/<uuid>.md`. These are runtime
records, not shipped dotfiles. Setup creates no task fixtures, clones no work
repository and never overwrites task records. Restart reads the same disk
store; the Pi widget is derived, not a second persisted task list.

The owner may configure an absolute `VERTRICE_WORK_DIR` before launching Pi
to locate this store inside an existing work checkout. Relative configuration
is resolved once at extension startup, not from each tool's current directory.
No automatic repository discovery: starting Pi in a random project must not
redirect durable work into it. Do not point this store at an existing task
directory unless its record format is compatible.

Local mutations serialize through a directory lock. A crash can leave that lock;
inspect before removing it, never silently break it. Atomic publication prevents
ordinary readers seeing partial writes. This is not a distributed lock or a
guarantee against hostile same-user writers or every power-loss failure.

Revision checks and local locks do not coordinate offline devices. Git can
transport records and expose conflicts; it cannot prove exclusive ownership.
No remote push, synchronization or conflict resolution is performed by these
tools. Preserve both edits and reconcile before advancing disputed work.

Local revision/lock checks are mechanisms, not broader authorization.
