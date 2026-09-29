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
	external="chromium"
	bad=
	for w in $(awk '$1 == "bind-key" || $1 == "bind-mouse" { if ($3 !~ /^"/) print $3 }' \
	    "$REPO/.config/cwm/cwmrc"); do
		printf '%s\n' "$funcs" | grep -qx -- "$w" && continue
		[ -f "$REPO/.local/bin/$w" ] || [ -f "$REPO/.local/bin/statusbar/$w" ] && continue
		case " $external " in *" $w "*) continue ;; esac
		bad="$bad $w"
	done
	eq "unknown bare words" "" "${bad# }"
	# And every function the table in OPENBSD.md names exists.
	for w in $(grep -o '`[a-z]*-[a-z0-9-]*`' "$REPO/OPENBSD.md" | tr -d '`' | sort -u); do
		case $w in window-*|group-*|menu-*)
			printf '%s\n' "$funcs" | grep -qx -- "$w" || bad="$bad $w" ;;
		esac
	done
	eq "OPENBSD.md names only real functions" "" "${bad# }"
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
	err=$("$VT_KSH" -n "$REPO/.local/share/openbsd/check" 2>&1) || fail "check: $err"
	has "check is ksh" "#!/bin/ksh" "$(sed -n 1p "$REPO/.local/share/openbsd/check")"
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
	mkdir -p "$HOME/.local/bin/statusbar" "$HOME/.local/bin/cron"
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
	case $path in "$HOME/.local/bin"*) fail "~/.local/bin must come last, after base" ;; esac
	logged '^detach shortcuts$'
}

t_kshrc_loads() {
	home_setup
	. "$HOME/.profile" >/dev/null 2>&1
	with_tty "$VT_KSH" -i -c 'type lfcd; alias cp; [[ -o vi ]] && echo vi-mode'
	out=$(tr -d '\r' <"$T/tty.out")
	has "lfcd defined" "lfcd is a function" "$out"
	has "aliasrc loaded" "cp='cp -i'" "$out"
	has "vi mode" "vi-mode" "$out"
	hasnt "no errors" "not found" "$out"
	hasnt "no syntax errors" "syntax error" "$out"
}
