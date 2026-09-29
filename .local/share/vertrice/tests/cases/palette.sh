# theme's dunst, zathura and root-window colours, and the pywal opt-in.
# th_setup and count are in desktop.sh.

t_palette_switch() {
	th_setup
	cp "$VT_REAL_SLEEP" "$T/bin/zathura"; "$T/bin/zathura" 30 & zp=$!; track $zp
	DISPLAY=:0 "$VT_KSH" "$theme" day || fail "theme day failed"
	has "dunst" 'background = "#f5f1e8"' "$(cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf")"
	has "zathura" 'set default-bg "#f5f1e8"' "$(cat "$XDG_CONFIG_HOME/zathura/theme")"
	logged '^dunstctl reload$'
	logged "^dbus-send .*--dest=org\.pwmt\.zathura\.PID-$zp /org/pwmt/zathura org\.pwmt\.zathura\.SourceConfig\$"
	logged '^xsetroot -solid #f5f1e8$'
	DISPLAY=:0 "$VT_KSH" "$theme" toggle
	logged '^xsetroot -solid #24232e$'	# the root window follows the switch
	has "dunst night" 'background = "#24232e"' "$(cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf")"
}

t_palette_wal() {
	th_setup
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*.foreground: #e0e0e0\n*.background: #101010\n*.color0: #101010\n' >"$XDG_CACHE_HOME/wal/colors.Xresources"
	echo walcolours >"$XDG_CACHE_HOME/wal/dunstrc"; echo walcolours >"$XDG_CACHE_HOME/wal/zathurarc"
	printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$VT_KSH" "$theme" >"$T/bin/theme"; chmod +x "$T/bin/theme"
	"$VT_SH" "$REPO/.config/wal/postrun" || fail "postrun failed"
	eq "terminals" 1 "$(count "]11;#101010" "$T/dev/ttyp3")"
	eq "dunst: wal's" walcolours "$(cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf")"
	eq "zathura: wal's" walcolours "$(cat "$XDG_CONFIG_HOME/zathura/theme")"
	: >"$VT_STATE/log"
	PALETTE=wal "$VT_KSH" "$theme" clock
	eq "clock leaves wal alone" wal "$(cat "$XDG_CACHE_HOME/theme")"
	# setbg runs wal only when opted in.
	printf '#!/bin/sh\necho "wal $*" >>"$VT_STATE/log"\n' >"$T/bin/wal"; chmod +x "$T/bin/wal"
	setbg -s; notlogged '^wal'
	PALETTE=wal setbg -s; logged '^wal -n -i '
}
