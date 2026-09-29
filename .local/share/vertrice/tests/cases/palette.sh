# The palette: theme's dunst and zathura colours, the root window after a
# switch, and the pywal opt-in (setbg, wal/postrun, theme wal).
# th_setup and count are in desktop.sh.

# fakeproc NAME: a process called NAME (a copy of sleep), for pgrep -x.
fakeproc() {
	cp "$VT_REAL_SLEEP" "$T/bin/$1"
	"$T/bin/$1" 30 & track $!
}
dropin() { cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf"; }
zth() { cat "$XDG_CONFIG_HOME/zathura/theme"; }

t_palette_dunst_zathura() {
	th_setup
	DISPLAY=:0 "$VT_KSH" "$theme" day || fail "theme day failed"
	has "dunst background" 'background = "#f5f1e8"' "$(dropin)"
	has "dunst text" 'foreground = "#383642"' "$(dropin)"
	has "dunst low: dim grey" 'foreground = "#6f6a63"' "$(dropin)"
	has "zathura page" 'set default-bg "#f5f1e8"' "$(zth)"
	has "zathura recolour" 'set recolor-darkcolor "#383642"' "$(zth)"
	notlogged '^dunstctl'
	notlogged '^dbus-send'
	"$VT_KSH" "$theme" night
	has "night: dunst" 'background = "#24232e"' "$(dropin)"
	has "night: zathura" 'set default-bg "#24232e"' "$(zth)"
	hasnt "day gone" '#f5f1e8' "$(dropin)$(zth)"
	# The included file must parse as zathura settings: set NAME "VALUE".
	bad=$(grep -v '^#' "$XDG_CONFIG_HOME/zathura/theme" | grep -Ev '^set [a-z-]+ "#[0-9a-f]{6}"$')
	eq "zathura lines" "" "$bad"
	has "zathurarc includes it" "include theme" "$(cat "$REPO/.config/zathura/zathurarc")"
}

t_palette_reloads() {
	th_setup
	fakeproc dunst; fakeproc zathura; zp=$!
	"$VT_KSH" "$theme" night
	logged '^dunstctl reload$'
	logged "^dbus-send --session --type=method_call --dest=org\.pwmt\.zathura\.PID-$zp /org/pwmt/zathura org\.pwmt\.zathura\.SourceConfig\$"
}

t_palette_root_follows_switch() {
	command -v xwallpaper >/dev/null 2>&1 && skip "this host has xwallpaper"
	th_setup
	DISPLAY=:0 "$VT_KSH" "$theme" day
	logged '^xsetroot -solid #f5f1e8$'
	: >"$VT_STATE/log"
	DISPLAY=:0 "$VT_KSH" "$theme" toggle
	logged '^xsetroot -solid #24232e$'
	: >"$VT_STATE/log"
	"$VT_KSH" "$theme" day
	notlogged '^xsetroot'	# no X: nothing to set
	printf '#!/bin/sh\necho "xwallpaper $*" >>"$VT_STATE/log"\n' >"$T/bin/xwallpaper"
	chmod +x "$T/bin/xwallpaper"
	DISPLAY=:0 "$VT_KSH" "$theme" night
	notlogged '^xsetroot'	# the wallpaper covers the root window
}

# A wal run, as pywal leaves it: the three templates filled in.
fx_walcache() {
	mkdir -p "$XDG_CACHE_HOME/wal"
	sed 's/{background}/#101010/; s/{foreground}/#e0e0e0/; s/{cursor}/#e0e0e0/; s/{color\([0-9]*\)}/#0000\1/' \
		"$REPO/.config/wal/templates/palette" >"$XDG_CACHE_HOME/wal/palette"
	for f in dunstrc zathurarc; do
		sed 's/{[a-z0-9]*}/#abcdef/' "$REPO/.config/wal/templates/$f" >"$XDG_CACHE_HOME/wal/$f"
	done
}

t_palette_theme_wal() {
	th_setup
	fx_walcache
	DISPLAY=:0 "$VT_KSH" "$theme" wal || fail "theme wal failed"
	logged "^xrdb -merge $XDG_CACHE_HOME/wal/palette\$"
	eq "terminal background" 1 "$(count "]11;#101010" "$T/dev/ttyp3")"
	eq "dunst: wal's template" "$(cat "$XDG_CACHE_HOME/wal/dunstrc")" "$(dropin)"
	eq "zathura: wal's template" "$(cat "$XDG_CACHE_HOME/wal/zathurarc")" "$(zth)"
	eq "state" wal "$(cat "$XDG_CACHE_HOME/theme")"
	"$VT_KSH" "$theme" toggle
	eq "toggle from wal: day" day "$(cat "$XDG_CACHE_HOME/theme")"
}

t_palette_clock_off_with_wal() {
	th_setup
	PALETTE=wal "$VT_KSH" "$theme" clock || fail "clock with wal: nonzero"
	[ -e "$XDG_CACHE_HOME/theme" ] && fail "clock applied a palette over wal's"
	return 0
}

t_palette_wal_templates() {
	# Every field is one pywal fills in (pywal's colors_to_dict).
	bad=$(cat "$REPO"/.config/wal/templates/* | grep -o '{[^}]*}' |
		grep -Ev '^\{(background|foreground|cursor|color([0-9]|1[0-5]))\}$' | sort -u)
	eq "unknown template fields" "" "$bad"
	# The dunst template is a drop-in: no [global] section, no geometry.
	hasnt "dunst drop-in only colours" "[global]" "$(cat "$REPO/.config/wal/templates/dunstrc")"
	eq "postrun is sh" "#!/bin/sh" "$(sed -n 1p "$REPO/.config/wal/postrun")"
	"$VT_SH" -n "$REPO/.config/wal/postrun" || fail "postrun does not parse"
}

t_palette_postrun() {
	th_setup
	fx_walcache
	# postrun runs `theme wal`; theme here is the derived copy.
	printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$VT_KSH" "$theme" >"$T/bin/theme"
	chmod +x "$T/bin/theme"
	"$VT_SH" "$REPO/.config/wal/postrun" || fail "postrun failed"
	eq "applied" wal "$(cat "$XDG_CACHE_HOME/theme")"
	eq "terminal background" 1 "$(count "]11;#101010" "$T/dev/ttyp3")"
}

t_palette_setbg_wal_optin() {
	mkdir -p "$XDG_CONFIG_HOME/x11" "$HOME/.local/share"
	ln -s "$REPO/.config/x11/themes" "$XDG_CONFIG_HOME/x11/themes"
	printf '#!/bin/sh\necho "wal $*" >>"$VT_STATE/log"\n' >"$T/bin/wal"
	chmod +x "$T/bin/wal"
	printf 'x' >"$T/pic.png"
	printf '#!/bin/sh\necho image/png\n' >"$T/bin/file"; chmod +x "$T/bin/file"
	setbg -s "$T/pic.png"
	notlogged '^wal'
	PALETTE=wal setbg -s "$T/pic.png"
	logged "^wal -n -i $T/pic\.png -o $XDG_CONFIG_HOME/wal/postrun\$"
	: >"$VT_STATE/log"; "$VT_REAL_RM" "$T/bin/wal"
	PALETTE=wal setbg -s "$T/pic.png"
	notlogged '^wal'
	logged '^xsetroot -solid '	# the rest of setbg still ran
}
