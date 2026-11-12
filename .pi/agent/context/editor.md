# Authored text and live editor state

When an IPE seat owns a file, use its live buffer rather than a disk copy.

An ordinary nvim save preserves authored whitespace and bytes; do not restore
save-time cleanup merely because a formatter considers it conventional.
Opening a writing seat is not permission to rewrite its page. Propose or apply
only within the requested scope; voice review is not automatically editing.

Pi's disk tools do not see unsaved editor buffers. A safe live-seat interface
needs exact locus, buffer/selection/diff, revision-bound apply and separate save.
The isolated `ipe-pi` seat supplies `ipe_editor` over its inherited Neovim
socket/identity: read, revision-bound diff/apply, separate save and backup.
Apply is whole-line and named-buffer-only; captured visual selections are
whole-line spans, not character/blockwise. Read selection freshness before use.
Do not edit disk under a live buffer: its next save can replace that write.
No inherited IPE seat means no editor connection; never discover another
editor or fall back to disk after an RPC error. Reread before retrying.

The shared IPE transaction module is reused unchanged; the backup module has
local I/O checks and fixed-size, versioned SHA-256 path keys, with original paths
in log headers. Legacy and intermediate recovery files stay untouched. Locked
rows above a whole-line `[EDIT]` marker refuse mutation in declared locked
frontmatter. Apply never saves; save writes the entire dirty buffer explicitly.
Unnamed read works, unnamed edit/backup does not. Backup normalizes LF/final
newline, so do not claim byte-perfect recovery. See `.config/ipe-pi/README.md`.

Keep candidate text and review findings separate from the file until an edit
is requested. A review request does not automatically authorize changes.
