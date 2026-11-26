# Pi and Crush — capabilities and boundaries

Pi and Crush are both required supported assistants. Choose the appropriate
interface for the work; neither is a substitute for finishing the other's
installation. Run `vertrice-pi-setup` and `vertrice-crush-setup` as the ordinary
user for first installation; existing installations are retained. These tools
and defaults do not authorize access to unrelated private data. Check provider
sign-in and useful behavior locally.

## Pi

| Work | Interface | Boundary |
| --- | --- | --- |
| Files and maintenance | Native file/shell tools, `ask_user`, `admin_step` | Normal user access; administrator approval is not an OS sandbox. |
| Writing | `ipe-pi FILE`, `ipe_editor` | Live unsaved buffer; revision-checked edits and explicit save are separate. Opening a seat does not authorize prose changes. |
| Durable work | `work_task`, task widget | Local Markdown records with revision and lock checks; not cross-device synchronization or proof of completion. |
| Working context | `context_search`, `context_read` | Explicit local manifest with path/line/hash evidence; not full-corpus or web search. |
| Delegation | Worker, scout, reviewer, tool-free reader | Separate subprocess contexts, not OS compartments. The reader has no fetch tools. |

See `~/.config/ipe-pi/README.md` for editing and recovery. Tasks default to the
shared home `~/.agents` (see `.local/share/vertrice-agents/README.md`);
`VERTRICE_WORK_DIR` selects another store.
Application generations are separate from the account-local profile at
`~/.local/share/vertrice-pi/profile`. First-only initialization creates generic
settings and an empty private `auth.json` (`{}`, mode 0600); it seeds no
credentials. An existing profile requires review, not replacement.

## Crush

Run `crush` from the intended working directory once the supported build is
installed. The shipped `~/.config/crush/crushrc` selects compact UI and allows
only `view`, `ls`, `glob` and `grep` without a new approval. Other operations
retain native fresh approval prompts. Read grants are not permission to run
commands, modify files or administer the machine; they are not a filesystem
sandbox either. Do not replace this policy with blanket approvals.

Sign in to the chosen provider locally in each assistant. No provider account,
credential, personal session or task history is distributed with the defaults.
Keep auth files, tokens, browser cookies and private keys out of conversations.

## Separate configuration

Optional LSP servers and remote ingestion, personal-corpus search, device
delivery, remote account controls and cross-device task/Git return services
are not configured by these defaults. A listed tool or skill does not supply a
backend or authorize account access. Browser MCP package availability alone
does not establish a configured service or a private browser-worker sandbox.

Pi has native MCP support, but an external service needs its own reviewed
configuration and authority. Do not silently install a filesystem bridge or
reuse signed-in browser state. General assistant access is unconfined; role
names and prompts do not isolate credentials. Scan results do not establish
source interpretation, and captions alone are not visual evidence.
