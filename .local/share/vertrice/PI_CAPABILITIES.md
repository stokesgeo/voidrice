# Pi on OpenBSD — capabilities and limits

These are supplied tools, not permission to use them on unrelated private data.
Provider sign-in and model choice happen locally after installation.

| Work | Supplied interface | Boundary |
| --- | --- | --- |
| Files and maintenance | Native file/shell tools, `ask_user`, `admin_step` | Normal user access; cooperative admin approval, not a sandbox. |
| Writing | `ipe-pi FILE` and `ipe_editor` | Reads the live unsaved buffer. Revision-checked edits and explicit save are separate. Opening a seat does not authorize prose changes. |
| Durable work | `work_task` and the native task widget | Local Markdown records with revision and lock checks; not cross-device sync or proof that an outcome happened. |
| Working context | `context_search`, `context_read` | Only the explicit local manifest, with path/line/hash evidence. Not the full personal corpus or web search. |
| Delegation | Worker, scout, reviewer and tool-free reader | Separate subprocess contexts, not OS compartments. The reader has no fetch tools. |

Use `.config/ipe-pi/README.md` for editing, explicit save and recovery limits.
Tasks default to `~/.local/share/vertrice-work`; set `VERTRICE_WORK_DIR` before
starting Pi to choose another location. Existing owner settings are preserved.

## Not installed by setup

Remote ingestion, personal-corpus search, device delivery,
remote account controls and cross-device task/Git return services are
not configured by this package. A skill describing a workflow does not supply
its backend or authorize account access.

Pi supplies native MCP support. External-content work needs a separately
configured and approved ingestion service. Check its availability and receipts;
do not substitute raw shell fetching or browser cookies. Scan success does not
establish source interpretation, and captions alone are not visual evidence.

Keep credentials out of prompts and transfer media. General Pi remains
unconfined; a role, prompt or approval tool is not credential isolation.
