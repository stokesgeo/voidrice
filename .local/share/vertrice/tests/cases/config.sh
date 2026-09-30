# shortcuts, cwmrc, and the shell files: each must parse and load.

# sc_setup: a config home holding the repository's bookmark files.
sc_setup() {
	mkdir -p "$XDG_CONFIG_HOME/shell" "$XDG_CONFIG_HOME/lf" "$XDG_CONFIG_HOME/nvim"
	ln -s "$REPO/.config/shell/bm-dirs" "$XDG_CONFIG_HOME/shell/bm-dirs"
	ln -s "$REPO/.config/shell/bm-files" "$XDG_CONFIG_HOME/shell/bm-files"
	shortcuts || fail "shortcuts failed"
}

t_shortcuts_source_cleanly() {
	sc_setup
	sc=$XDG_CONFIG_HOME/shell
	err=$("$VT_SH" -n "$sc/shortcutrc" 2>&1) || fail "shortcutrc does not parse: $err"
	err=$("$VT_SH" -n "$sc/shortcutenvrc" 2>&1) || fail "shortcutenvrc does not parse: $err"
	out=$("$VT_KSH" -c ". '$sc/shortcutrc' && alias cf && alias cfk" 2>&1) ||
		fail "shortcutrc does not load: $out"
	eq "dir alias and file alias" "cf='cd $XDG_CONFIG_HOME && ls -A'
cfk='vi $XDG_CONFIG_HOME/ksh/kshrc'" "$out"
	out=$("$VT_KSH" -c ". '$sc/shortcutenvrc' && echo \"\$h|\$sc|\$bf\"" 2>&1)
	eq "exported bookmarks" "$HOME|$HOME/.local/bin|$XDG_CONFIG_HOME/shell/bm-files" "$out"
	# Every bookmark, and nothing else, becomes an alias.
	n=$(cat "$REPO/.config/shell/bm-dirs" "$REPO/.config/shell/bm-files" |
		grep -Evc '^[[:space:]]*(#|$)')
	# ksh has built-in aliases of its own: count only the new ones.
	base=$("$VT_KSH" -c alias | wc -l)
	got=$("$VT_KSH" -c ". '$sc/shortcutrc'; alias" | wc -l)
	eq "one alias per bookmark" "$n" "$((got - base))"
	has "lf" "map Ccf cd \"$XDG_CONFIG_HOME\"" "$(cat "$XDG_CONFIG_HOME/lf/shortcutrc")"
	has "nvim" "cmap ;cfk $XDG_CONFIG_HOME/ksh/kshrc" "$(cat "$XDG_CONFIG_HOME/nvim/shortcuts.vim")"
	# The comment after cfb must not become part of its path.
	hasnt "comments stripped" "#" "$(grep '^cfb=' "$sc/shortcutrc")"
}

t_shortcuts_leaves_dev_null() {
	sc_setup
	notlogged '^rm-devnull'
}

# Only the paths go through eval: a backtick in a comment is not run, and a
# lone quote in a comment does not end the file early.
t_shortcuts_comments_not_evaluated() {
	mkdir -p "$XDG_CONFIG_HOME/shell" "$XDG_CONFIG_HOME/lf" "$XDG_CONFIG_HOME/nvim"
	printf '# `touch %s/ran`\nh  $HOME\n' "$T" >"$XDG_CONFIG_HOME/shell/bm-dirs"
	printf 'bf\t~/f\t# a 12" note\n' >"$XDG_CONFIG_HOME/shell/bm-files"
	shortcuts 2>"$T/err" || fail "shortcuts failed"
	[ ! -e "$T/ran" ] || fail "a comment ran as a command"
	eq "no errors" "" "$(cat "$T/err")"
	out=$("$VT_KSH" -c ". '$XDG_CONFIG_HOME/shell/shortcutrc' && alias h && alias bf" 2>&1)
	eq "both aliases" "h='cd $HOME && ls -A'
bf='vi ~/f'" "$out"
}

# lf's delete runs as `sh -eu` (lfrc's shellopts) with $fx the selection.
# Enter alone is the default no: nothing deleted, and no error.
t_lf_delete() {
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/clear"; printf '#!/bin/sh\necho 24\n' >"$T/bin/tput"
	chmod +x "$T/bin/clear" "$T/bin/tput"
	body=$(sed -n '/^cmd delete \${{$/,/^}}$/p' "$REPO/.config/lf/lfrc" | sed '1d;$d')
	[ -n "$body" ] || fail "no delete command in lfrc"
	: >"$T/f"
	err=$(echo | fx=$T/f "$VT_SH" -eu -c "$body" 2>&1 >/dev/null)
	eq "empty answer: no error" "" "$err"
	[ -f "$T/f" ] || fail "empty answer deleted the file"
	echo y | fx=$T/f "$VT_SH" -eu -c "$body" >/dev/null 2>&1
	[ -f "$T/f" ] && fail "y did not delete"
	return 0
}

t_cwmrc_accepted() {
	[ -x "$CWM" ] || skip "no cwm binary (set CWM)"
	out=$("$CWM" -n -c "$REPO/.config/cwm/cwmrc" 2>&1) || fail "cwm -n: $out"
	eq "cwm -n is silent" "" "$out"
}

t_cwmrc_function_names() {
	c=$CWM_SRC/conf.c
	[ -r "$c" ] || skip "no cwm source (set CWM_SRC to the directory with conf.c)"
	# cwm runs a bare word it does not know as a command, so a misspelt
	# function would pass cwm -n. Each bare word must be a function in
	# conf.c's table, or a program: in this repository or listed here.
	funcs=$(sed -n 's/.*FUNC_[CS]C(\([a-z0-9-]*\),.*/\1/p' "$c")
	[ -n "$funcs" ] || fail "no functions found in $c"
	external="chromium video"
	bad=
	for w in $(awk '$1 == "bind-key" || $1 == "bind-mouse" { if ($3 !~ /^"/) print $3 }' \
	    "$REPO/.config/cwm/cwmrc"); do
		printf '%s\n' "$funcs" | grep -qx -- "$w" && continue
		[ -f "$REPO/.local/bin/$w" ] || [ -f "$REPO/.local/bin/statusbar/$w" ] && continue
		case " $external " in *" $w "*) continue ;; esac
		bad="$bad $w"
	done
	eq "unknown bare words" "" "${bad# }"
	# And every cwm function SPEC.md's walk names exists.
	for w in $(grep -o '`[a-z]*-[a-z0-9-]*`' "$REPO/.local/share/vertrice/SPEC.md" | tr -d '`' | sort -u); do
		case $w in window-*|group-*|menu-*)
			printf '%s\n' "$funcs" | grep -qx -- "$w" || bad="$bad $w" ;;
		esac
	done
	eq "SPEC.md names only real functions" "" "${bad# }"
}

t_parse_shell_files() {
	bad=
	for f in .config/shell/profile .config/ksh/kshrc .config/shell/aliasrc \
	    .config/x11/xinitrc .config/x11/xprofile .local/share/openbsd/root.kshrc; do
		"$VT_KSH" -n "$REPO/$f" 2>"$T/err" || bad="$bad $f($(cat "$T/err"))"
	done
	eq "parse errors" "" "${bad# }"
}

t_parse_check() {
	err=$("$VT_KSH" -n "$REPO/.local/share/vertrice/tests/check" 2>&1) || fail "check: $err"
	has "check is ksh" "#!/bin/ksh" "$(sed -n 1p "$REPO/.local/share/vertrice/tests/check")"
}

t_parse_scripts() {
	# Every sh and ksh script in bin, under the shell its first line names.
	bad=
	for f in "$REPO"/.local/bin/* "$REPO"/.local/bin/*/* "$REPO"/.local/share/openbsd/hotplug-attach; do
		[ -f "$f" ] || continue
		case $(sed -n 1p "$f") in '#!/bin/sh'*|'#!/bin/ksh'*) ;; *) continue ;; esac
		"$(interp "$f")" -n "$f" 2>"$T/err" || bad="$bad ${f#"$REPO"/}($(cat "$T/err"))"
	done
	eq "parse errors" "" "${bad# }"
}

# A home laid out like the machine's: the repository's config, read-only
# in effect (shortcuts is not run: detach is a mock), and a scratch
# ~/.local for the history file and the PATH directories.
home_setup() {
	mkdir -p "$HOME/.config" "$HOME/.local/share"
	for d in ksh shell vi x11; do ln -s "$REPO/.config/$d" "$HOME/.config/$d"; done
	# find(1) does not follow a symlinked start, so bin is a real tree.
	mkdir -p "$HOME/.local/bin/statusbar" "$HOME/.local/bin/cron" "$HOME/.local/bin/wrap"
	ln -s "$REPO/.config/shell/profile" "$HOME/.profile"
	unset XDG_CONFIG_HOME XDG_CACHE_HOME
}

t_profile_loads() {
	home_setup
	out=$("$VT_SH" -c '. "$HOME/.profile"; printf "%s\n" "$ENV" "$NEXINIT" "$EDITOR" "$PATH"' 2>&1) ||
		fail "profile failed: $out"
	eq "ENV" "$HOME/.config/ksh/kshrc" "$(printf '%s\n' "$out" | sed -n 1p)"
	eq "NEXINIT" "source $HOME/.config/vi/exrc" "$(printf '%s\n' "$out" | sed -n 2p)"
	path=$(printf '%s\n' "$out" | sed -n 4p)
	has "statusbar on PATH" ":$HOME/.local/bin/statusbar" "$path"
	# Only the wrap folder (the dmenu wrapper) comes before base, once.
	case $path in "$HOME/.local/bin/wrap:"*) ;; *) fail "~/.local/bin/wrap must come first" ;; esac
	case ${path#"$HOME/.local/bin/wrap:"} in
	"$HOME/.local/bin"*) fail "~/.local/bin must come last, after base" ;;
	*"$HOME/.local/bin/wrap"*) fail "wrap is on PATH twice" ;;
	esac
	logged '^detach shortcuts$'
}

t_kshrc_loads() {
	home_setup
	. "$HOME/.profile" >/dev/null 2>&1
	with_tty "$VT_KSH" -i -c 'type lfcd; alias cp; [[ -o vi ]] && echo vi-mode'
	out=$(tr -d '\r' <"$T/tty.out")
	has "lfcd defined" "lfcd is a function" "$out"
	has "aliasrc loaded" "cp='cp -iv'" "$out"
	has "vi mode" "vi-mode" "$out"
	hasnt "no errors" "not found" "$out"
	hasnt "no syntax errors" "syntax error" "$out"
}

# The doas aliases only where there is a doas: the X220, not the Mac,
# where "mount" through them was "doas: not found".
t_aliasrc_doas() {
	mkdir -p "$T/withdoas" "$T/nodoas"
	ln -s "$VT_MOCKS/doas" "$T/withdoas/doas"
	a='. "$REPO/.config/shell/aliasrc"; alias mount; alias sdn'
	eq "X220: through doas" "mount='doas mount'
sdn='doas shutdown -p now'" "$(PATH=$T/withdoas "$VT_SH" -c "$a" 2>&1)"
	hasnt "no doas: no aliases" doas "$(PATH=$T/nodoas "$VT_SH" -c "$a" 2>&1)"
}

# cp, mv, rm, mkdir aliases use only flags OpenBSD's tools take: the getopt
# strings of bin/cp/cp.c, bin/mv/mv.c, bin/rm/rm.c, bin/mkdir/mkdir.c
# (OpenBSD src, 2026).
t_aliasrc_flags() {
	bad=
	for pair in cp:HLPRafiprv mv:ifv rm:dfiPRrv mkdir:pm; do
		c=${pair%%:*} ok=${pair#*:}
		a=$(sed -n "s/^[[:space:]]*$c=\"$c \(-[A-Za-z]*\)\".*/\1/p" "$REPO/.config/shell/aliasrc")
		a=${a#-}
		[ -n "$a" ] || continue
		rest=$(printf '%s' "$a" | tr -d "$ok")
		[ -z "$rest" ] || bad="$bad $c:-$rest"
	done
	eq "flags OpenBSD lacks" "" "${bad# }"
	grep -q '^[[:space:]]*rm="rm -v"' "$REPO/.config/shell/aliasrc" || fail "rm -v alias missing"
	grep -q 'YT=' "$REPO/.config/shell/aliasrc" && fail "YT (youtube-viewer, no port) is back"
	return 0
}

# xprofile's autostart loop, run alone on the mocks: each program starts
# once, and no compositor (xterm has no transparency to show).
t_xprofile_autostart() {
	sed -n '/^autostart=/,/^done/p' "$REPO/.config/x11/xprofile" >"$T/block"
	grep -q '^done' "$T/block" || fail "no autostart loop in xprofile"
	for p in mpd dunst unclutter xcompmgr picom; do
		printf '#!/bin/sh\necho "%s $*" >>"$VT_STATE/log"\n' "$p" >"$T/bin/$p"
	done
	chmod +x "$T/bin/"*
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/pgrep"; chmod +x "$T/bin/pgrep"
	"$VT_SH" "$T/block"; wait
	waitfor 2 grep -q '^unclutter' "$VT_STATE/log" || fail "autostart ran nothing"
	logged '^mpd'; logged '^dunst'
	notlogged '^(xcompmgr|picom)'
}

# xinitrc's session-env block, run alone (the rest starts X programs):
# the file it writes is private and gives a cron job the bus and display.
t_xinitrc_session_env() {
	awk '/^# Cron jobs read/ { on = 1 } on && /^$/ { exit } on' \
		"$REPO/.config/x11/xinitrc" >"$T/block"
	grep -q session-env "$T/block" || fail "no session-env block in xinitrc"
	DBUS_SESSION_BUS_ADDRESS='unix:path=/tmp/dbus-AbC,guid=123' DISPLAY=:0 \
		"$VT_SH" "$T/block" || fail "block failed"
	f=$XDG_CACHE_HOME/session-env
	eq "private" "-rw-------" "$(ls -l "$f" | cut -c1-10)"
	got=$(env -i HOME="$HOME" "$VT_SH" -c ". '$f'; echo \"\$DBUS_SESSION_BUS_ADDRESS \$DISPLAY\"")
	eq "a cron job gets the session" "unix:path=/tmp/dbus-AbC,guid=123 :0" "$got"
}
