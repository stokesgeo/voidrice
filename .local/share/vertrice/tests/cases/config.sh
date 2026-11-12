# shortcuts, cwmrc, and the shell files: each must parse and load.

# sc_setup: a config home holding the repository's bookmark files.
sc_setup() {
	mkdir -p "$XDG_CONFIG_HOME/shell" "$XDG_CONFIG_HOME/lf" "$XDG_CONFIG_HOME/nvim"
	ln -s "$REPO/.config/shell/bm-dirs" "$XDG_CONFIG_HOME/shell/bm-dirs"
	ln -s "$REPO/.config/shell/bm-files" "$XDG_CONFIG_HOME/shell/bm-files"
	vertrice-shortcuts || fail "bookmark generation failed"
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
	vertrice-shortcuts 2>"$T/err" || fail "bookmark generation failed"
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
	external="qutebrowser video"
	bad=
	for w in $(awk '$1 == "bind-key" || $1 == "bind-mouse" { if ($3 !~ /^"/) print $3 }' \
	    "$REPO/.config/cwm/cwmrc"); do
		printf '%s\n' "$funcs" | grep -qx -- "$w" && continue
		[ -f "$REPO/.local/bin/$w" ] || [ -f "$REPO/.local/bin/statusbar/$w" ] && continue
		case " $external " in *" $w "*) continue ;; esac
		bad="$bad $w"
	done
	eq "unknown bare words" "" "${bad# }"
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
	mkdir -p "$HOME/.local/bin/statusbar" "$HOME/.local/bin/cron" "$HOME/.local/bin/openbsd"
	ln -s "$REPO/.config/shell/profile" "$HOME/.profile"
	unset XDG_CONFIG_HOME XDG_CACHE_HOME
	# The profile picks its first directory by uname; mac (darwin-shims.sh)
	# says Darwin over this.
	printf '#!/bin/sh\necho OpenBSD\n' >"$T/bin/uname"
	chmod +x "$T/bin/uname"
}

t_profile_loads() {
	home_setup
	out=$("$VT_SH" -c '. "$HOME/.profile"; printf "%s\n" "$ENV" "$NEXINIT" "$EDITOR" "$PATH" "$BROWSER" "$TERMINAL_BROWSER"' 2>&1) ||
		fail "profile failed: $out"
	eq "ENV" "$HOME/.config/ksh/kshrc" "$(printf '%s\n' "$out" | sed -n 1p)"
	eq "NEXINIT" "source $HOME/.config/vi/exrc" "$(printf '%s\n' "$out" | sed -n 2p)"
	path=$(printf '%s\n' "$out" | sed -n 4p)
	eq "OpenBSD human browser" qutebrowser "$(printf '%s\n' "$out" | sed -n 5p)"
	eq "OpenBSD terminal browser" w3m "$(printf '%s\n' "$out" | sed -n 6p)"
	has "statusbar on PATH" ":$HOME/.local/bin/statusbar" "$path"
	# Only the openbsd folder (the dmenu wrapper) comes before base, once.
	case $path in "$HOME/.local/bin/openbsd:"*) ;; *) fail "~/.local/bin/openbsd must come first" ;; esac
	case ${path#"$HOME/.local/bin/openbsd:"} in
	"$HOME/.local/bin"*) fail "~/.local/bin must come last, after base" ;;
	*"$HOME/.local/bin/openbsd"*) fail "openbsd is on PATH twice" ;;
	esac
	logged '^detach vertrice-shortcuts$'
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
	for p in mpd dunst unclutter; do
		waitfor 2 grep -q "^$p" "$VT_STATE/log" || fail "autostart did not record $p"
	done
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

t_zathura_native_defaults() {
	# OpenBSD 0.5.14 rejects these inherited options; both page gaps default to 1.
	if grep -Eq '^set (sandbox|page-padding)[[:space:]]' "$REPO/.config/zathura/zathurarc"; then
		fail "unsupported PDF-viewer setting"
	fi
}

t_nvim_save_preserves_text() {
	[ -n "$VT_REAL_NVIM" ] || skip "no native nvim"
	mkdir -p "$XDG_CONFIG_HOME/nvim/autoload"
	# Keep this a config test: no network or third-party plugin execution.
	cat >"$XDG_CONFIG_HOME/nvim/autoload/plug.vim" <<'EOF'
function! plug#begin(...)
  command! -nargs=+ Plug call len([])
endfunction
function! plug#end()
endfunction
EOF
	printf 'First line  \nSecond line\n\n\n' >"$T/prose.md"
	cp "$T/prose.md" "$T/expected"
	"$VT_REAL_NVIM" --headless -n -i NONE -u "$REPO/.config/nvim/init.vim" \
		"$T/prose.md" -c wq >"$T/nvim.out" 2>&1 || fail "nvim startup/save failed: $(cat "$T/nvim.out")"
	cmp "$T/expected" "$T/prose.md" || fail "ordinary save changed Markdown whitespace"
	printf 'First line  \nLast line\t' >"$T/noeol.md"
	cp "$T/noeol.md" "$T/expected-noeol"
	"$VT_REAL_NVIM" --headless -n -i NONE -u "$REPO/.config/nvim/init.vim" \
		"$T/noeol.md" -c wq >"$T/noeol.out" 2>&1 || fail "nvim no-EOL save failed"
	cmp "$T/expected-noeol" "$T/noeol.md" || fail "ordinary save added a final newline"
}

t_nvim_loads_generated_shortcuts() {
	[ -n "$VT_REAL_NVIM" ] || skip 'no native nvim'
	mkdir -p "$XDG_CONFIG_HOME/nvim/autoload"
	cat >"$XDG_CONFIG_HOME/nvim/autoload/plug.vim" <<'EOF'
function! plug#begin(...)
  command! -nargs=+ Plug call len([])
endfunction
function! plug#end()
endfunction
EOF
	echo 'let g:vertrice_fixture_shortcuts = 1' >"$XDG_CONFIG_HOME/nvim/shortcuts.vim"
	"$VT_REAL_NVIM" --headless -n -i NONE -u "$REPO/.config/nvim/init.vim" \
	    -c 'if !get(g:, "vertrice_fixture_shortcuts", 0) | cquit | endif' \
	    -c qa >"$T/nvim.out" 2>&1 || fail "generated shortcuts were not sourced: $(cat "$T/nvim.out")"
}

t_xprofile_initial_palette() {
	sed -n '/^# Set the palette before/,$p' "$REPO/.config/x11/xprofile" >"$T/palette"
	grep -q 'theme auto' "$T/palette" || fail "no initial palette before the clock"
	cat >"$T/bin/theme" <<'EOF'
#!/bin/sh
echo "theme $*" >>"$VT_STATE/log"
EOF
	chmod +x "$T/bin/theme"
	PALETTE= "$VT_SH" -c '. "$1"; wait' sh "$T/palette"
	eq "initial palette then clock" "$(printf 'theme auto\ntheme clock')" "$(cat "$VT_STATE/log")"
	: >"$VT_STATE/log"
	PALETTE=wal "$VT_SH" -c '. "$1"; wait' sh "$T/palette"
	eq "wal is not overwritten" 'theme clock' "$(cat "$VT_STATE/log")"
}

t_xinitrc_session_cleanup() {
	mkdir -p "$XDG_CONFIG_HOME/x11"
	cat >"$XDG_CONFIG_HOME/x11/xprofile" <<'EOF'
"$VT_REAL_SLEEP" 30 & themepid=$!
echo "$themepid" >>"$VT_STATE/session.pids"
"$VT_REAL_SLEEP" 30 & hotplugpid=$!
echo "$hotplugpid" >>"$VT_STATE/session.pids"
EOF
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/dbus-launch"
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/cwm"
	cat >"$T/bin/xterm" <<'EOF'
#!/bin/sh
echo $$ >>"$VT_STATE/session.pids"
exec "$VT_REAL_SLEEP" 30
EOF
	chmod +x "$T/bin/dbus-launch" "$T/bin/cwm" "$T/bin/xterm"
	SSH_AUTH_SOCK=fixture WM=cwm TERMINAL=xterm "$VT_SH" \
		"$REPO/.config/x11/xinitrc" >"$T/session.out" 2>&1
	for pid in $(cat "$VT_STATE/session.pids"); do track "$pid"; done
	for pid in $(cat "$VT_STATE/session.pids"); do
		waitfor 2 gone "$pid" || fail "session job $pid survived window manager exit"
	done
}

# lf's bulkrename: the selection, by name, in $EDITOR. A file left out of
# the selection stays out of the list.
t_lf_bulkrename() {
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/lf"; chmod +x "$T/bin/lf"
	printf '#!/bin/sh\nprintf "x\\nc\\n" >"$1"\n' >"$T/ed"; chmod +x "$T/ed"
	body=$(sed -n '/^cmd bulkrename \${{$/,/^}}$/p' "$REPO/.config/lf/lfrc" | sed '1d;$d')
	[ -n "$body" ] || fail "no bulkrename command in lfrc"
	mkdir "$T/d" && cd "$T/d" || fail "no dir"
	: >"a b"; : >c; : >z
	fs="$T/d/a b
$T/d/c" EDITOR=$T/ed id=1 "$VT_SH" -eu -c "IFS='
'; $body" || fail "bulkrename failed"
	[ -e x ] && [ ! -e "a b" ] || fail "a b not renamed: $(ls)"
	[ -e c ] && [ -e z ] || fail "c or z moved: $(ls)"
}
