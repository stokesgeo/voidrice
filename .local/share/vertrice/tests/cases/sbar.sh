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
	printf '#!/bin/sh\necho\n' >"$T/bin/sb-updates"
	cat >"$T/bin/sb-memory" <<'EOF'
#!/bin/sh
n=$(( $(cat "$T/memruns" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$T/memruns"
echo "mem$n"
EOF
	chmod +x "$T/bin/"*
}
line() { printf '♫ song cpu mem%s vol bat net clock' "$1"; }
draws() { [ "$(grep -c '^xsetroot' "$VT_STATE/log")" -ge "$1" ]; }
gone() { ! kill -0 "$1" 2>/dev/null; }

t_sbar_once() {
	fakeblocks
	eq "one line, failed and empty blocks left out" "$(line 1)" "$(sbar -1)"
}

t_sbar_xsetroot() {
	fakeblocks
	sbar &
	pid=$!; track "$pid"
	waitfor 3 grep -q "^xsetroot -name $(line 1)\$" "$VT_STATE/log" || fail "root name not set"
	kill "$pid"
	waitfor 2 gone "$pid" || fail "sbar did not stop"
}

# sb-refresh finds sbar by its path; the pkill mock signals only what runs
# under $T, so this sbar runs from $T/statusbar.
t_sbar_refresh() {
	fakeblocks
	mkdir -p "$T/statusbar" && cp "$REPO/.local/bin/statusbar/sbar" "$T/statusbar/sbar"
	"$VT_KSH" "$T/statusbar/sbar" &
	pid=$!; track "$pid"
	waitfor 3 draws 1 || fail "no first draw"
	# The interval is 5 s: a second draw within 2 s means USR1 woke it.
	sb-refresh
	waitfor 2 draws 2 || fail "sb-refresh did not redraw"
	logged "^xsetroot -name $(line 2)\$"
	kill -0 "$pid" || fail "sbar died"
	kill "$pid"
}

# sbar -t, the bar under cwm: it turns off wrap and the cursor, then
# redraws the one line in place; sb-refresh reaches it as it reaches sbar.
t_sbar_term() {
	fakeblocks
	mkdir -p "$T/statusbar" && cp "$REPO/.local/bin/statusbar/sbar" "$T/statusbar/sbar"
	"$VT_KSH" "$T/statusbar/sbar" -t >"$T/bar.out" &
	pid=$!; track "$pid"
	waitfor 3 grep -q mem1 "$T/bar.out" || fail "no first draw"
	eq "first draw" "$(printf '\033[?7l\033[?25l\r\033[K%s' "$(line 1)")" "$(cat "$T/bar.out")"
	sb-refresh
	waitfor 2 grep -q mem2 "$T/bar.out" || fail "sb-refresh did not redraw the bar"
	notlogged '^xsetroot'
	kill "$pid"
}

# The session starts the bar and cwmrc knows it: for xterm and for st, the
# instance name is one cwmrc puts in no group, the title one it ignores, and
# a bottom gap keeps windows off it.
t_sbar_cwm_bar() {
	c=$REPO/.config/cwm/cwmrc
	grep -Eq '^gap 0 [1-9][0-9]* 0 0$' "$c" || fail "cwmrc: no bottom gap"
	for t in xterm:-name:XTerm st:-n:St; do
		IFS=: read -r term opt class <<-EOF
		$t
		EOF
		x=$(grep -E "(^|then |else )$term .*-e sbar -t &" "$REPO/.config/x11/xinitrc") ||
			fail "xinitrc starts no $term bar"
		name=$(printf '%s\n' "$x" | sed -n "s/.* $opt \([^ ]*\) .*/\1/p")
		[ -n "$name" ] || fail "the $term bar has no $opt"
		has "$term title" "-T $name " "$x"
		grep -qx "autogroup 0 \"$name,$class\"" "$c" || fail "cwmrc: no autogroup 0 for $name,$class"
		grep -qx "ignore $name" "$c" || fail "cwmrc: no ignore $name"
	done
}

# The xinitrc picks the bar's terminal by $TERMINAL, then runs cwm.
t_sbar_session_start() {
	sed -n '/^\[ "\$WM" = dwm \]/,$p' "$REPO/.config/x11/xinitrc" |
		sed 's/^exec "\$@" cwm.*/echo cwm/' >"$T/tail"
	grep -q '^echo cwm' "$T/tail" || fail "cannot cut the session tail from xinitrc"
	for term in xterm st; do
		: >"$VT_STATE/log"
		out=$(WM=cwm TERMINAL=$term "$VT_SH" "$T/tail")
		eq "$term: then cwm" cwm "$out"
		waitfor 2 grep -q "^$term " "$VT_STATE/log" || fail "$term: no bar started"
		notlogged "^xsetroot"
		[ "$term" = xterm ] && logged '^xterm -name vbar -T vbar -geometry 300x1\+0-0 -e sbar -t$'
	done
	logged '^st -n vbar -T vbar -g 300x1\+0-0 -e sbar -t$'
}

t_sbar_exits_without_x() {
	fakeblocks
	echo 1 >"$VT_STATE/rc.xsetroot"
	sbar >/dev/null 2>&1 &
	pid=$!; track "$pid"
	waitfor 3 gone "$pid" || fail "sbar kept running with X gone"
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
