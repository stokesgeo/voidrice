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
