# OpenBSD maintenance

Check the installed release/architecture and native manuals. Prefer base tools:
rcctl/rc.d, doas, pf, syslog, cron and syspatch; use repository packages when
base lacks a capability. Never assume systemd, /proc or GNU options.

Before a consequential change establish current state, exact intended effect,
verification and recovery. Use admin_step when provided, with fresh approval for
each explicit invocation; children return privilege work to the parent. Stop
if that interface is required but unavailable. Verify the service/device boundary,
not merely exit status; hardware and account behavior need their own checks.
