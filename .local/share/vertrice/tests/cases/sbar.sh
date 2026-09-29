# sbar, sb-refresh and sb-show. Fake blocks under the names sbar runs, so
# the joined line is known: sb-news fails and sb-mailbox prints nothing
# (both must be left out), and sb-memory counts its runs, so each redraw
# is visible.

fakeblocks() {
	for b in sb-music:"♫ song" sb-cpu:cpu sb-volume:vol sb-battery:bat \
	    sb-internet:net sb-clock:clock; do
		printf '#!/bin/sh\necho "%s"\n' "${b#*:}" >"$T/bin/${b%%:*}"
	done
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/sb-news"
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/sb-mailbox"
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/sb-updates"
	cat >"$T/bin/sb-memory" <<'EOF'
#!/bin/sh
n=$(( $(cat "$T/memruns" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$T/memruns"
echo "mem$n"
EOF
	chmod +x "$T/bin/"*
	pidfile=$XDG_CACHE_HOME/sbar.pid
}
line() { printf '♫ song cpu mem%s vol bat net clock' "$1"; }
lines() { [ "$(wc -l <"$T/bar.out")" -ge "$1" ]; }
gone() { ! kill -0 "$1" 2>/dev/null; }

t_sbar_once() {
	fakeblocks
	eq "one line, failed and empty blocks left out" "$(line 1)" "$(sbar -1)"
	[ -f "$XDG_CACHE_HOME/sbar.pid" ] && fail "-1 wrote a pidfile"
	return 0
}

t_sbar_print_usr1_duplicate() {
	fakeblocks
	sbar -p >"$T/bar.out" 2>&1 &
	pid=$!; track "$pid"
	waitfor 3 lines 1 || fail "no first line"
	eq "first line" "$(line 1)" "$(sed -n 1p "$T/bar.out")"
	eq "pidfile names the loop" "$pid" "$(cat "$pidfile")"
	# The interval is 5 s: a second line within 2 s means USR1 woke it.
	kill -USR1 "$pid"
	waitfor 2 lines 2 || fail "USR1 did not redraw"
	eq "redraw" "$(line 2)" "$(sed -n 2p "$T/bar.out")"
	out=$(sbar -p 2>&1); rc=$?
	eq "second sbar refused" 1 "$rc"
	eq "and says why" "sbar: already running as $pid" "$out"
	sb-refresh
	waitfor 2 lines 3 || fail "sb-refresh did not redraw"
	kill -0 "$pid" || fail "sbar died"
	kill -TERM "$pid"
	waitfor 2 gone "$pid" || fail "TERM did not stop sbar"
	[ -f "$pidfile" ] && fail "pidfile left after TERM"
	return 0
}

t_sbar_stale_pidfile() {
	fakeblocks
	"$VT_REAL_SLEEP" 30 &
	other=$!; track "$other"
	echo "$other" >"$pidfile"
	sb-refresh
	"$VT_REAL_SLEEP" 0.2
	kill -0 "$other" 2>/dev/null || fail "sb-refresh signalled a process that is not sbar"
	sbar -p >"$T/bar.out" 2>&1 &
	pid=$!; track "$pid"
	waitfor 3 lines 1 || { cat "$T/bar.out"; fail "sbar refused to start over a stale pidfile"; }
	eq "pidfile taken over" "$pid" "$(cat "$pidfile")"
	kill "$pid" "$other"
}

t_sb_refresh_no_bar() {
	sb-refresh; eq "no pidfile: exit 0" 0 "$?"
}

t_sbar_xsetroot() {
	fakeblocks
	sbar &
	pid=$!; track "$pid"
	waitfor 3 grep -q "^xsetroot -name $(line 1)\$" "$VT_STATE/log" || fail "root name not set"
	kill "$pid"
	waitfor 2 gone "$pid" || fail "sbar did not stop"
}

t_sbar_exits_without_x() {
	fakeblocks
	echo 1 >"$VT_STATE/rc.xsetroot"
	sbar >/dev/null 2>&1 &
	pid=$!; track "$pid"
	waitfor 3 gone "$pid" || fail "sbar kept running with X gone"
	wait "$pid"; eq "exit status" 1 "$?"
	[ -f "$pidfile" ] && fail "pidfile left behind"
	return 0
}

t_sb_show() {
	fakeblocks
	sb-show
	logged "^notify-send -t 5000 $(line 1)\$"
}

t_sbar_real_blocks() {
	# The real blocks, on the mocks: each shows up in its place.
	out=$(sbar -1)
	has "cpu" "🌡 52°C 🧠0.44GiB/7.77GiB 🔉50% 🔋87% 📶 71% ❎ 🔒" "$out"
}
