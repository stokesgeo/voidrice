# IPE for Pi

Isolated terminal Neovim seat (`NVIM_APPNAME=ipe-pi`). `ipe-pi FILE` opens
the page and Pi together; run from the intended work root. Ordinary nvim
is unchanged. No plugins, npm additions, Mac launchers or hub services.

`,pp` captures the current whole line (visual mode: selected whole lines)
and reveals/hides the retained Pi terminal. `:IpePi` does the same in normal
mode. Closing the editor window invalidates the seat; no fallback editor
is discovered. A hidden live terminal is reused; an exited one is restarted.

Pi's `ipe_editor` reads live lines, revision, cursor, syntactic heading and
captured selection (including freshness). Apply uses exact before-text and
the read revision, validates all ranges before mutation, and makes one undo
block. Apply never saves. Save explicitly writes the entire dirty buffer.
The argv transport checks the host's `getconf ARG_MAX`, including inherited
environment, pointers and POSIX xargs' 2048-byte reserve (Linux also has a
32-page per-string limit). Oversized requests and spawn failures report
not executed; split large edits into revision-checked requests. This is a
transport limit, not a smaller fixed text/schema limit. On other RPC failure
the outcome may be unknown: reread, never blindly retry or
write the disk underneath the live buffer. Socket/identity are inherited
only; they are selection guards, not a sandbox against same-user processes.
The revision-bound diff compares disk bytes with LF editor text; it is not
an encoding/fileformat conversion or a disk-change concurrency token.

Named loaded mutation targets must resolve inside the launch root. Locked
scene rows above the whole-line `[EDIT]` marker refuse. The marker itself
is editable, matching existing IPE semantics; this is not persistent access
control. Initial locked frontmatter without a marker locks every row.

`:IpeBackup` and the idle/timer/leave backup lane never save working files.
`:IpeBackupPath` names the snapshot and append-only diff log. Open a snapshot
in another buffer to review/recover, then deliberately write the chosen
working file. There is no automatic restore or overwrite. Private launcher
umask protects newly created backups; existing destination permissions are
not repaired. Swap and persistent undo remain on.

Backup keys now use `v3-` plus native SHA-256 of the absolute path: fixed-size,
collision-resistant, not mathematically injective. The existing log header
retains the original path. Old unversioned and intermediate `v2-` snapshots
and logs are left in place, never deleted, renamed, overwritten or used as a
baseline. Unversioned slash-to-percent keys can belong to multiple paths;
do not infer ownership from those names alone. Review old contents/history
manually before choosing a recovery target. New logs start against the working
file, not old recovery data. Keys no longer grow with path length, keeping
snapshot and temporary basenames below OpenBSD's 255-byte filename limit.
Snapshot write and close failures preserve the previous snapshot, report an error and
leave the tick retryable. Log write/close failures also report errors and
leave the tick retryable, but an append can already be partial and a successful
snapshot is not rolled back; the next diff uses that snapshot as its baseline.

## Shared source

Original imports from `~/.config/nvim-ipe/lua/` inspected 2026-11-09:

- `ipe/delegated_edit.lua`: SHA256 `fc37013d786cfe604ec6a2c6fa4fd90b7a5bf5b3db5a35b3ad11defc3aa029c6`.
- `durability.lua`: SHA256 `15320b90563c752f0e9cf54c1d3fbe5a7c2faf57f6fa6bb360627a020ef22e34`.

`delegated_edit.lua` remains byte-exact. The local durability copy now checks
write/close failures, uses versioned keys and corrects force/baseline comments.

`ipe/pi.lua` owns only identity, root/lock guard, context and native terminal
transport/presentation. Locked predicate extracted from `ipe/editline.lua`
190–214. Heading lookup uses the existing whole-line uppercase convention;
scene/index metadata and the large actions/provider stack are not imported.

## Limits

Unnamed buffers can be read, not edited/backed up through this binding.
Revision hashes lines and EOL, not encoding, fileformat, changedtick or disk
mtime. Backup snapshots normalize to LF plus final newline; they are not
byte-perfect recovery for other formats. No fsync, multi-editor backup
coordination or log-success guarantee. No automatic pane reflow, session
restoration, cross-device synchronization or Mac/hub connection. Ordinary
Pi disk/shell tools still exist: this adapter grants no privilege reduction.
