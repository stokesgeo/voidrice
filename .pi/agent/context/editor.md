# Live editor

ipe_editor uses only an inherited NVIM socket and IPE_PI_ID. Without that seat,
report unavailable live access; never probe other editors or fall back to disk
after RPC errors. Disk tools do not see unsaved buffers.

Read the live revision before diff/apply. Apply uses exact whole-line replacements
on named loaded targets, honors locked spans, gives one undo and never saves.
Selection spans are whole-line, not character/blockwise. Save separately writes
the entire dirty buffer. Backup is separate and not byte-perfect recovery.
After transport failure reread before retrying: mutation may already have run.
Preserve authored bytes and unrelated edits; review is not editing authority.
