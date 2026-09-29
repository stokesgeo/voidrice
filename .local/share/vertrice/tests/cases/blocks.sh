# Status blocks: each runs against the mocks and must print exactly what
# the bar should show. Mock defaults are an X220 on battery at 87%.

t_sb_battery() {
	eq "discharging" "🔋87%" "$(sb-battery)"
	eq "discharging and low" "🔋❗20%" "$(APM_L=20 sb-battery)"
	eq "charging" "🔌55%" "$(APM_L=55 APM_B=3 sb-battery)"
	eq "on AC, full" "⚡100%" "$(APM_L=100 APM_A=1 sb-battery)"
	eq "on AC, not charging" "🛑80%" "$(APM_L=80 APM_A=1 sb-battery)"
	eq "AC state unknown" "♻️87%" "$(APM_A=255 sb-battery)"
	out=$(APM_B=4 sb-battery); rc=$?
	eq "no battery: exit 1" 1 "$rc"
	eq "no battery: no output" "" "$out"
}

t_sb_brightness() {
	eq "level" "💡70%" "$(sb-brightness)"
	eq "fraction dropped" "💡5%" "$(WSCONS_BRIGHTNESS=5.49% sb-brightness)"
	WSCONS_FAIL=1 sb-brightness >/dev/null 2>&1
	eq "no console access: exit 1" 1 "$?"
}

t_sb_cpu() {
	eq "cpu0 sensor" "🌡 52°C" "$(sb-cpu)"
	setsysctl hw.sensors.cpu0.temp0 "<missing>"
	eq "falls back to acpitz0" "🌡 50°C" "$(sb-cpu)"
	setsysctl hw.sensors.acpitz0.temp0 "<missing>"
	sb-cpu >/dev/null 2>&1
	eq "no sensor: exit 1" 1 "$?"
	echo 0 >"$VT_STATE/rc.sysctl-missing"
	out=$(sb-cpu 2>/dev/null); rc=$?
	eq "no sensor, sysctl exits 0: exit 1" 1 "$rc"
	eq "no sensor, sysctl exits 0: no output" "" "$out"
}

t_sb_cpubars() {
	eq "first run: no history, no bars" "🪨" "$(sb-cpubars)"
	[ -f "$XDG_CACHE_HOME/cpubarscache" ] || fail "no cache written"
	# cpu0: 100 ticks, 50 idle: half load. cpu2: 100 ticks, none idle.
	# cpu1 and cpu3 are offline SMT threads: their counters do not move.
	setsysctl kern.cp_time2.0 1050,0,500,0,100,10050
	setsysctl kern.cp_time2.2 3100,0,1000,0,200,5000
	eq "second run: one bar per moving core" "🪨▅█" "$(sb-cpubars)"
	eq "no movement since: no bars" "🪨" "$(sb-cpubars)"
}

t_sb_internet() {
	eq "wifi 71%, no cable, wg up" "📶 71% ❎ 🔒" "$(sb-internet)"
	fx ifconfig <<'EOF'
em0: flags=8843<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	lladdr f0:de:f1:00:00:01
	media: Ethernet autoselect (1000baseT full-duplex)
	status: active
iwn0: flags=8802<BROADCAST,SIMPLEX,MULTICAST> mtu 1500
	groups: wlan
	media: IEEE802.11 autoselect
	status: no network
	ieee80211: nwid ""
EOF
	eq "wifi down, cable in" "❌ 🌐" "$(sb-internet)"
	fx ifconfig <<'EOF'
em0: flags=8802<BROADCAST,SIMPLEX,MULTICAST> mtu 1500
	media: Ethernet autoselect (none)
	status: no carrier
iwn0: flags=a48843<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	groups: wlan
	media: IEEE802.11 autoselect
	status: no network
	ieee80211: nwid ""
tun0: flags=8010<POINTOPOINT,MULTICAST> mtu 1500
EOF
	eq "wifi up, not joined; tun down is no VPN" "📡 ❎" "$(sb-internet)"
	fx ifconfig <<'EOF'
lo0: flags=2008049<UP,LOOPBACK,RUNNING,MULTICAST,LRO> mtu 32768
em0: flags=8802<BROADCAST,SIMPLEX,MULTICAST> mtu 1500
	media: Ethernet autoselect (none)
	status: no carrier
EOF
	eq "no wifi card" "❎" "$(sb-internet)"
}

t_sb_memory() {
	eq "megabytes" "🧠0.44GiB/7.77GiB" "$(sb-memory)"
	eq "kilobytes" "🧠0.50GiB/7.77GiB" "$(MEM_ACT=524288K sb-memory)"
	eq "gigabytes" "🧠2.00GiB/7.77GiB" "$(MEM_ACT=2G sb-memory)"
}

t_sb_nettraf() {
	eq "first run: nothing to compare" "🔻   0B 🔺   0B" "$(sb-nettraf)"
	eq "cache holds the totals, loopback left out" "1000000 20000" "$(cat "$XDG_CACHE_HOME/nettraf")"
	eq "2 KiB in, 100 B out" "🔻2.0KB 🔺 100B" "$(NET_RX=1002048 NET_TX=20100 LO_BYTES=77777 sb-nettraf)"
	eq "5 MiB in" "🔻5.0MB 🔺   0B" "$(NET_RX=6244928 NET_TX=20100 sb-nettraf)"
	# The interface went away and came back: counters restart from zero.
	eq "counter reset shows 0, not a negative" "🔻   0B 🔺   0B" "$(NET_RX=500 NET_TX=10 sb-nettraf)"
	eq "and counts on from the new base" "🔻 100B 🔺  10B" "$(NET_RX=600 NET_TX=20 sb-nettraf)"
}

t_sb_volume() {
	eq "half" "🔉50%" "$(sb-volume)"
	eq "loud" "🔊75%" "$(SND_LEVEL=0.750 sb-volume)"
	eq "quiet" "🔈10%" "$(SND_LEVEL=0.100 sb-volume)"
	eq "zero" "🔇" "$(SND_LEVEL=0.000 sb-volume)"
	eq "rounds to zero" "🔇" "$(SND_LEVEL=0.004 sb-volume)"
	eq "muted" "🔇" "$(SND_MUTE=1 sb-volume)"
	BLOCK_BUTTON=2 sb-volume >/dev/null
	logged '^sndioctl -q output.mute=!$'
	BLOCK_BUTTON=4 sb-volume >/dev/null
	logged '^sndioctl -q output.level=\+0.01$'
}

t_sb_clock() {
	# 2026-09-29 03:25 UTC, a Tuesday.
	eq "morning" "2026 Sep 29 (Tue) 🕒03:25AM" "$(VT_EPOCH=1790652300 sb-clock)"
	eq "noon hour" "2026 Sep 29 (Tue) 🕛12:10PM" "$(VT_EPOCH=1790683800 sb-clock)"
	eq "evening" "2026 Sep 29 (Tue) 🕚11:59PM" "$(VT_EPOCH=1790726340 sb-clock)"
}

# OpenBSD's wc prints each count as " %7lld" (usr.bin/wc/wc.c,
# format_and_print), so `wc -l` on a pipe gives "       0", not "0".
t_sb_mailbox() {
	printf '#!/bin/sh\nprintf " %%7d\\n" "$(grep -c "")"\n' >"$T/bin/wc"
	chmod +x "$T/bin/wc"
	box=$HOME/.local/share/mail/me/INBOX/new
	mkdir -p "$box"
	eq "no unread: nothing" "" "$(sb-mailbox)"
	: >"$box/1"; : >"$box/2"
	eq "two unread" "📬2" "$(sb-mailbox)"
}

t_sb_music() {
	printf '%s\n' "Boards of Canada - Roygbiv" "[playing] #3/10   1:02/2:31 (41%)" \
		"volume: 80%   repeat: off   random: off   single: off   consume: off" \
		>"$VT_STATE/out.mpc"
	eq "playing: title only" "Boards of Canada - Roygbiv" "$(sb-music)"
	printf '%s\n' "Boards of Canada - Roygbiv" "[paused]  #3/10   1:02/2:31 (41%)" \
		"volume: 80%   repeat: off   random: off   single: off   consume: off" \
		>"$VT_STATE/out.mpc"
	eq "paused: title and pause sign" "Boards of Canada - Roygbiv ⏸" "$(sb-music)"
	printf '%s\n' "volume: 80%   repeat: off   random: off   single: off   consume: off" \
		>"$VT_STATE/out.mpc"
	eq "stopped: nothing" "" "$(sb-music)"
	printf '%s\n' "Song" "[playing] #1/1   0:01/1:00 (1%)" "volume: n/a" \
		"ERROR: Failed to decode" "more error text" >"$VT_STATE/out.mpc"
	eq "error lines cut" "Song" "$(sb-music)"
	BLOCK_BUTTON=5 sb-music >/dev/null
	logged '^mpc next$'
	waitfor 2 grep -q '^sb-mpdup' "$VT_STATE/log" || fail "sb-mpdup not started"
}

# sb-doppler's pick: stock dmenu has no -r (the mock refuses it), so the
# answer is checked against the list instead.
t_sb_doppler_pick() {
	for v in mpv; do ln -s "$VT_MOCKS/_log" "$T/bin/$v"; done
	answers "NL: The Netherlands"
	BLOCK_BUTTON=2 sb-doppler >/dev/null
	notlogged 'refused'
	eq "location saved" "NL,The Netherlands" "$(cat "$XDG_CACHE_HOME/radar")"
	logged '^ftp -MV -o .*/doppler\.gif https://cdn\.knmi\.nl/'
	logged '^detach mpv '
	: >"$VT_STATE/log"; rm -f "$XDG_CACHE_HOME/radar" "$VT_STATE/dmenu.n"
	answers "Atlantis"
	BLOCK_BUTTON=2 sb-doppler >/dev/null
	[ -e "$XDG_CACHE_HOME/radar" ] && fail "a typed name not in the list was saved"
	notlogged '^ftp'
	return 0
}

# The key sheet is Super+F1: the cwmrc's bind lines in dmenu.
t_cwmrc_key_sheet() {
	has "Super+F1" "grep ^bind ~/.config/cwm/cwmrc | dmenu" \
		"$(awk '$2 == "4-F1"' "$REPO/.config/cwm/cwmrc")"
	eq "sb-help-icon" "❓" "$(sb-help-icon)"
}
