# OpenBSD administration

Use base interfaces and the installed release's man pages: rcctl/rc.d for
services, doas for elevation, pf for packet filtering, syslog for logs,
cron for scheduled programs, syspatch for release fixes and pkg_add for
repository packages. Do not import systemd, Linux /proc assumptions or GNU
flags. The configured Pi shell is ksh even where its tool is named bash.

A maintenance task links intent, affected machine/config, current evidence,
verification and recovery. Distinguish a service process running from service
availability, a loaded firewall from reachable authorized access, and a backup
job's success from tested restore. Preserve existing configuration and unrelated
changes. Review the requested change before elevation through admin_step.

Check graphics, Wi-Fi, suspend, keyboard, storage and locking on the affected
machine. A service or command's success does not establish physical behavior.
Do not relax a browser's sandbox, TLS or other checks to make it appear working.

Operational approval rules remain in agent AGENTS.md and admin_step.
