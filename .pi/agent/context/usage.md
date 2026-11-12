# Local assistant setup

This public package contains operational instructions, not a user profile.
Choose a provider and model through Pi's local sign-in and settings interface.
Keep personal preferences, project context, credentials and session history
outside published dotfiles. Check the requested scope before accessing data.

The supplied tools operate on local files. Remote accounts, corpus search and
other machines need their own explicit configuration and authorization.

## Conversation display

Routine tool rows start collapsed with deterministic tool/operation labels;
expand them for exact arguments and output. Errors remain visible. Labels are
presentation, not evidence of success. `/work` shows or folds local task details;
the footer keeps the open/active count. The subagent overview shows active and
unresolved workers, not detached jobs or verified task completion. Expanded
subagent rows retain captured output, diagnostics and usage.

Optional `pi --luna-labels` adds asynchronous action labels through the locally
configured direct OpenAI `gpt-6-luna` model. It is off by default: a main-chat
subscription or another provider does not imply access to this model. Configure
provider access locally through Pi, never in published settings. This opt-in
can incur additional provider charges. These display-only side requests are
not attached to tool results and are not included in Pi's session usage/cost
totals; consult provider accounting. Only allowlisted tool names and lossy
operation metadata are sent, never shell arguments, paths or tool output.
Two requests at most run concurrently, with a six-second abort deadline and a
bounded session-local cache. Missing models, failed requests, or saturation
retain deterministic labels; failures warn once. Shutdown cancels pending work.

## Public-web research (optional)

No hosted service or account is enabled by these sources. An owner may configure
a hosted public-web MCP service locally (for example Exa search/page tools),
then use the research skill. Check current service terms, availability and
costs; do not assume a free quota. Keep MCP endpoints/auth and model/session
settings local. This is separate from video: an unavailable video ingestion
backend does not block ordinary approved public-web reading, and a public-web
connection does not establish transcript or visual capabilities.
