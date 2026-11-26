# Desktop action-loop repairs. Launches use a closed PATH: only base text
# utilities and private recorders, never a real clipboard, app or network tool.
al_setup() {
	mkdir -p "$T/closed" "$T/receipts" "$T/tmp"
	AL_HANDLER_DIR=${AL_HANDLER_DIR:-$REPO/.local/bin}
	AL_RSS_DESKTOP=${AL_RSS_DESKTOP:-$REPO/.local/share/applications/rss.desktop}
	export TMPDIR="$T/tmp"
	export AL_BIN="$T/closed" AL_LOG="$T/receipts" AL_ACTION= AL_CLIP= AL_OS=OpenBSD AL_PACKAGE= AL_NOTIFY_RC=0 AL_EXEC_CHILD=0
	for c in cat chmod cmp cp cut dirname env grep head hostname id ln mkdir mktemp printf rm sed tr which; do
		p=$(PATH=/bin:/usr/bin command -v "$c") || fail "no base $c"
		ln -s "$p" "$AL_BIN/$c"
	done
	cat >"$AL_BIN/record" <<'EOF'
#!/bin/sh
name=${0##*/}
printf '%s\n' "$name" "$@" >"$AL_LOG/$name"
case $name in
xclip) printf '%s' "$AL_CLIP" ;;
dmenu) cat >/dev/null; printf '%s' "$AL_ACTION" ;;
uname) printf '%s\n' "$AL_OS" ;;
pkg_info) [ "$2" = "$AL_PACKAGE-*" ] ;;
brew) [ "$2" = "$AL_PACKAGE" ] ;;
notify-send) exit "$AL_NOTIFY_RC" ;;
ftp) printf 'fixture\n' >"$3" ;;
detach|fixture-terminal)
	if [ "$AL_EXEC_CHILD" = 1 ]; then
		[ "$name" != fixture-terminal ] || shift
		"$@" >/dev/null 2>&1
		rc=$?
		printf '%s\n' "$rc" >"$AL_LOG/child-status"
		# detach reports a spawned job, not its eventual result.
		[ "$name" = detach ] || exit "$rc"
	fi ;;
esac
EOF
	chmod +x "$AL_BIN/record"
	for c in xclip dmenu uname pkg_info brew notify-send detach fixture-browser fixture-terminal ftp; do
		ln -s record "$AL_BIN/$c"
	done
	ln -s "$REPO/.local/bin/ifinstalled" "$AL_BIN/ifinstalled"
	export PATH="$AL_BIN" BROWSER=fixture-browser TERMINAL=fixture-terminal EDITOR=fixture-editor
}
al_run() { script=$1; shift; "$VT_SH" "$AL_HANDLER_DIR/$script" "$@"; }
al_receipt() {
	c=$1; shift
	printf '%s\n' "$c" "$@" >"$T/want"
	cmp -s "$T/want" "$AL_LOG/$c" || fail "$c argv differs"
}
al_clear() { rm -f "$AL_LOG"/*; }
al_quiet() { [ ! -s "$T/out" ] || fail "unexpected output"; }

t_action_loop_empty_clipboard() {
	al_setup
	for input in absent explicit; do
		al_clear
		if [ "$input" = absent ]; then al_run linkhandler >"$T/out" 2>&1
		else al_run linkhandler '' >"$T/out" 2>&1; fi
		eq 'empty resolved link status' 0 "$?"
		al_quiet
		[ ! -f "$AL_LOG/detach" ] || fail 'empty clipboard dispatched browser'
		al_receipt xclip -selection clipboard -o
	done
}

t_action_loop_link_argv() {
	al_setup
	url='https://example.invalid/a?x=1&y=a b'
	al_run linkhandler "$url"
	al_receipt detach fixture-browser "$url"
	export AL_CLIP="$url"
	al_clear; al_run linkhandler ''
	al_receipt detach fixture-browser "$url"
	printf 'fixture\n' > './-a space.txt'
	al_clear; al_run linkhandler '-a space.txt'
	al_receipt detach fixture-terminal -e fixture-editor './-a space.txt'
	[ ! -f "$AL_LOG/xclip" ] || fail 'explicit link read clipboard'
}

al_missing() {
	program=$1; shift
	al_clear
	al_run "$@" >"$T/out" 2>&1
	eq "missing $program status" 1 "$?"
	al_receipt notify-send "📦 $program" 'must be installed for this function.'
	for c in detach fixture-terminal ftp; do
		[ ! -f "$AL_LOG/$c" ] || fail "missing $program invoked $c"
	done
}

t_action_loop_missing_mpv() {
	al_setup
	export AL_EXEC_CHILD=1
	for AL_OS in OpenBSD Darwin; do
		for AL_ACTION in mpv 'mpv loop' 'mpv float'; do
			al_missing mpv dmenuhandler 'https://example.invalid/a b.mp4'
		done
	done
}

t_action_loop_missing_pdf() {
	al_setup
	export AL_ACTION=PDF
	for AL_OS in OpenBSD Darwin; do
		al_missing zathura dmenuhandler 'https://example.invalid/a b.pdf'
	done
}

t_action_loop_missing_mail() {
	al_setup
	export AL_EXEC_CHILD=1
	for AL_OS in OpenBSD Darwin; do
		for AL_NOTIFY_RC in 0 1 127; do
			al_missing neomutt xdg-terminal-exec neomutt -f 'a space' 'x;*'
		done
	done
}

t_action_loop_selected_argv() {
	al_setup
	ln -s record "$AL_BIN/mpv"; ln -s record "$AL_BIN/zathura"
	url='https://example.invalid/a b?x=*'
	for AL_OS in OpenBSD Darwin; do
		for AL_ACTION in mpv 'mpv loop' 'mpv float'; do
			al_clear; al_run dmenuhandler "$url" >"$T/out" 2>&1
			eq 'available mpv status' 0 "$?"; al_quiet
			case $AL_ACTION in
			mpv) al_receipt detach mpv -quiet "$url" ;;
			'mpv loop') al_receipt detach mpv -quiet --loop "$url" ;;
			'mpv float') al_receipt detach fixture-terminal -e mpv --geometry=+0-0 --autofit=30% --title=mpvfloat "$url" ;;
			esac
			[ ! -f "$AL_LOG/notify-send" ] || fail 'available mpv notified'
		done
		export AL_ACTION=PDF
		printf 'fixture\n' >"$T/a space.pdf"
		al_clear; al_run dmenuhandler "$T/a space.pdf" >"$T/out" 2>&1
		eq 'available PDF status' 0 "$?"; al_quiet
		al_receipt zathura "$T/a space.pdf"
		[ ! -f "$AL_LOG/notify-send" ] || fail 'available PDF notified'
	done
}

t_action_loop_terminal_argv() {
	al_setup
	for AL_OS in OpenBSD Darwin; do
		for mode in command package; do
			al_clear
			if [ "$mode" = command ]; then ln -s record "$AL_BIN/neomutt"
			else rm "$AL_BIN/neomutt"; AL_PACKAGE=neomutt; fi
			al_run xdg-terminal-exec neomutt -f 'a space' 'x;*' >"$T/out" 2>&1
			eq 'terminal launch status' 0 "$?"; al_quiet
			al_receipt fixture-terminal -e neomutt -f 'a space' 'x;*'
			[ ! -f "$AL_LOG/notify-send" ] || fail 'available mail notified'
			AL_PACKAGE=
		done
	done
	# No command keeps the existing terminal-only invocation.
	al_clear; al_run xdg-terminal-exec
	al_receipt fixture-terminal -e
}

t_action_loop_cancel() {
	al_setup
	al_run dmenuhandler >"$T/out" 2>&1
	eq 'input cancellation' 0 "$?"; al_quiet
	al_clear
	al_run dmenuhandler 'https://example.invalid/x' >"$T/out" 2>&1
	eq 'action cancellation' 0 "$?"; al_quiet
	for c in notify-send pkg_info brew detach ftp fixture-terminal; do
		[ ! -f "$AL_LOG/$c" ] || fail "cancellation invoked $c"
	done
}

t_action_loop_rss_dispatch() {
	# Only the upstream generic dispatcher is covered by this fixture.
	# In particular, Darwin's xdg-open wrapper may exec the real open(1).
	case $VT_HOST in
	OpenBSD|Linux) ;;
	*) skip 'RSS dispatch fixture requires OpenBSD/Linux xdg-utils' ;;
	esac
	opener=$(PATH="$syspath" command -v xdg-open)
	[ -n "$opener" ] || skip 'installed xdg-open unavailable'
	grep -q '^open_generic()' "$opener" &&
	    grep -q '^open_generic_xdg_mime()' "$opener" ||
	    skip 'installed xdg-open is not the supported generic dispatcher'
	al_setup
	export XDG_CURRENT_DESKTOP=X-Generic DISPLAY=:fixture-only XDG_DATA_DIRS="$T/no-system-data" XDG_RUNTIME_DIR="$T/runtime"
	unset DE BROWSER WAYLAND_DISPLAY
	mkdir -p "$XDG_DATA_HOME/applications" "$XDG_CONFIG_HOME/newsboat"
	cp "$AL_RSS_DESKTOP" "$XDG_DATA_HOME/applications/rss.desktop"
	cat >"$AL_BIN/xdg-mime" <<'EOF'
#!/bin/sh
case $2 in filetype) echo application/rss+xml ;; default) echo rss.desktop ;; *) exit 1 ;; esac
EOF
	# Record exact argv, then exercise real rssadd with synthetic, local XML.
	cat >"$AL_BIN/rssadd" <<'EOF'
#!/bin/sh
printf '%s\n' rssadd "$@" >"$AL_LOG/rssadd"
exec "$VT_SH" "$REPO/.local/bin/rssadd" "$@"
EOF
	ln -s /usr/bin/awk "$AL_BIN/awk"
	chmod +x "$AL_BIN/rssadd" "$AL_BIN/xdg-mime"
	file="$T/feed space quote'.xml"
	printf '<link rel="self" href="https://example.invalid/feed"/>\n' >"$file"
	encoded=$(printf '%s' "$file" | sed "s/%/%25/g; s/ /%20/g; s/#/%23/g; s/'/%27/g")
	for input in "$file" "file://$file" "file://$encoded"; do
		al_clear; : >"$XDG_CONFIG_HOME/newsboat/urls"
		"$VT_SH" "$opener" "$input" >"$T/out" 2>&1
		eq 'generic dispatch status' 0 "$?"
		al_receipt rssadd "$file"
		eq 'synthetic feed imported' https://example.invalid/feed "$(cat "$XDG_CONFIG_HOME/newsboat/urls")"
	done
	# rssadd is single-input; do not advertise plural desktop-file semantics.
	grep -qx 'Exec=rssadd %f' "$AL_RSS_DESKTOP" || fail 'RSS field must describe one local file'
}
