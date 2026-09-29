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

# GTK follows day and night: theme writes settings.ini whole, so the
# dotfiles need not track it. wal leaves it, but writes the day one if
# there is none.
t_palette_gtk() {
	th_setup
	ini=$XDG_CONFIG_HOME/gtk-3.0/settings.ini
	"$VT_KSH" "$theme" night || fail "theme night failed"
	eq "night" "gtk-theme-name=Adwaita-dark" "$(grep '^gtk-theme-name=' "$ini")"
	eq "the section first" "[Settings]" "$(grep -v '^#' "$ini" | sed -n 1p)"
	eq "every setting" 15 "$(grep -c '^gtk-[a-z-]*=' "$ini")"
	has "the font" "gtk-font-name=Sans 10" "$(cat "$ini")"
	hasnt "no heredoc tabs" "	" "$(cat "$ini")"
	"$VT_KSH" "$theme" day
	eq "day" "gtk-theme-name=Adwaita" "$(grep '^gtk-theme-name=' "$ini")"
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*.background: #101010\n' >"$XDG_CACHE_HOME/wal/colors.Xresources"
	: >"$XDG_CACHE_HOME/wal/dunstrc"; : >"$XDG_CACHE_HOME/wal/zathurarc"
	"$VT_KSH" "$theme" night; "$VT_KSH" "$theme" wal
	eq "wal leaves GTK" "gtk-theme-name=Adwaita-dark" "$(grep '^gtk-theme-name=' "$ini")"
	rm "$ini"; "$VT_KSH" "$theme" wal
	eq "wal, no file: the day one" "gtk-theme-name=Adwaita" "$(grep '^gtk-theme-name=' "$ini")"
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

# The dmenu wrapper (wrap/dmenu): Plex Mono and the palette theme last set,
# then the caller's own options; the menu, answer and exit status pass
# through. The real dmenu is the mock, by its full path.
dm_setup() {
	th_setup
	dm=$(derived .local/bin/wrap/dmenu dmenu "s|/usr/local/bin/dmenu|$VT_MOCKS/dmenu|")
}
t_dmenu_wrap_palette() {
	dm_setup
	"$VT_KSH" "$theme" night >/dev/null
	answers b
	out=$(printf 'a\nb\n' | "$dm" -i -p Pick:) || fail "dmenu wrapper failed"
	eq "answer" b "$out"
	eq "menu" "a b" "$(paste -sd ' ' - <"$VT_STATE/menu.1")"
	logged '^dmenu -fn IBM Plex Mono:size=10 -nb #24232e -nf #dcd6ca -sb #9db8e3 -sf #24232e -i -p Pick:$'
	"$VT_KSH" "$theme" day >/dev/null
	printf 'a\n' | "$dm" -sb '#000000' -l 3
	logged '^dmenu -fn IBM Plex Mono:size=10 -nb #f5f1e8 -nf #383642 -sb #3c639c -sf #f5f1e8 -sb #000000 -l 3$'
	: | "$dm" && fail "Escape must exit 1, as dmenu does"
	return 0
}
t_dmenu_wrap_wal() {
	dm_setup
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*background:        #202020\n*.foreground:       #eeeeee\n*.background:       #101010\n*.color4: #4488cc\n*color4:  #4488cc\n' \
		>"$XDG_CACHE_HOME/wal/colors.Xresources"
	echo wal >"$XDG_CACHE_HOME/theme"
	: | "$dm"
	logged '^dmenu -fn IBM Plex Mono:size=10 -nb #101010 -nf #eeeeee -sb #4488cc -sf #101010$'
}
t_dmenu_wrap_no_theme() {
	dm_setup
	: | "$dm" -l 5
	logged '^dmenu -fn IBM Plex Mono:size=10 -l 5$'
	# By full path: through PATH it would find itself.
	grep -q '^exec /usr/local/bin/dmenu ' "$REPO/.local/bin/wrap/dmenu" ||
		fail "the wrapper must run the package's dmenu by its full path"
}
