# calendar(1) reminders: the starter file, the nomail switch and the agent
# wiring (a cdxb grant and the AGENTS.md lines). vertrice-install's crontab
# line is in install.sh.

t_calendar_starter() {
	# calendar runs cpp on the file first (usr.bin/calendar/io.c: cpp
	# -traditional -undef -U__GNUC__ -P -I. -w). What is left must be
	# reminders only: a date, a tab, the text.
	command -v cpp >/dev/null 2>&1 || skip "no cpp on this host"
	f=$REPO/.calendar/calendar
	out=$(cpp -traditional -undef -U__GNUC__ -P -I. -w <"$f" | grep .)
	[ -n "$out" ] || fail "no reminder lines"
	hasnt "the comment is gone" "/*" "$out"
	eq "every line: a date, a tab, the text" "" \
		"$(printf '%s\n' "$out" | grep -v '^[^	]*[0-9A-Za-z*][^	]*	[^	]')"
	# calendar -a (daily(8)) mails nothing while ~/.calendar/nomail exists;
	# the morning crontab job mails instead.
	[ -f "$REPO/.calendar/nomail" ] || fail "no ~/.calendar/nomail"
}

t_calendar_agent_grant() {
	# Every cdxb session may change ~/.calendar.
	cdxb_setup
	mkdir -p "$HOME/.calendar"
	cd "$HOME/src/proj" || fail "no project"
	out=$(cdxb 2>&1 </dev/null) || fail "cdxb failed: $out"
	wall "the calendar may change" "rwxc:$HOME/.calendar"
	hasnt "no grant skipped" "cdxb:" "$out"
	grep -q '^rw ~/.calendar$' "$REPO/.config/cdxb/grants" || fail "no grant line"
}

t_calendar_agents_md() {
	# The agent instructions say where the reminders are and how to add one,
	# in plain ASCII as cdxb review requires of the file.
	f=$REPO/.local/share/openbsd/codex/AGENTS.md
	grep -q '~/.calendar/calendar' "$f" || fail "AGENTS.md: no calendar path"
	grep -q 'calendar(1)' "$f" || fail "AGENTS.md: no format"
	eq "AGENTS.md is ASCII" "" "$(LC_ALL=C grep -n '[^	 -~]' "$f")"
}
