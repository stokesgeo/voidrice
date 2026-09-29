# hotplug-attach and hotplug-watch, theme, nightlight, scratch.

# The hotplug pair shares /var/run/hotplug-disk, which only root may write;
# here it is $T/hotplug-disk (see derived in lib.sh). Real entr watches it.
hp_setup() {
	command -v entr >/dev/null 2>&1 || skip "no entr on this host"
	sub="s|/var/run/hotplug-disk|$T/hotplug-disk|g"
	watch=$(derived .local/bin/hotplug-watch hotplug-watch "$sub")
	attach=$(derived .local/share/openbsd/hotplug-attach hotplug-attach "$sub")
}
attached() { grep -c "^notify-send 💾 $1 attached Super+F9 to mount it\.\$" "$VT_STATE/log"; }
seen() { [ "$(attached "$1")" -ge 1 ]; }
entrs() { "$VT_REAL_PGREP" -f "entr .*$T/hotplug-disk" | wc -l | tr -d ' '; }
watching() { [ "$(entrs)" -ge 1 ]; }

t_hotplug_first_attach_after_boot() {
	hp_setup
	# /var/run is empty after boot: the watcher waits for the file.
	VT_SLEEP=0.2 "$VT_SH" "$watch" >/dev/null 2>&1 &
	"$VT_REAL_SLEEP" 0.3
	"$VT_SH" "$attach" 2 sd1
	eq "file written" sd1 "$(cat "$T/hotplug-disk")"
	waitfor 5 seen sd1 || fail "no notice for the first attach"
	"$VT_REAL_SLEEP" 0.3
	"$VT_SH" "$attach" 2 sd2
	waitfor 5 seen sd2 || fail "no notice for the second attach"
	"$VT_SH" "$attach" 3 iwn0
	"$VT_REAL_SLEEP" 1
	eq "non-disk device leaves the file" sd2 "$(cat "$T/hotplug-disk")"
	eq "one notice for sd1" 1 "$(attached sd1)"
	eq "one notice for sd2" 1 "$(attached sd2)"
	eq "notices in all" 2 "$(grep -c '^notify-send' "$VT_STATE/log")"
}

t_hotplug_login_after_attach() {
	hp_setup
	# A disk was attached before this login: no stale notice for it.
	"$VT_SH" "$attach" 2 sd9
	"$VT_SH" "$watch" >/dev/null 2>&1 &
	waitfor 5 watching || fail "entr never started"
	"$VT_REAL_SLEEP" 0.5
	eq "no notice for the old disk" 0 "$(attached sd9)"
	"$VT_SH" "$attach" 2 sd3
	waitfor 5 seen sd3 || fail "no notice for a later attach"
	eq "one notice" 1 "$(attached sd3)"
}

t_hotplug_replaces_old_watcher() {
	hp_setup
	"$VT_SH" "$attach" 2 sd1
	"$VT_SH" "$watch" >/dev/null 2>&1 &
	waitfor 5 watching || fail "first watcher never started"
	"$VT_SH" "$watch" >/dev/null 2>&1 &
	"$VT_REAL_SLEEP" 0.5
	logged "^pkill -U $(id -u) -f entr -n\.\*hotplug-disk\$"
	waitfor 3 eval '[ "$(entrs)" -eq 1 ]' || fail "$(entrs) watchers running, want 1"
}

t_hotplug_attach_non_disk() {
	hp_setup
	"$VT_SH" "$attach" 3 iwn0
	"$VT_SH" "$attach" 5 uhidev0
	[ -e "$T/hotplug-disk" ] && fail "non-disk device wrote the file"
	return 0
}

# theme writes escape sequences to /dev/tty*; here those are files under
# $T/dev, opened for append so a second write to one terminal shows.
th_setup() {
	mkdir -p "$XDG_CONFIG_HOME/x11" "$T/dev"
	ln -s "$REPO/.config/x11/themes" "$XDG_CONFIG_HOME/x11/themes"
	theme=$(derived .local/bin/theme theme \
		"s|> \"/dev/tty|>> \"$T/dev/tty|; s|\"/dev/tty|\"$T/dev/tty|g")
	: >"$T/dev/ttyp3"; : >"$T/dev/ttyq1"; : >"$T/dev/ttyC0"
	printf 'p3\nC0\n??\np3\nq1\n' >"$VT_STATE/ttys"
}
# count TEXT FILE: how often TEXT occurs in FILE.
count() { awk -v s="$1" '{ n += gsub(s, "") } END { print n + 0 }' "$2"; }
esc=$(printf '\033')

t_theme_day() {
	th_setup
	DISPLAY=:0 "$VT_KSH" "$theme" day || fail "theme day failed"
	logged "^xrdb -merge $XDG_CONFIG_HOME/x11/themes/day\$"
	for t in p3 q1; do
		eq "tty$t: background once" 1 "$(count "]11;#f5f1e8" "$T/dev/tty$t")"
		eq "tty$t: foreground once" 1 "$(count "]10;#383642" "$T/dev/tty$t")"
		eq "tty$t: cursor once" 1 "$(count "]12;#a8474a" "$T/dev/tty$t")"
		eq "tty$t: 16 palette entries" 16 "$(count "]4;" "$T/dev/tty$t")"
		eq "tty$t: sequences start with ESC" 19 "$(count "$esc]" "$T/dev/tty$t")"
	done
	eq "console untouched" 0 "$(wc -c <"$T/dev/ttyC0" | tr -d ' ')"
	eq "state" day "$(cat "$XDG_CACHE_HOME/theme")"
}

t_theme_no_display() {
	th_setup
	"$VT_KSH" "$theme" night || fail "theme night failed"
	notlogged '^xrdb'
	eq "terminals still recoloured" 1 "$(count "]11;#24232e" "$T/dev/ttyp3")"
}

t_theme_toggle() {
	th_setup
	"$VT_KSH" "$theme" toggle
	eq "no state: day" day "$(cat "$XDG_CACHE_HOME/theme")"
	"$VT_KSH" "$theme" toggle
	eq "day: night" night "$(cat "$XDG_CACHE_HOME/theme")"
	eq "night sent" 1 "$(count "]11;#24232e" "$T/dev/ttyp3")"
	"$VT_KSH" "$theme" toggle
	eq "night: day" day "$(cat "$XDG_CACHE_HOME/theme")"
}

t_theme_auto() {
	th_setup
	# 2026-09-29 at 06:59, 07:00, 18:59 and 19:00 UTC.
	for c in 1790665140:night 1790665200:day 1790708340:day 1790708400:night; do
		VT_EPOCH=${c%:*} "$VT_KSH" "$theme" auto
		eq "auto at ${c%:*}" "${c#*:}" "$(cat "$XDG_CACHE_HOME/theme")"
	done
	"$VT_KSH" "$theme" dusk 2>/dev/null; eq "unknown word: exit 1" 1 "$?"
}

t_nightlight() {
	state=$XDG_CACHE_HOME/nightlight
	nightlight
	logged '^sct 4000$'
	logged '^notify-send 🌙 Night light 4000 K$'
	[ -f "$state" ] || fail "on: no state file"
	: >"$VT_STATE/log"
	nightlight
	logged '^sct $'
	logged '^notify-send 🌞 Night light off$'
	[ -f "$state" ] && fail "off: state file left"
	nightlight 3200
	logged '^sct 3200$'
	: >"$VT_STATE/log"
	nightlight 2700
	logged '^sct 2700$'
	[ -f "$state" ] || fail "a new temperature while on keeps it on"
	rm -f "$state"; echo 1 >"$VT_STATE/rc.sct"; : >"$VT_STATE/log"
	nightlight
	[ -f "$state" ] && fail "sct failed but state says on"
	notlogged '^notify-send'
}

t_scratch() {
	scratch term
	logged '^xterm -name spterm -geometry 120x34$'
	scratch calc
	logged '^xterm -name spcalc -geometry 50x20 -e bc -lq$'
	echo "0x1 spterm 1" >"$VT_STATE/windows"
	scratch term
	logged '^xdotool windowunmap 0x1$'
	echo "0x2 spcalc 0" >"$VT_STATE/windows"
	scratch calc
	logged '^xdotool windowmap 0x2 windowactivate 0x2$'
	# The name is matched whole: spterm2 is not the scratchpad.
	echo "0x3 spterm2 1" >"$VT_STATE/windows"; : >"$VT_STATE/log"
	scratch term
	logged '^xterm -name spterm'
	scratch 2>/dev/null; eq "no argument: exit 1" 1 "$?"
}

# linkhandler and dmenuhandler download into a new private directory, never
# to a name in /tmp that the URL chose (a planted symlink would be followed).
lh_setup() {
	echo data | fx out.ftp	# what the ftp mock writes to its -o file
	for v in nsxiv zathura; do ln -s "$VT_MOCKS/_log" "$T/bin/$v"; done
}
# private DIR: DIR is not /tmp itself, and is a directory only its owner may enter.
private() {
	[ "$1" != /tmp ] && [ -d "$1" ] &&
		[ "$(ls -ld "$1" | cut -c1-10)" = drwx------ ] || fail "not a private directory: $1"
}

t_linkhandler_private_tmp() {
	lh_setup
	linkhandler "https://example.org/a/b/pic.png"
	waitfor 5 grep -q '^nsxiv' "$VT_STATE/log" || fail "nsxiv never ran"
	f=$(sed -n 's/^nsxiv -a //p' "$VT_STATE/log")
	eq "file keeps its name" pic.png "${f##*/}"
	private "${f%/*}"
	[ -s "$f" ] || fail "downloaded file missing"
	rm -rf "${f%/*}"
}

t_dmenuhandler_private_tmp() {
	lh_setup
	answers PDF
	dmenuhandler "https://example.org/doc.pdf"
	f=$(sed -n 's/^zathura //p' "$VT_STATE/log")
	eq "file keeps its name" doc.pdf "${f##*/}"
	private "${f%/*}"
	rm -rf "${f%/*}"
}

# xdg-open defaults: the repository's mimeapps.list and .desktop files,
# through mock/xdg-open (xdg-utils 1.2.1's generic lookup). Every Exec
# program must be found on PATH; terminal programs open in $TERMINAL.
xo_setup() {
	command -v file >/dev/null 2>&1 || skip "no file(1) on this host"
	mkdir -p "$XDG_CONFIG_HOME" "$HOME/.local/share"
	ln -s "$REPO/.config/mimeapps.list" "$XDG_CONFIG_HOME/mimeapps.list"
	ln -s "$REPO/.local/share/applications" "$HOME/.local/share/applications"
	for v in nsxiv zathura mpv transadd rssadd; do
		ln -s "$VT_MOCKS/_log" "$T/bin/$v"
	done
}

t_xdgopen_defaults() {
	xo_setup
	printf '%%PDF-1.4\n' >"$T/doc.pdf"
	printf '\211PNG\r\n\032\n\0\0\0\rIHDR\0\0\0\1\0\0\0\1\10\2\0\0\0' >"$T/pic.png"
	printf 'hello\n' >"$T/notes.txt"
	xdg-open "$T/doc.pdf" || fail "pdf did not open"
	logged "^zathura $T/doc\.pdf$"
	xdg-open "$T/pic.png" || fail "png did not open"
	logged "^nsxiv -a $T/pic\.png$"
	xdg-open "$T/notes.txt" || fail "text did not open"
	logged "^xterm -e nvim $T/notes\.txt$"
	xdg-open "$T" || fail "directory did not open"
	logged "^xterm -e lfub $T$"
	xdg-open "magnet:?xt=urn:btih:abc" || fail "magnet did not open"
	logged '^transadd magnet:\?xt=urn:btih:abc$'
	xdg-open "mailto:a@example.org" || fail "mailto did not open"
	logged '^xterm -e neomutt mailto:a@example\.org$'
}

t_xdgopen_every_entry_resolves() {
	xo_setup
	for v in nvim lfub neomutt; do ln -s "$VT_MOCKS/_log" "$T/bin/$v"; done
	for f in "$REPO"/.local/share/applications/*.desktop; do
		e=$(sed -n 's/^Exec=//p' "$f")
		case ${e%% *} in */*) fail "${f##*/}: Exec names a path: $e" ;; esac
		command -v "${e%% *}" >/dev/null || fail "${f##*/}: ${e%% *} not found"
	done
	for d in $(sed -n 's/^[a-z-]*\/[^=]*=\([^;]*\).*/\1/p' "$REPO/.config/mimeapps.list"); do
		[ -f "$REPO/.local/share/applications/$d" ] || fail "mimeapps.list names a missing $d"
	done
}

# opout: a compiled document's PDF opens through xdg-open.
t_opout_pdf() {
	xo_setup
	mkdir -p "$T/w"; cd "$T/w" || fail "no dir"
	: >doc.md; printf '%%PDF-1.4\n' >doc.pdf
	opout doc.md
	logged '^detach xdg-open \./doc\.pdf$'
	xdg-open ./doc.pdf
	logged '^zathura \./doc\.pdf$'
}

# otp's add path: scan, insert under a temporary name, ask for the real
# name, rename to NAME-otp. Upstream's "prinf" typo fed the name prompt
# from a command that does not exist.
t_otp_add() {
	export PASSWORD_STORE_DIR="$T/store"; mkdir -p "$PASSWORD_STORE_DIR"
	for v in pass maim xclip; do ln -s "$VT_MOCKS/_log" "$T/bin/$v"; done
	printf '#!/bin/sh\necho "QR-Code:otpauth://totp/x?secret=ABC"\n' >"$T/bin/zbarimg"
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/pkg_info"	# ifinstalled: pass-otp, zbar
	chmod +x "$T/bin/zbarimg" "$T/bin/pkg_info"
	answers "🆕add" github
	otp 2>"$T/err"
	logged '^pass otp insert otp-test-script$'
	logged '^pass mv otp-test-script github-otp$'
	hasnt "no missing command" "not found" "$(cat "$T/err")"
}

# passmenu runs the package's example script, which is installed mode 444
# (INSTALL_DATA), through bash; without the package, a notice.
t_passmenu_wrapper() {
	ex=$T/examples/passmenu
	p=$(derived .local/bin/passmenu passmenu "s|/usr/local/share/examples/password-store/dmenu/passmenu|$ex|")
	printf '#!/bin/sh\necho "bash $*" >>"$VT_STATE/log"\n' >"$T/bin/bash"
	chmod +x "$T/bin/bash"
	"$VT_SH" "$p" --type
	logged '^notify-send 📦 password-store must be installed'
	notlogged '^bash'
	mkdir -p "$T/examples"; echo 'echo passmenu' >"$ex"; chmod 444 "$ex"
	"$VT_SH" "$p" --type
	logged "^bash $ex --type\$"
}

# ImageMagick 6 (the package) has convert and mogrify, no magick. The
# host may have ImageMagick 7: mocks stand in either way.
im_setup() {
	for v in convert mogrify ffmpeg; do ln -s "$VT_MOCKS/_log" "$T/bin/$v"; done
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/pkg_info"
	printf '#!/bin/sh\necho "magick $*" >>"$VT_STATE/log"; exit 127\n' >"$T/bin/magick"
	chmod +x "$T/bin/pkg_info" "$T/bin/magick"
}

t_nsxiv_rotate_flip() {
	im_setup
	for k in r R f; do
		echo "$T/pic.jpg" | "$VT_SH" "$REPO/.config/nsxiv/exec/key-handler" "$k"
	done
	logged "^mogrify -rotate 90 $T/pic\.jpg\$"
	logged "^mogrify -rotate -90 $T/pic\.jpg\$"
	logged "^mogrify -flop $T/pic\.jpg\$"
	notlogged '^magick'
}

t_slider_convert() {
	im_setup
	cd "$T" || fail "no dir"
	: >img.png
	printf '00:00:00\timg.png\n00:00:03\tHello\n' >list
	slider -i list >/dev/null 2>&1
	logged '^convert -size 1920x1080 canvas:black -gravity center img\.png -resize 1920x1080 -composite '
	logged '^convert -size 1920x1080 -background black -fill white -font Sans -pointsize 150 -gravity center label:Hello '
	logged '^ffmpeg -hide_banner -y -f concat -safe 0 -i '
	notlogged '^magick'
}
