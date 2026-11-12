# The terminal helper must run the command even when the caller has no input.
t_harness_privileged_rm_is_log_only() {
	# The sentinel never removes anything. Even an outside-scratch argument
	# must not reach the forwarding rm mock's real-command slot.
	cat >"$T/real-rm-sentinel" <<'EOF'
#!/bin/sh
echo reached >>"$VT_STATE/real-rm-reached"
EOF
	chmod +x "$T/real-rm-sentinel"
	VT_REAL_RM="$T/real-rm-sentinel" "$VT_MOCKS/doas" rm -f /not-a-real-fixture-path/outside
	[ ! -e "$VT_STATE/real-rm-reached" ] || fail 'mock doas delegated removal outside the fixture'
	logged '^doas rm -f /not-a-real-fixture-path/outside$'
}

t_harness_pty_eof() {
	pty 'test -t 0 && printf terminal-ready' </dev/null >"$T/out" 2>&1
	has "child ran with a terminal" terminal-ready "$(cat "$T/out")"
}

t_harness_pty_input() {
	( waitfor 5 test -f "$T/ready" && printf 'hello\n' ) |
		pty 'touch "$T/ready"; read answer; printf "answer=%s" "$answer"' >"$T/out" 2>&1
	has "input reached the child" answer=hello "$(cat "$T/out")"
}

t_harness_pty_status() {
	pty 'exit 3' </dev/null >"$T/out" 2>&1
	eq "child status returned" 3 "$?"
}

t_harness_pty_early_input() {
	[ "$VT_HOST" = OpenBSD ] || skip "OpenBSD terminal setup before input"
	printf 'hello\n' | pty 'read answer; printf "answer=%s" "$answer"' >"$T/out" 2>&1
	has "early input survived terminal setup" answer=hello "$(cat "$T/out")"
}

t_harness_live_clears_click_actions() {
	# Run the actual live branch with sentinel blocks, never host controls.
	for b in sb-battery sb-brightness sb-cpu sb-cpubars sb-internet \
	    sb-memory sb-nettraf sb-volume sb-clock sb-disk sb-updates; do
		cat >"$T/bin/$b" <<'EOF'
#!/bin/sh
[ -z "${BLOCK_BUTTON:-}" ] || echo leaked >"$VT_STATE/live-button-leaked"
EOF
		chmod +x "$T/bin/$b"
	done
	sed -n '/^if \[ -n "\$live" \]; then$/,/^fi$/p' "$REPO/.local/share/vertrice/tests/run" >"$T/live-branch"
	[ -s "$T/live-branch" ] || fail 'live branch not extracted'
	env live=1 os=OpenBSD RUN="$T/live" wrap="$T/bin" syspath="$PATH" \
		BLOCK_BUTTON=4 "$VT_SH" "$T/live-branch" >"$T/live-output"
	[ ! -e "$VT_STATE/live-button-leaked" ] || fail 'live branch passed a click action to a block'
}
