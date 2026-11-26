# Focused routing tests. All command replacements are private to each case;
# argument-per-line receipts preserve spaces, quotes and glob characters.
dr_setup() {
	export DR_LOG="$T/routes" DR_FTP_RC=0 DR_NOTIFY_RC=0
	DR_HANDLER_DIR=${DR_HANDLER_DIR:-$REPO/.local/bin}
	dmenuhandler() { "$VT_SH" "$DR_HANDLER_DIR/dmenuhandler" "$@"; }
	linkhandler() { "$VT_SH" "$DR_HANDLER_DIR/linkhandler" "$@"; }
	ifinstalled() { "$VT_SH" "$DR_HANDLER_DIR/ifinstalled" "$@"; }
	mkdir -p "$T/tmp"
	export TMPDIR="$T/tmp"
	cat >"$T/bin/dr-command" <<'EOF'
#!/bin/sh
name=${0##*/}
printf '%s\n' "$name" "$@" >"$DR_LOG.$name"
case $name in
ftp) printf 'download\n' >"$3"; exit "$DR_FTP_RC" ;;
pkg_info) [ "$2" = 'dr-package-*' ] ;;
brew) [ "$1" = list ] && [ "$2" = dr-package ] ;;
notify-send) exit "$DR_NOTIFY_RC" ;;
esac
EOF
	chmod +x "$T/bin/dr-command"
	for c in ftp nsxiv zathura detach setbg qndl pkg_info notify-send dr-present; do
		ln -s dr-command "$T/bin/$c"
	done
}
dr_receipt() {
	c=$1; shift
	printf '%s\n' "$c" "$@" >"$T/want"
	cmp -s "$T/want" "$DR_LOG.$c" || fail "$c argument receipt differs"
}
dr_clear() { rm -f "$DR_LOG".* "$VT_STATE/dmenu.n"; }
dr_noftp() { [ ! -f "$DR_LOG.ftp" ] || fail "local path sent to ftp"; }
dr_no_temp() {
	[ -z "$(find "$TMPDIR" -mindepth 1 -print)" ] || fail 'local route allocated a temporary file'
}
dr_link_wait() {
	waitfor 5 test -f "$DR_LOG.$1" || fail "$1 never ran"
}

t_desktop_routing_dmenu_local() {
	dr_setup
	for path in "$T/a space [*] 'quote.pdf" '-dash.pdf'; do
		printf 'original\n' >"$path"
		case $path in -*) expected=./$path ;; *) expected=$path ;; esac
		for action in PDF nsxiv vim setbg; do
			dr_clear; answers "$action"
			dmenuhandler "$path"
			dr_noftp; dr_no_temp
			eq 'local file unchanged' original "$(cat <"$path")"
			case $action in
			PDF) dr_receipt zathura "$expected" ;;
			nsxiv) dr_receipt nsxiv -a "$expected" ;;
			vim) dr_receipt detach "$TERMINAL" -e "$EDITOR" "$expected" ;;
			setbg) dr_receipt setbg "$expected" ;;
			esac
		done
	done
}

t_desktop_routing_setbg_local() {
	dr_setup
	path="$T/local [*] 'image.png"
	printf 'original\n' >"$path"
	answers setbg
	dmenuhandler "$path"
	dr_noftp
	dr_receipt setbg "$path"
}

t_desktop_routing_link_local() {
	dr_setup
	for path in "$T/space [*] 'quote.png" '-dash.png' "$T/a b.pdf" '-dash.pdf' "$T/a [*] note.txt" '-dash.txt'; do
		printf 'original\n' >"$path"
		case $path in -*) expected=./$path ;; *) expected=$path ;; esac
		dr_clear
		linkhandler "$path"
		case $path in
		*png) dr_link_wait nsxiv; dr_receipt nsxiv -a "$expected" ;;
		*pdf) dr_link_wait zathura; dr_receipt zathura "$expected" ;;
		*) dr_link_wait detach; dr_receipt detach "$TERMINAL" -e "$EDITOR" "$expected" ;;
		esac
		dr_noftp; dr_no_temp
		eq 'local file unchanged' original "$(cat <"$path")"
	done
}

t_desktop_routing_link_video_operand() {
	dr_setup
	printf 'original\n' > ./-dash.mp4
	linkhandler '-dash.mp4'
	dr_link_wait detach
	dr_receipt detach mpv -quiet ./-dash.mp4
	dr_noftp; dr_no_temp
}

t_desktop_routing_link_service_local() {
	dr_setup
	mkdir -p youtube.com
	for path in youtube.com/watch-notes.txt youtube.com/watch-image.png youtube.com/watch-doc.pdf youtube.com/watch-video.mp4 youtube.com/watch-audio.mp3 'youtu.be.txt'; do
		printf 'original\n' >"$path"
		dr_clear
		linkhandler "$path"
		case $path in
		*png) dr_link_wait nsxiv; dr_receipt nsxiv -a "$path" ;;
		*pdf) dr_link_wait zathura; dr_receipt zathura "$path" ;;
		*mp4) dr_link_wait detach; dr_receipt detach mpv -quiet "$path" ;;
		*mp3) dr_link_wait qndl; dr_receipt qndl "$path" ftp ;;
		*) dr_link_wait detach; dr_receipt detach "$TERMINAL" -e "$EDITOR" "$path" ;;
		esac
		dr_noftp; dr_no_temp
	done
}

t_desktop_routing_link_services_remote() {
	dr_setup
	for hostpath in youtube.com/watch?v=123 youtube.com/playlist?list=123 youtube.com/shorts/123 youtu.be/123 hooktube.com/123 bitchute.com/123 videos.lukesmith.xyz/123 odysee.com/123; do
		dr_clear
		url=https://$hostpath
		linkhandler "$url"
		dr_receipt detach mpv -quiet "$url"
		dr_noftp; dr_no_temp
	done
}

t_desktop_routing_dmenu_video_operand() {
	dr_setup
	printf 'original\n' > ./-dash.mp4
	for path in '-dash.mp4' https://example.invalid/video.mp4; do
		case $path in -*) expected=./$path ;; *) expected=$path ;; esac
		for action in mpv 'mpv loop' 'mpv float'; do
			dr_clear; answers "$action"
			dmenuhandler "$path"
			case $action in
			mpv) dr_receipt detach mpv -quiet "$expected" ;;
			'mpv loop') dr_receipt detach mpv -quiet --loop "$expected" ;;
			'mpv float') dr_receipt detach "$TERMINAL" -e mpv --geometry=+0-0 --autofit=30% --title=mpvfloat "$expected" ;;
			esac
			dr_noftp; dr_no_temp
		done
	done
}

t_desktop_routing_remote() {
	dr_setup
	for scheme in https ftp; do
		for action in PDF nsxiv vim; do
			dr_clear; answers "$action"
			url=$scheme://example.invalid/a/file.pdf
			dmenuhandler "$url"
			file=$(awk 'NR == 4' "$DR_LOG.ftp")
			dr_receipt ftp -MV -o "$file" "$url"
			private "${file%/*}"
			eq 'download retained (also for detached editing)' download "$(cat "$file")"
			case $action in
			PDF) dr_receipt zathura "$file" ;;
			nsxiv) dr_receipt nsxiv -a "$file" ;;
			vim) dr_receipt detach "$TERMINAL" -e "$EDITOR" "$file" ;;
			esac
		done
	done
	for pair in png:nsxiv pdf:zathura; do
		dr_clear
		url=ftp://example.invalid/file.${pair%:*}
		linkhandler "$url"
		dr_link_wait "${pair#*:}"
		file=$(awk 'NR == 4' "$DR_LOG.ftp")
		dr_receipt ftp -MV -o "$file" "$url"
		private "${file%/*}"
		[ -f "$file" ] || fail 'viewer download removed prematurely'
	done
}

t_desktop_routing_failure() {
	dr_setup
	export DR_FTP_RC=1
	for action in PDF nsxiv vim setbg; do
		dr_clear; answers "$action"
		dmenuhandler https://example.invalid/fail.pdf
		for c in zathura nsxiv detach setbg; do
			[ ! -f "$DR_LOG.$c" ] || fail "ftp failure launched $c"
		done
		if [ "$action" != setbg ]; then
			file=$(awk 'NR == 4' "$DR_LOG.ftp")
			[ -f "$file" ] || fail 'existing partial-download retention changed'
		fi
	done
	for ext in png pdf; do
		dr_clear
		linkhandler ftp://example.invalid/fail.$ext
		# Reap the script's background route before inspecting negative receipts.
		waitfor 5 test -f "$DR_LOG.ftp" || fail 'ftp not invoked'
		"$VT_REAL_SLEEP" 0.2
		[ ! -f "$DR_LOG.nsxiv" ] && [ ! -f "$DR_LOG.zathura" ] || fail 'failed link opened'
	done
}

t_desktop_routing_cancel_queue_setbg() {
	dr_setup
	answers ''
	dmenuhandler
	dr_noftp
	dr_clear; answers ''
	dmenuhandler https://example.invalid/doc.pdf
	dr_noftp
	[ ! -f "$DR_LOG.detach" ] || fail 'cancelled action launched command'
	for action in 'queue download' 'queue yt-dlp' 'queue yt-dlp audio'; do
		dr_clear; answers "$action"
		dmenuhandler ftp://example.invalid/song.mp3
		dr_noftp
		case $action in
		'queue download') dr_receipt qndl ftp://example.invalid/song.mp3 ftp ;;
		'queue yt-dlp') dr_receipt qndl ftp://example.invalid/song.mp3 ;;
		*) dr_receipt qndl ftp://example.invalid/song.mp3 'yt-dlp -o %(title)s.%(ext)s -f bestaudio --embed-metadata --restrict-filenames' ;;
		esac
	done
	dr_clear; answers setbg
	dmenuhandler ftp://example.invalid/bg.png
	dr_receipt ftp -MV -o "$XDG_CACHE_HOME/pic" ftp://example.invalid/bg.png
	dr_receipt setbg "$XDG_CACHE_HOME/pic"
}

t_desktop_routing_ifinstalled_missing() {
	dr_setup
	for rc in 0 1 127; do
		export DR_NOTIFY_RC=$rc
		for deps in 'dr-absent' 'dr-absent dr-present' 'dr-present dr-absent' 'dr-absent dr-other-absent'; do
			# Intentional splitting: these are lists of dependency names.
			ifinstalled $deps >/dev/null 2>&1
			eq "missing ($deps), notification rc=$rc" 1 "$?"
		done
	done
	rm "$T/bin/notify-send"
	ifinstalled dr-absent dr-present >/dev/null 2>&1
	eq 'notification command absent' 1 "$?"
}

t_desktop_routing_ifinstalled_darwin() {
	dr_setup
	printf '#!/bin/sh\nprintf "Darwin\\n"\n' >"$T/bin/uname"
	chmod +x "$T/bin/uname"
	ln -s dr-command "$T/bin/brew"
	ifinstalled; eq 'Darwin no args' 0 "$?"
	ifinstalled dr-present; eq 'Darwin available command' 0 "$?"
	[ ! -f "$DR_LOG.brew" ] || fail 'available command consulted Brew'
	ifinstalled dr-package dr-present
	eq 'Darwin Brew package and command' 0 "$?"
	dr_receipt brew list dr-package
	[ ! -f "$DR_LOG.pkg_info" ] || fail 'Darwin used OpenBSD package checker'
	[ ! -f "$DR_LOG.notify-send" ] || fail 'Darwin present dependencies notified'
	for rc in 0 1 127; do
		export DR_NOTIFY_RC=$rc
		ifinstalled dr-absent dr-present >/dev/null 2>&1
		eq "Darwin missing package, notifier rc=$rc" 1 "$?"
		dr_receipt brew list dr-absent
	done
	# Isolate PATH so a host Brew or notifier cannot mask their absence.
	mkdir "$T/darwin-only"
	ln -s "$T/bin/uname" "$T/darwin-only/uname"
	ln -s "$T/bin/dr-command" "$T/darwin-only/dr-present"
	PATH="$T/darwin-only" ifinstalled dr-absent dr-present >/dev/null 2>&1
	eq 'Darwin missing Brew and notifier' 1 "$?"
	PATH="$T/darwin-only" ifinstalled dr-present
	eq 'Darwin command without Brew or notifier' 0 "$?"
}

t_desktop_routing_ifinstalled_present() {
	dr_setup
	export DR_NOTIFY_RC=1
	ifinstalled; eq 'no args' 0 "$?"
	ifinstalled dr-present dr-package dr-present
	eq 'commands and installed package' 0 "$?"
	[ ! -f "$DR_LOG.notify-send" ] || fail 'present dependencies notified'
	# Neither package checker nor notifier is available on this PATH.
	mkdir "$T/deps-only"
	ln -s /usr/bin/uname "$T/deps-only/uname"
	ln -s "$T/bin/dr-command" "$T/deps-only/dr-present"
	PATH="$T/deps-only" ifinstalled dr-absent dr-present >/dev/null 2>&1
	eq 'missing checker and notifier still fails before present command' 1 "$?"
	PATH="$T/deps-only" ifinstalled dr-present
	eq 'available command needs neither checker nor notifier' 0 "$?"
}
