# The Mac: the stand-ins in ~/.local/bin/darwin, the profile's PATH, and
# the Darwin branches of scripts. uname answers Darwin; the macOS programs
# (choose, osascript, pbcopy, open, curl, aerospace, lsof, pmset) are
# mocks that log each argument between bars, "osascript|-e|...|", so a
# case sees where one argument ends. Nothing here ran on a Mac.

# mac: uname says Darwin, the stand-ins come first in PATH (each run
# under the test shell, as the runner does for bin), and the Mac's
# programs are mocks.
mac() {
	printf '#!/bin/sh\necho Darwin\n' >"$T/bin/uname"
	chmod +x "$T/bin/uname"
	mkdir -p "$T/darwin"
	for f in "$REPO"/.local/bin/darwin/*; do
		printf '#!/bin/sh\nexec %s "%s" "$@"\n' "$VT_SH" "$f" >"$T/darwin/${f##*/}"
		chmod +x "$T/darwin/${f##*/}"
	done
	PATH="$T/darwin:$PATH"
	for c in osascript pbcopy pbpaste open curl aerospace lsof pmset \
	    screencapture brew; do
		argmock "$c"
	done
	# choose: the menu on stdin goes to $VT_STATE/menu.N; the answer is
	# line N of $VT_STATE/answers (answers in lib.sh); none: Escape, exit 1.
	cat >"$T/bin/choose" <<'EOF'
#!/bin/sh
printf 'choose|' >>"$VT_STATE/log"; printf '%s|' "$@" >>"$VT_STATE/log"; echo >>"$VT_STATE/log"
n=$(( $(cat "$VT_STATE/choose.n" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$VT_STATE/choose.n"
cat >"$VT_STATE/menu.$n"
[ "$(wc -l <"$VT_STATE/answers" 2>/dev/null || echo 0)" -ge "$n" ] || exit 1
sed -n "${n}p" "$VT_STATE/answers"
EOF
	chmod +x "$T/bin/choose"
}

# argmock NAME: log "NAME|arg|arg|", keep stdin in $VT_STATE/in.NAME,
# print $VT_STATE/out.NAME, exit with $VT_STATE/rc.NAME (default 0).
argmock() {
	cat >"$T/bin/$1" <<'EOF'
#!/bin/sh
n=${0##*/}
printf '%s|' "$n" "$@" >>"$VT_STATE/log"; echo >>"$VT_STATE/log"
[ -t 0 ] || cat >"$VT_STATE/in.$n"
[ -f "$VT_STATE/out.$n" ] && cat "$VT_STATE/out.$n"
exit "$(cat "$VT_STATE/rc.$n" 2>/dev/null || echo 0)"
EOF
	chmod +x "$T/bin/$1"
}

t_darwin_dmenu() {
	mac
	answers b
	out=$(printf 'a\nb\n' | dmenu -i -l 30 -p 'Open it with?' -fn 'IBM Plex Mono:size=10' -nb '#000' -b)
	eq "the pick" b "$out"
	logged '^choose\|-m\|-e\|-n\|30\|-p\|Open it with\?\|$'
	eq "the menu" "a
b" "$(cat "$VT_STATE/menu.1")"
	printf 'x\n' | dmenu; eq "Escape: exit 1" 1 "$?"
}

# The palette theme set: the accent behind the chosen line, the text
# colour for matched letters, before the caller's options.
t_darwin_dmenu_palette() {
	mac
	mkdir -p "$HOME/.config/x11" "$XDG_CACHE_HOME"
	cp -R "$REPO/.config/x11/themes" "$HOME/.config/x11/"
	echo night >"$XDG_CACHE_HOME/theme"
	answers a
	printf 'a\n' | dmenu -p Pick: >/dev/null
	acc=$(sed -n 's/^\*\.color4: #//p' "$REPO/.config/x11/themes/night")
	fg=$(sed -n 's/^\*\.foreground: #//p' "$REPO/.config/x11/themes/night")
	logged "^choose\|-m\|-e\|-b\|$acc\|-c\|$fg\|-p\|Pick:\|\$"
}

t_darwin_xclip() {
	mac
	printf hello | xclip -selection clipboard
	logged '^pbcopy\|$'
	eq "copied" hello "$(cat "$VT_STATE/in.pbcopy")"
	echo pasted | fx out.pbpaste
	eq "-o pastes" pasted "$(xclip -o)"
}

t_darwin_notify_send() {
	mac
	notify-send -u low -t 5000 -i pic 'He said "hi"' 'body \ text'
	logged '^osascript\|-e\|on run a\|-e\|display notification \(item 2 of a\) with title \(item 1 of a\)\|-e\|end run\|He said "hi"\|body \\ text\|$'
	notify-send 'title only'
	logged '\|title only\|\|$'
}

t_darwin_xdg_open() {
	mac
	xdg-open 'https://example.org/a b'
	logged '^open\|https://example.org/a b\|$'
}

t_darwin_ftp() {
	mac
	ftp -MV -o - https://example.org/x
	logged '^curl\|-fsSL\|-o\|-\|https://example.org/x\|$'
	ftp -MV -w 5 -U curl -o "$T/my file" https://wttr.is/
	logged "^curl\\|-fsSL\\|--connect-timeout\\|5\\|-A\\|curl\\|-o\\|$T/my file\\|https://wttr.is/\\|\$"
	ftp https://example.org/song.mp3	# qndl's "ftp URL": the URL's name
	logged '^curl\|-fsSL\|-O\|https://example.org/song.mp3\|$'
}

t_darwin_ghostty() {
	mac
	mkdir -p "$T/d i r"; cd "$T/d i r" || fail "no dir"
	ghostty
	logged "^open\\|-na\\|Ghostty.app\\|--args\\|--working-directory=$T/d i r\\|\$"
	ghostty -e grep -e x file
	logged "^open\\|-na\\|Ghostty.app\\|--args\\|--working-directory=$T/d i r\\|-e\\|/bin/sh\\|-lc\\|exec \"\\\$@\"\\|sh\\|grep\\|-e\\|x\\|file\\|\$"
}

t_darwin_floatterm() {
	mac
	TERMINAL=ghostty floatterm spcalc 50x20 bc -l
	logged "\\|--working-directory=$T\\|--title=spcalc\\|--window-width=50\\|--window-height=20\\|-e\\|/bin/sh\\|-lc\\|exec \"\\\$@\"\\|sh\\|bc\\|-l\\|\$"
}

t_darwin_writemode() {
	mac
	mkdir -p "$HOME/writing"
	TERMINAL=ghostty writemode "$HOME/writing/a.md"
	logged "\\|--title=write\\|--fullscreen=non-native\\|-e\\|/bin/sh\\|-lc\\|exec \"\\\$@\"\\|sh\\|nvim\\|-c\\|silent! Goyo\\|$HOME/writing/a.md\\|\$"
}

# scratch: AeroSpace's windows are "ID<tab>TITLE" lines, all of them in
# $VT_STATE/out.aerospace-all, those in view in out.aerospace-here.
t_darwin_scratch() {
	mac
	cat >"$T/bin/aerospace" <<'EOF'
#!/bin/sh
printf 'aerospace|' >>"$VT_STATE/log"; printf '%s|' "$@" >>"$VT_STATE/log"; echo >>"$VT_STATE/log"
case $1.$2 in
list-windows.--all) cat "$VT_STATE/out.aerospace-all" 2>/dev/null ;;
list-windows.--workspace) cat "$VT_STATE/out.aerospace-here" 2>/dev/null ;;
list-workspaces.*) echo 3 ;;
esac
exit 0
EOF
	TERMINAL=ghostty scratch term
	logged '\|--title=spterm\|--window-width=120\|--window-height=34\|$'
	printf '7\tspterm\n9\tspterm2\n' | fx out.aerospace-all
	printf '7\tspterm\n' | fx out.aerospace-here
	: >"$VT_STATE/log"; scratch term
	logged '^aerospace\|move-node-to-workspace\|--window-id\|7\|scratch\|$'
	notlogged '^open'
	: | fx out.aerospace-here
	scratch term
	logged '^aerospace\|move-node-to-workspace\|--focus-follows-window\|--window-id\|7\|3\|$'
	# The title is matched whole: spterm2 is not the scratchpad.
	printf '9\tspterm2\n' | fx out.aerospace-all
	: >"$VT_STATE/log"; TERMINAL=ghostty scratch term
	logged '\|--title=spterm\|'
	notlogged 'move-node'
}

# sd: the processes are sd_setup's (sd.sh); AeroSpace gives the window's
# pid, lsof its directory. Ghostty's shell is a login shell ("-ksh").
t_darwin_sd() {
	sd_setup
	mac
	echo 100 | fx out.aerospace
	cat >"$T/bin/lsof" <<'EOF'
#!/bin/sh
echo "lsof $*" >>"$VT_STATE/log"
awk -v p="$3" '$1 == p && $4 != "-" { print "p" p; print "fcwd"; print "n" $4 }' "$VT_STATE/procs"
EOF
	fx procs <<EOF
100 1 100 / ghostty /Applications/Ghostty.app/Contents/MacOS/ghostty
101 100 101 $HOME /usr/bin/login login -flp you
102 101 102 $HOME /bin/ksh -ksh
EOF
	sd || fail "sd failed"
	opened "the login shell at home" "$HOME"
	logged '^aerospace\|list-windows\|--focused\|--format\|%\{app-pid\}\|$'
	logged '^lsof -a -p 102 -d cwd -Fn$'
	notlogged '^proc-cwd|^xprop'
	# The Mac's ps gives comm as a path: git is still known.
	: >"$VT_STATE/log"
	fx procs <<EOF
100 1 100 / ghostty ghostty
101 100 101 $T/repo/sub /bin/ksh -ksh
102 101 102 $T/repo /usr/bin/git git log
103 102 102 $T/repo /usr/bin/less less
EOF
	sd || fail "sd failed"
	opened "git skipped" "$T/repo/sub"
}

# Apple's shortcuts(1) is in /usr/bin, before ~/.local/bin: the profile,
# ref and nvim must still reach vertrice's.
t_darwin_shortcuts() {
	mac
	argmock shortcuts
	printf '#!/bin/sh\nexec %s "%s" "$@"\n' "$VT_SH" "$REPO/.local/bin/shortcuts" >"$T/vshortcuts"
	chmod +x "$T/vshortcuts"
	mkdir -p "$HOME/.local/bin" "$XDG_CONFIG_HOME/shell" "$XDG_CONFIG_HOME/lf" "$XDG_CONFIG_HOME/nvim"
	ln -s "$T/vshortcuts" "$HOME/.local/bin/shortcuts"
	ln -s "$REPO/.config/shell/bm-dirs" "$XDG_CONFIG_HOME/shell/bm-dirs"
	ln -s "$REPO/.config/shell/bm-files" "$XDG_CONFIG_HOME/shell/bm-files"
	shortcuts
	notlogged '^shortcuts\|'
	[ -s "$XDG_CONFIG_HOME/shell/shortcutrc" ] || fail "no shortcutrc"
}

t_darwin_profile() {
	home_setup
	mkdir -p "$HOME/.local/bin/darwin"
	mac
	out=$("$VT_SH" -c '. "$HOME/.profile"; printf "%s\n" "$PATH" "$TERMINAL"' 2>&1) ||
		fail "profile failed: $out"
	path=$(printf '%s\n' "$out" | sed -n 1p)
	case $path in "$HOME/.local/bin/darwin:/opt/homebrew/bin:/opt/homebrew/sbin:"*) ;;
	*) fail "darwin, then Homebrew, must come first: $path" ;; esac
	hasnt "no wrap on the Mac" "/.local/bin/wrap" "$path"
	has "libarchive's bsdcat, for ext" ":/opt/homebrew/opt/libarchive/bin:" "$path"
	eq "darwin once" 1 "$(printf '%s\n' "$path" | tr ':' '\n' | grep -c '/\.local/bin/darwin$')"
	has "statusbar on PATH" ":$HOME/.local/bin/statusbar" "$path"
	eq "the terminal" ghostty "$(printf '%s\n' "$out" | sed -n 2p)"
}

t_darwin_profile_off_mac() {
	home_setup
	mkdir -p "$HOME/.local/bin/darwin"
	out=$("$VT_SH" -c '. "$HOME/.profile"; printf "%s\n" "$PATH" "$TERMINAL"' 2>&1) ||
		fail "profile failed: $out"
	hasnt "no darwin off the Mac" "/.local/bin/darwin" "$(printf '%s\n' "$out" | sed -n 1p)"
	hasnt "no Homebrew off the Mac" "/opt/homebrew" "$(printf '%s\n' "$out" | sed -n 1p)"
	eq "the terminal" xterm "$(printf '%s\n' "$out" | sed -n 2p)"
}

t_darwin_sb_battery() {
	mac
	printf "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t87%%; discharging; 5:12 remaining present: true\n" | fx out.pmset
	eq "discharging" "🔋87%" "$(sb-battery)"
	printf "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t9%%; discharging; 0:20 remaining present: true\n" | fx out.pmset
	eq "discharging and low" "🔋❗9%" "$(sb-battery)"
	printf "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t55%%; charging; 1:02 remaining present: true\n" | fx out.pmset
	eq "charging" "🔌55%" "$(sb-battery)"
	printf "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t100%%; charged; 0:00 remaining present: true\n" | fx out.pmset
	eq "on AC, full" "⚡100%" "$(sb-battery)"
	printf "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t80%%; AC attached; not charging present: true\n" | fx out.pmset
	eq "on AC, not charging" "🛑80%" "$(sb-battery)"
	printf "Now drawing from 'AC Power'\n" | fx out.pmset
	out=$(sb-battery); rc=$?
	eq "no battery (a Mac mini): exit 1" 1 "$rc"
	eq "no battery: no output" "" "$out"
	logged '^pmset\|-g\|batt\|$'
	notlogged '^apm'
}

t_darwin_setbg() {
	mac
	# A PNG's signature and header are all file(1) needs.
	printf '\211PNG\r\n\032\n\000\000\000\rIHDR\000\000\000\001\000\000\000\001\010\006\000\000\000' >"$T/pic.png"
	mkdir -p "$HOME/.local/share"
	setbg -s "$T/pic.png"
	eq "the link" "$T/pic.png" "$(readlink "$HOME/.local/share/bg")"
	logged "^osascript\\|-e\\|on run a\\|-e\\|tell application \"System Events\" to tell every desktop to set picture to \\(item 1 of a\\)\\|-e\\|end run\\|$T/pic.png\\|\$"
}

t_darwin_sysact() {
	mac
	answers '💤 sleep'
	sysact
	logged '^pmset\|sleepnow\|$'
	eq "the Mac's menu" "🔒 lock
🚪 log out
🔃 reboot
🖥️shutdown
💤 sleep" "$(cat "$VT_STATE/menu.1")"
	rm -f "$VT_STATE/choose.n"; answers '🔃 reboot'
	sysact
	logged '^osascript\|-e\|tell application "System Events" to restart\|$'
	# Lock: the display sleeps; the install makes waking it ask.
	rm -f "$VT_STATE/choose.n"; answers '🔒 lock'; : >"$VT_STATE/log"
	sysact
	logged '^pmset\|displaysleepnow\|$'
	notlogged 'keystroke|doas|xlock|sndioctl'
}

# remind: Reminders, due at 09:00 on the day; the text as an argument.
t_darwin_remind() {
	mac
	remind 2026-10-03 Return the '"library"' books || fail "remind failed"
	logged '^osascript\|-e\|on run a\|'
	logged '\|-e\|tell application "Reminders" to make new reminder with properties \{name:item 4 of a, remind me date:d\}\|-e\|end run\|2026\|10\|03\|Return the "library" books\|$'
	logged '\|set time of d to 9 \* hours\|'
	: >"$VT_STATE/log"
	remind 'Oct 3' books 2>/dev/null; eq "not a date: exit 1" 1 "$?"
	remind 2026-10-03 2>/dev/null; eq "no text: exit 1" 1 "$?"
	notlogged osascript
}

# $BROWSER on the Mac is Safari, through open.
t_darwin_browser() {
	home_setup
	mkdir -p "$HOME/.local/bin/darwin"
	mac
	eq "the browser" safari "$("$VT_SH" -c '. "$HOME/.profile"; echo "$BROWSER"')"
	safari https://example.org/
	logged '^open\|-a\|Safari\|https://example.org/\|$'
}

t_darwin_dict() {
	mac
	dict -d roget pity
	logged '^open\|dict://pity\|$'
}

# The bar on the Mac is SketchyBar: sb-refresh asks it, and signals no sbar.
t_darwin_sb_refresh() {
	mac
	argmock sketchybar
	sb-refresh
	logged '^sketchybar\|--update\|$'
	notlogged '^pkill'
}

t_darwin_sb_memory() {
	mac
	setsysctl hw.memsize=17179869184
	cat >"$T/bin/vm_stat" <<'EOF'
#!/bin/sh
cat <<'E'
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                5000.
Pages active:                            262144.
Pages inactive:                          100000.
Pages speculative:                         3000.
Pages throttled:                              0.
Pages wired down:                        131072.
Pages purgeable:                           2000.
Pages occupied by compressor:             65536.
E
EOF
	chmod +x "$T/bin/vm_stat"
	eq "active, wired and compressed of 16GiB" "🧠7.00GiB/16.00GiB" "$(sb-memory)"
	notlogged '^top'
}

# ps on the Mac gives comm as the program's path, spaces and all
# (hogs_ps, blocks.sh).
t_darwin_sb_memory_hogs() {
	mac
	hogs_ps
	c='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
	printf '3\t%s\n2\t%s\n1.5\t/usr/sbin/mDNSResponder\n' "$c" "$c" | fx procs.mem
	BLOCK_BUTTON=1 sb-memory >/dev/null
	logged '\|🧠 Memory hogs\|5 Google Chrome$'
	logged '^1.5 mDNSResponder\|$'
}

# osascript answers "VOLUME, MUTED" for the volume settings.
t_darwin_sb_volume() {
	mac
	echo '55, false' | fx out.osascript
	eq "volume" "🔉55%" "$(sb-volume)"
	logged '^osascript\|-e\|set s to get volume settings\|-e\|\{output volume of s, output muted of s\}\|$'
	echo '55, true' | fx out.osascript
	eq "muted" "🔇" "$(sb-volume)"
	: | fx out.osascript; : >"$VT_STATE/log"
	BLOCK_BUTTON=4 sb-volume >/dev/null
	logged '^osascript\|-e\|set s to get volume settings\|-e\|set volume output volume \(output volume of s\) \+ 1\|$'
	BLOCK_BUTTON=2 sb-volume >/dev/null
	logged '\|set volume output muted not output muted of s\|$'
	notlogged sndioctl
}

# The default route's interface, and whether networksetup calls it Wi-Fi.
t_darwin_sb_internet() {
	mac
	argmock route; argmock networksetup
	printf 'Hardware Port: Ethernet\nDevice: en1\n\nHardware Port: Wi-Fi\nDevice: en0\n' | fx out.networksetup
	eq "no route" "📡" "$(sb-internet)"
	printf '   route to: default\ndestination: default\n  interface: en0\n' | fx out.route
	eq "Wi-Fi" "📶" "$(sb-internet)"
	logged '^route\|-n\|get\|default\|$'
	printf '  interface: en1\n' | fx out.route
	eq "wired" "🌐" "$(sb-internet)"
	printf '  interface: utun4\n' | fx out.route
	eq "a VPN takes all" "🔒" "$(sb-internet)"
	notlogged '^ifconfig'
}

t_darwin_maimpick() {
	mac
	answers 'a selected area (copy)'
	maimpick
	logged '^screencapture\|-ic\|$'
	eq "no text entry" 6 "$(grep -c '' "$VT_STATE/menu.1")"
	rm -f "$VT_STATE/choose.n"; answers 'current window'
	maimpick
	logged '^screencapture\|-iW\|pic-window-[0-9-]*\.png\|$'
	notlogged 'maim |xdotool|xclip'
}

t_darwin_dmenuunicode() {
	mac
	mkdir -p "$HOME/.local/share/larbs/chars"
	echo '😀 grinning face; smile' >"$HOME/.local/share/larbs/chars/emoji"
	answers '😀 grinning face'
	dmenuunicode insert
	eq "copied" 😀 "$(cat "$VT_STATE/in.pbcopy")"
	logged '^osascript\|-e\|tell application "System Events" to keystroke "v" using command down\|$'
	notlogged '^xdotool'
}

t_darwin_ifinstalled() {
	mac
	ifinstalled sh pass-otp || fail "brew has pass-otp, yet refused"
	logged '^brew\|list\|pass-otp\|$'
	echo 1 >"$VT_STATE/rc.brew"
	ifinstalled nosuchthing; eq "missing: exit 1" 1 "$?"
	logged '^osascript\|.*\|📦 nosuchthing\|must be installed for this function\.\|$'
	notlogged pkg_info
}

t_darwin_otp_add() {
	otp_setup
	mac
	echo 1 >"$VT_STATE/rc.brew"	# pass-otp and zbar are commands here
	answers 🆕add github
	otp >/dev/null 2>&1
	logged '^screencapture\|-i\|.*/qr\.png\|$'
	notlogged '^maim'
	eq "stored under its name" "otpauth://totp/x?secret=ABC" "$(cat "$T/store/github-otp" 2>/dev/null)"
}

# The Mac has no ntpctl: sync-time shows sntp's offset.
t_darwin_otp_sync_time() {
	otp_setup
	mac
	argmock sntp
	echo '+0.012 +/- 0.004 time.apple.com 17.253.4.125' | fx out.sntp
	answers 🕙sync-time
	otp >/dev/null 2>&1
	logged '^sntp\|'
	logged '\|🕙 Time sync\|\+0.012 \+/- 0.004 time.apple.com 17.253.4.125\|$'
}

# /var/db/updates is $T/updates (derived, lib.sh); a terminal from with_tty.
t_darwin_popupgrade() {
	mac
	echo 'git' >"$T/updates"
	up=$(derived .local/bin/statusbar/sb-popupgrade sb-popupgrade "s|/var/db/updates|$T/updates|g")
	printf '\n' | with_tty "$up"
	logged '^brew\|update\|$'
	logged '^brew\|upgrade\|$'
	notlogged '^doas'
	eq "the count cleared" "" "$(cat "$T/updates")"
}

# pass's passmenu exits unless DISPLAY is set, and needs bash 4 (globstar):
# Homebrew's, first in the profile's PATH, installed beside pass.
t_darwin_passmenu() {
	mac
	printf '#!/bin/sh\necho "bash $DISPLAY $*" >>"$VT_STATE/log"\n' >"$T/bin/bash"
	chmod +x "$T/bin/bash"
	passmenu
	logged '^bash [^ ]+ /opt/homebrew/share/pass/contrib/dmenu/passmenu$'
	grep -qx 'brew "pass"' "$REPO/.local/share/darwin/Brewfile.extra" &&
	grep -qx 'brew "bash"' "$REPO/.local/share/darwin/Brewfile.extra" ||
		fail "Brewfile.extra must install bash with pass"
}

# Every stand-in can run, and none reaches for X.
t_darwin_shims_plain() {
	for f in "$REPO"/.local/bin/darwin/*; do
		[ -x "$f" ] || fail "${f##*/} is not executable"
		grep -Eq 'xdotool|xprop|/usr/X11R6' "$f" && fail "${f##*/} calls X"
	done
	return 0
}
