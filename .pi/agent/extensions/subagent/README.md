# Pi subagents

Adapted from the example shipped inside the locked Pi 1.5.0 npm package; no
additional runtime dependencies. MIT upstream license retained in LICENSE.

Roles in `~/.pi/agent/agents`: scout, worker, reviewer and reader. No model pins:
children inherit the dispatching model and thinking level. Parent history is
not forwarded. Only the exact task, reviewed role and shared OpenBSD
instructions are provided. Keep a cold review's task free of build reasoning.

Single, parallel and explicitly requested chains share one native streaming
renderer, including per-child diagnostics without hiding sibling output.
A child exit is process completion, not proof its task is satisfied.
Check the returned evidence before reporting the outcome. Cancellation sends
SIGTERM then SIGKILL if the direct child has not exited. After direct-child
exit, output-pipe draining is bounded; retained descendant pipes are closed
after the grace period and the result is flagged as incomplete. This does not
certify cleanup of arbitrary descendants started by a worker's shell.

Differences from the shipped example:

- User-level roles only. The four supplied roles are part of reviewed source;
  additional files/symlinks in that trusted directory are accepted without a
  runtime review-provenance check. Project-agent requests fail, even in JSON mode;
  discovery never walks project ancestors.
- Disable child extension/MCP/skill/template/theme/context discovery and project
  trust; pass reviewed tools explicitly, or --no-tools for an empty list.
- Do not forward SSH_AUTH_SOCK. No model/provider credential-isolation claim.
- Parent subagent tool is unavailable in children; explicit child marker also
  refuses nested calls. A shell-capable worker can still launch arbitrary code.
- Preserve inherited model selection; absence of a parent model refuses launch.
- Null/signal exit is failure, not exit zero. Fix cancellation escalation: Node's
  child.killed means a signal was sent, not that the child exited.
- Setup exceptions become per-child failures. Parallel work stays supervised
  until every dispatched child returns; one setup failure does not discard the
  aggregate or silently abandon siblings. Invalid input is an error result.

The tool-free reader can analyze text supplied to it, but cannot fetch content.
It is not an isolated ingestion service. A filesystem reviewer has read access
as the normal user, including that user's readable secrets. Neither is an OS
sandbox. Web/YouTube fetching needs a separately configured, approved service.

The UI uses plain ASCII status labels. Fleet services,
scheduled missions, background daemons and automatic model routing are absent.
