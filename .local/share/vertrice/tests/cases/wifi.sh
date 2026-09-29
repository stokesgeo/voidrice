# dmenuwifi, in a terminal (script(1)), with /etc/hostname.IF moved under
# $T (see derived). Scan lines as ifconfig.c's ieee80211_printnode() prints.

wifi_setup() {
	command -v script >/dev/null 2>&1 || skip "no script(1) to provide a terminal"
	mkdir -p "$T/etc"; : >"$T/etc/hostname.iwn0"; : >"$VT_STATE/doas.keepin"
	wifi=$(derived .local/bin/dmenuwifi dmenuwifi "s|/etc/hostname\.|$T/etc/hostname.|")
	fx ifconfig.scan <<EOF
		nwid "cafe net" chan 6 bssid 00:11:22:33:44:55 71% 54M privacy,short_slottime,wpa2
		nwid "cafe net" chan 11 bssid 00:11:22:33:44:66 40% 54M privacy,short_slottime,wpa2
		nwid FreeWifi chan 1 bssid 00:11:22:33:44:77 60% 54M short_slottime
		nwid "" chan 3 bssid 00:11:22:33:44:aa 30% 54M privacy,wpa2
		nwid \$(reboot) chan 2 bssid 00:11:22:33:44:dd -62dBm 54M privacy,wpa2
EOF
}
# wifi_run TYPED: run it in a terminal, typing TYPED there.
wifi_run() {
	o=-c; script --version 2>/dev/null | grep -q util-linux && o=-qec	# as with_tty
	( "$VT_REAL_SLEEP" 0.5; printf '%s\n' "$1" ) |
		script $o "$VT_KSH $wifi" /dev/null >"$T/tty.out" 2>&1
}

t_wifi_join_remember() {
	wifi_setup
	answers "🔒 cafe net" Yes
	wifi_run ' s3cret pass'
	eq "menu: one line per name, strongest first, hidden names left out" \
"🔒 cafe net
🔓 FreeWifi
🔒 \$(reboot)" "$(cat "$VT_STATE/menu.1")"
	logged '^doas ifconfig iwn0 join cafe net wpakey  s3cret pass$'
	hasnt "key not echoed" "s3cret" "$(cat "$T/tty.out")"
	eq "join line" 'join "cafe net" wpakey " s3cret pass"' "$(cat "$VT_STATE/doas.in")"
}

t_wifi_open_and_unsafe() {
	wifi_setup
	answers "🔓 FreeWifi" No
	wifi_run ''
	logged '^doas ifconfig iwn0 join FreeWifi$'
	notlogged '^doas tee'
	: >"$VT_STATE/log"; "$VT_REAL_RM" "$VT_STATE/dmenu.n"
	answers "🔒 \$(reboot)" Yes
	wifi_run 'longenough'
	logged '^doas ifconfig iwn0 join \$\(reboot\) wpakey longenough$'
	notlogged '^doas tee'	# netstart would eval it at boot
	: >"$VT_STATE/log"; "$VT_REAL_RM" "$VT_STATE/dmenu.n"
	answers "typed net"
	wifi_run ''
	notlogged 'join'	# only what was offered
}

# Super+Shift+F11 runs it; it reopens itself in a terminal for doas.
t_wifi_key_opens_terminal() {
	eq "cwm key" dmenuwifi "$(awk '$2 == "4S-F11" { print $3 }' "$REPO/.config/cwm/cwmrc")"
	"$VT_KSH" "$REPO/.local/bin/dmenuwifi"
	logged "^xterm -name floatterm -geometry 64x4 -e $REPO/\\.local/bin/dmenuwifi\$"
}
