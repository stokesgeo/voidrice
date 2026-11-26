# Verification

Test deterministic claims at the changed entrypoint. For desktop/service/boot
changes, name which boundary was exercised and which was not. A fixture proves
only its tested contract, not hardware readiness or owner acceptance.

Use independent cold review for consequential changes where available, supplying
the artifact and question. Name exact defects and impacts; fix material findings
and rerun affected checks. Review cannot replace testing or owner decisions.
Handoff: scope, changed paths, PASS/FAIL/SKIP evidence, recovery and next action.
Do not close work from a queued request, successful subprocess or unverified claim.
