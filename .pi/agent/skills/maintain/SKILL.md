---
name: maintain
description: Diagnose or maintain this OpenBSD laptop. Load for service faults, package/config changes and system repair.
---
# Maintain

Establish current state, OpenBSD release and architecture before explaining a
fault. Consult native man pages and existing configuration; prefer base tools
and repository packages. Preserve owner settings and unrelated changes.

Reproduce where practical. After two failed fixes, reassess the assumptions.
Name the affected boundary: app/service restart, session login, or boot. Verify
there, not just with syntax checks. Route root operations through admin_step;
children return privileged work to the parent. Keep recovery proportional to
the change. Report observed results and remaining hardware/account ceilings.
