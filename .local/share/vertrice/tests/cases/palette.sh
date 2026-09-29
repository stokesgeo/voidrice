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
	# Written from each palette's background and foreground: every line
	# of dunst's three urgencies and zathura's eight settings.
	for p in day night; do
		"$VT_KSH" "$theme" "$p"
		bg=$(sed -n 's/^\*\.background: //p' "$REPO/.config/x11/themes/$p")
		fg=$(sed -n 's/^\*\.foreground: //p' "$REPO/.config/x11/themes/$p")
		d=$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf z=$XDG_CONFIG_HOME/zathura/theme
		eq "$p dunst" "[urgency_low] background = \"$bg\" foreground = \"$fg\" [urgency_normal] background = \"$bg\" foreground = \"$fg\" [urgency_critical] background = \"$bg\" foreground = \"$fg\"" \
			"$(paste -sd ' ' - <"$d" | tr -s ' ')"
		eq "$p zathura" 8 "$(grep -Ec "\"($bg|$fg)\"\$" "$z")"
		eq "$p zathura lines" 8 "$(wc -l <"$z" | tr -d ' ')"
		has "$p zathura recolor" "set recolor-darkcolor \"$fg\"" "$(cat "$z")"
	done
}

# GTK follows day and night: theme writes settings.ini and gtk.css whole,
# so the dotfiles need not track them. wal leaves them, but writes the
# day settings.ini if there is none (and no gtk.css).
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
	# gtk.css: Adwaita in the palette's background, text and accent.
	css=$XDG_CONFIG_HOME/gtk-3.0/gtk.css
	for p in day night; do
		"$VT_KSH" "$theme" "$p"
		bg=$(sed -n 's/^\*\.background: //p' "$REPO/.config/x11/themes/$p")
		fg=$(sed -n 's/^\*\.foreground: //p' "$REPO/.config/x11/themes/$p")
		ac=$(sed -n 's/^\*\.color4: //p' "$REPO/.config/x11/themes/$p")
		has "$p css bg" "@define-color theme_bg_color $bg;" "$(cat "$css")"
		has "$p css fg" "@define-color theme_fg_color $fg;" "$(cat "$css")"
		has "$p css accent" "@define-color theme_selected_bg_color $ac;" "$(cat "$css")"
		has "$p css views" "entry { color: $fg; background-color: $bg; }" "$(cat "$css")"
		has "$p css selection" "*:selected { color: $bg; background-color: $ac; }" "$(cat "$css")"
		hasnt "$p css no heredoc tabs" "	" "$(cat "$css")"
	done
	eq "not tracked" "" "$(git -C "$REPO" ls-files .config/gtk-3.0)"
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*.background: #101010\n' >"$XDG_CACHE_HOME/wal/colors.Xresources"
	: >"$XDG_CACHE_HOME/wal/dunstrc"; : >"$XDG_CACHE_HOME/wal/zathurarc"
	"$VT_KSH" "$theme" night; "$VT_KSH" "$theme" wal
	eq "wal leaves GTK" "gtk-theme-name=Adwaita-dark" "$(grep '^gtk-theme-name=' "$ini")"
	hasnt "wal leaves gtk.css" "#101010" "$(cat "$css")"
	rm "$css"
	rm "$ini"; "$VT_KSH" "$theme" wal
	eq "wal, no file: the day one" "gtk-theme-name=Adwaita" "$(grep '^gtk-theme-name=' "$ini")"
	[ -e "$css" ] && fail "wal must not write gtk.css"
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
