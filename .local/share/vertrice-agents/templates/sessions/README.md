# Sessions

Session histories: a harness's own storage where it supports this folder,
otherwise its supported exports. Keep native IDs and formats, and one canonical
copy. Handoffs link these records.

New Vertrice Pi builds keep sessions in `sessions/pi`; an explicit native
session-directory option still wins. For another harness, check what it can
store or export here before relying on it, and note its version and method.

Histories can hold secrets and hostile text. Read only what the question needs,
and review an export before sharing it.
