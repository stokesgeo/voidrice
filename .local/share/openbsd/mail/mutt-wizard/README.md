# OpenBSD mail runtime

This optional OpenBSD mail workflow requires python3, mutt-wizard dependencies
(neomutt, isync, msmtp), password-store, GPG, curl and git. Configure your own
accounts and initialize your existing encryption key/pass store explicitly.
No account defaults or credentials are shipped.

This source-owned bundle provides explicit commands:

- `vertrice-mail -a ADDRESS [-i HOST]`: confirm the endpoint, enter an app
  password on the protected terminal, verify TLS, and create local INBOX setup.
  `-e ADDRESS` edits/replaces credentials through the guarded flow; `-R ADDRESS`
  changes the default; `-D ADDRESS` removes configuration, retaining credentials
  and messages. `-l` lists accounts; `-Y` downloads manually. Sending is disabled.
- `vertrice-mail-sync [CHANNEL ...]`: foreground download using the user's
  existing mbsync configuration. No enrollment, scheduler, sending or implicit
  credential setup. With no operands, runs each literal configured Channel.
- `vertrice-mail-openfile FILE`: retain a private local attachment copy before
  asking xdg-open to dispatch it. Failed handoffs report the retained copy.

Launchers resolve assets beneath `${XDG_DATA_HOME:-$HOME/.local/share}`.
The mailcap uses the attachment launcher and `html-to-text` for local HTML
rendering. Keep NeoMutt's default mailcap_sanitize enabled.

The unmodified public mutt-wizard package inputs are in `originals/`.
`runtime/` contains the patched source scripts, not account or session output.
The small `runtime-build` interface reconstructs either script into an absent
output beneath /tmp or HOME:

```sh
sh build --bundle /tmp/absent-mail-bundle
sh runtime-build mailsync /tmp/absent-mailsync
sh runtime-build openfile /tmp/absent-openfile
```

The builder verifies baseline, patch and output hashes before publishing; it
never installs or reads installed commands by default. The optional final
baseline operand must match the same exact hash. Requirements are OpenBSD base
sh, ksh, sha256, patch and filesystem tools. Runtime sync needs mbsync and its
explicitly configured credential command; viewing needs xdg-open and a viewer.

Upstream: Luke Smith's mutt-wizard, v3.3.1. Package version and exact source
hashes are in runtime-provenance.json. GPLv3 applies; see LICENSE. Vertrice
modified these helpers on 2026-11-25 for bounded manual sync diagnostics and
private attachment retention. No warranty is provided.

Path checks assume a cooperating same-user environment, not race isolation.
Native configuration and MIME viewers are trusted code, not sandboxes.
Successful xdg-open return means handoff, not viewer readiness. Retained copies
are not automatically deleted. Enrollment uses app passwords through native pass/GPG; OAuth, SMTP sending,
automatic scheduling and POP remain unsupported. Cancelled or interrupted setup
may retain encrypted staging and recovery journals. Read the reported checkpoint
and resume through the same command; do not delete working credentials to retry.
