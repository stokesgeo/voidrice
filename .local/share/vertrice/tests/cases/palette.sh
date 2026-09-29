# theme's dunst and zathura colours, and the pywal opt-in.
# th_setup and count are in desktop.sh.

t_palette_switch() {
	th_setup
	DISPLAY=:0 "$VT_KSH" "$theme" day || fail "theme day failed"
	has "dunst" 'background = "#f5f1e8"' "$(cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf")"
	has "zathura" 'set default-bg "#f5f1e8"' "$(cat "$XDG_CONFIG_HOME/zathura/theme")"
	logged '^dunstctl reload$'
	DISPLAY=:0 "$VT_KSH" "$theme" toggle
	has "dunst night" 'background = "#24232e"' "$(cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf")"
	has "zathura night" 'set default-bg "#24232e"' "$(cat "$XDG_CONFIG_HOME/zathura/theme")"
	# Each palette's colours match its dunst and zathura files.
	for p in day night; do
		bg=$(sed -n 's/^\*\.background: //p' "$REPO/.config/x11/themes/$p")
		fg=$(sed -n 's/^\*\.foreground: //p' "$REPO/.config/x11/themes/$p")
		eq "$p dunst" 6 "$(grep -Ec "\"($bg|$fg)\"" "$REPO/.config/x11/themes/$p.dunst")"
		eq "$p zathura" 8 "$(grep -Ec "\"($bg|$fg)\"" "$REPO/.config/x11/themes/$p.zathura")"
	done
}

# GTK follows day and night; wal leaves it; the other settings are kept.
t_palette_gtk() {
	th_setup
	mkdir -p "$XDG_CONFIG_HOME/gtk-3.0"
	ini=$XDG_CONFIG_HOME/gtk-3.0/settings.ini
	cp "$REPO/.config/gtk-3.0/settings.ini" "$ini"
	"$VT_KSH" "$theme" night || fail "theme night failed"
	eq "night" "gtk-theme-name=Adwaita-dark" "$(grep '^gtk-theme-name=' "$ini")"
	"$VT_KSH" "$theme" day
	eq "day" "gtk-theme-name=Adwaita" "$(grep '^gtk-theme-name=' "$ini")"
	eq "only that line changed" "" "$(diff "$REPO/.config/gtk-3.0/settings.ini" "$ini")"
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*.background: #101010\n' >"$XDG_CACHE_HOME/wal/colors.Xresources"
	: >"$XDG_CACHE_HOME/wal/dunstrc"; : >"$XDG_CACHE_HOME/wal/zathurarc"
	"$VT_KSH" "$theme" wal
	eq "wal leaves GTK" "gtk-theme-name=Adwaita" "$(grep '^gtk-theme-name=' "$ini")"
	[ -e "$ini.new" ] && fail "left settings.ini.new"
	return 0
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
