# dmenuwifi: scan, pick, key, join, remember. It writes /etc/hostname.IF,
# which only root may; here that is $T/etc/hostname.IF (see derived). The
# scan lines follow ieee80211_printnode() in ifconfig.c: name (quoted when
# it has a space, hex when it has a byte outside printable ASCII), chan,
# bssid, signal, rate, then the capability bits with the WPA versions.

wifi_setup() {
	command -v script >/dev/null 2>&1 || skip "no script(1) to provide a terminal"
	mkdir -p "$T/etc"
	wifi=$(derived .local/bin/dmenuwifi dmenuwifi "s|/etc/hostname\.|$T/etc/hostname.|g")
	esc=$(printf '\033')
	fx ifconfig.scan <<EOF
		nwid "cafe net" chan 6 bssid 00:11:22:33:44:55 71% 54M privacy,short_slottime,wpa2
		nwid "cafe net" chan 11 bssid 00:11:22:33:44:66 40% 54M privacy,short_slottime,wpa2
		nwid FreeWifi chan 1 bssid 00:11:22:33:44:77 60% 54M short_slottime
		nwid 0x41e9 chan 1 bssid 00:11:22:33:44:99 50% 54M privacy,wpa2
		nwid "" chan 3 bssid 00:11:22:33:44:aa 30% 54M privacy,wpa2
		nwid bad${esc}[31m chan 5 bssid 00:11:22:33:44:bb 29% 54M short_slottime
		nwid eduroam chan 36 bssid 00:11:22:33:44:cc 55% HT-MCS23 privacy,wpa2,802.1x
		nwid \$(reboot) chan 2 bssid 00:11:22:33:44:dd 45% 54M privacy,wpa3,wpa2
		nwid x chan 1 bssid 00:00:00:00:00:00 y chan 4 bssid 00:11:22:33:44:88 -62dBm 54M short_slottime
EOF
}
# wifi_run INPUT: run dmenuwifi in a terminal, typing INPUT there.
wifi_run() {
	printf '%s\n' "$VT_KSH $wifi" >"$T/.ttycmd"
	if script --version 2>/dev/null | grep -q util-linux; then
		( "$VT_REAL_SLEEP" 0.5; printf '%s\n' "$1" ) |
			script -qec "$VT_SH $T/.ttycmd" /dev/null >"$T/tty.out" 2>&1
	else
		( "$VT_REAL_SLEEP" 0.5; printf '%s\n' "$1" ) |
			script -c "$VT_SH $T/.ttycmd" /dev/null >"$T/tty.out" 2>&1
	fi
}

t_wifi_menu() {
	wifi_setup
	wifi_run ''
	logged '^doas true$'
	logged '^doas ifconfig iwn0 scan$'
	eq "one line per name, strongest first; hidden and control-character names left out" \
"cafe net  🔒 71%
FreeWifi  🔓 60%
0x41e9  🔒 50%
eduroam  🔒 55%
\$(reboot)  🔒 45%
x chan 1 bssid 00:00:00:00:00:00 y  🔓 -62dBm" "$(cat "$VT_STATE/menu.1")"
	notlogged 'join'
}

t_wifi_join_wpa() {
	wifi_setup
	: >"$T/etc/hostname.iwn0"; : >"$VT_STATE/doas.keepin"
	answers "cafe net  🔒 71%" Yes
	wifi_run ' s3cret pass'
	logged '^doas ifconfig iwn0 join cafe net wpakey  s3cret pass$'
	hasnt "key not echoed" "s3cret" "$(cat "$T/tty.out")"
	logged "^doas tee -a $T/etc/hostname\\.iwn0\$"
	eq "join line" 'join "cafe net" wpakey " s3cret pass"' "$(cat "$VT_STATE/doas.in")"
}

t_wifi_join_open_no() {
	wifi_setup
	: >"$T/etc/hostname.iwn0"
	answers "FreeWifi  🔓 60%" No
	wifi_run ''
	logged '^doas ifconfig iwn0 join FreeWifi$'
	hasnt "no key asked" "Key for" "$(cat "$T/tty.out")"
	notlogged '^doas tee'
}

t_wifi_join_open_remember() {
	wifi_setup
	: >"$T/etc/hostname.iwn0"; : >"$VT_STATE/doas.keepin"
	answers "x chan 1 bssid 00:00:00:00:00:00 y  🔓 -62dBm" Yes
	wifi_run ''
	logged '^doas ifconfig iwn0 join x chan 1 bssid 00:00:00:00:00:00 y$'
	eq "join line" 'join "x chan 1 bssid 00:00:00:00:00:00 y"' "$(cat "$VT_STATE/doas.in")"
}

t_wifi_hex_name() {
	wifi_setup
	answers "0x41e9  🔒 50%"
	wifi_run 'longenough'
	logged '^doas ifconfig iwn0 join 0x41e9 wpakey longenough$'
}

t_wifi_unsafe_not_remembered() {
	wifi_setup
	: >"$T/etc/hostname.iwn0"; : >"$VT_STATE/doas.keepin"
	answers "\$(reboot)  🔒 45%" Yes
	wifi_run 'longenough'
	logged '^doas ifconfig iwn0 join \$\(reboot\) wpakey longenough$'
	notlogged '^doas tee'
	logged '^notify-send 📶 Not remembered'
	[ -s "$VT_STATE/doas.in" ] && fail "wrote a line netstart would eval"
	return 0
}

t_wifi_no_hostname_file() {
	wifi_setup
	answers "FreeWifi  🔓 60%" Yes
	wifi_run ''
	logged "^notify-send 📶 Not remembered There is no $T/etc/hostname\\.iwn0\\.\$"
	notlogged '^doas tee'
}

t_wifi_typed_and_escape() {
	wifi_setup
	answers "evil net"
	wifi_run ''
	notlogged 'join'
	: >"$VT_STATE/log"; "$VT_REAL_RM" -f "$VT_STATE/dmenu.n" "$VT_STATE/answers"
	wifi_run ''
	notlogged 'join'
}

t_wifi_enterprise_refused() {
	wifi_setup
	answers "eduroam  🔒 55%"
	wifi_run 'x'
	notlogged 'join'
	logged '^notify-send 📶 eduroam WPA Enterprise'
}

t_wifi_interface_down() {
	wifi_setup
	printf '\t\tcannot scan, interface is down\n' | fx ifconfig.scan
	wifi_run ''
	logged '^doas ifconfig iwn0 up$'
	eq "scanned again" 2 "$(nlogged '^doas ifconfig iwn0 scan$')"
}

t_wifi_no_interface() {
	wifi_setup
	fx ifconfig <<'EOF'
em0: flags=8843<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	media: Ethernet autoselect (1000baseT full-duplex)
	status: active
EOF
	wifi_run ''
	logged '^notify-send 📶 dmenuwifi No wireless interface\.$'
	notlogged '^doas'
}

t_wifi_reopens_in_terminal() {
	"$VT_KSH" "$REPO/.local/bin/dmenuwifi"
	logged "^xterm -name floatterm -geometry 64x6 -e $REPO/\\.local/bin/dmenuwifi\$"
	notlogged '^doas'
}

t_wifi_sb_internet_click() {
	BLOCK_BUTTON=1 sb-internet >/dev/null
	logged '^detach dmenuwifi$'
	: >"$VT_STATE/log"
	BLOCK_BUTTON=2 sb-internet >/dev/null
	logged '^notify-send 🌐 Network'
}

t_wifi_ifconfig_mock() {
	ifconfig -x 2>/dev/null && fail "mock took -x"
	eq "group wlan" iwn0 "$(ifconfig wlan | sed -n 's/:.*//p' | sed 1q)"
	has "every interface" "wg0:" "$(ifconfig -a)"
	ifconfig nosuch0 2>/dev/null && fail "no such interface: exit 0"
	return 0
}
