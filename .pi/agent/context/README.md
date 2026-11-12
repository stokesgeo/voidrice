# Local context package

This package describes the public OpenBSD tools, not a user profile or personal
corpus. Operational startup instructions live once, in
`AGENTS.md`. These notes explain available workflows and their limits; the
manifest also indexes the existing role, skill and prompt files in this agent
directory. Search/read do not load every file into every session.

`manifest.json` names the admitted files and their SHA256 hashes. Search is
local lexical ranking with line excerpts; read returns the exact named file
after checking its hash. A changed/missing file fails visibly rather than
silently serving a different package. The repository's context-index generator
refreshes the explicit selection after reviewed source edits. It does not
discover new files, read outside the agent directory or copy account state.

Scope: tasks and verification, native OpenBSD administration, live editor state,
delegation, research and local Git use. These notes do not supply credentials,
account access, personal context or remote services.

Refresh the Pi work widget at startup and after turns/tool operations. It shows
local disk state, not a live global fleet. Other-process changes appear on the
next refresh; no background polling or service is installed.
