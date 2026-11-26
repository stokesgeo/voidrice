# theme's dunst, zathura and GTK colours, the native wal shim opt-in, and
# setbg's fallback when the palette cannot be made or applied.
# th_setup and count are in desktop.sh.

t_palette_day_text_contrast() {
	command -v python3 >/dev/null 2>&1 || skip "no python3"
	python3 - "$REPO/.config/x11/themes/day" <<'PY'
from pathlib import Path
import sys

palette = dict(line.split(': ', 1) for line in Path(sys.argv[1]).read_text().splitlines()
               if ': ' in line)

def luminance(value):
    channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return sum((c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4) * weight
               for c, weight in zip(channels, (.2126, .7152, .0722)))

background = luminance(palette['*.background'])
for key in ['*.foreground'] + ['*.color' + str(i) for i in range(16)]:
    low, high = sorted((background, luminance(palette[key])))
    assert (high + .05) / (low + .05) >= 4.5, key
PY
}

t_palette_xterm_colors() {
	has 'native direct-color terminal type' 'XTerm*termName: xterm-direct' \
		"$(cat "$REPO/.config/x11/xresources")"
	if command -v infocmp >/dev/null 2>&1; then
		infocmp xterm-direct >/dev/null || fail 'missing xterm-direct terminal definition'
	fi
}

t_palette_apply_failure() {
	th_setup
	printf 'night\n' >"$XDG_CACHE_HOME/theme"
	printf '1\n' >"$VT_STATE/rc.xrdb"
	DISPLAY=:0 "$VT_KSH" "$theme" day >"$T/out" 2>"$T/err" &&
		fail "failed X resource merge accepted"
	eq "state unchanged" night "$(cat "$XDG_CACHE_HOME/theme")"
	eq "no terminal recolor" 0 "$(wc -c <"$T/dev/ttyp3" | tr -d ' ')"
	[ ! -e "$XDG_CONFIG_HOME/gtk-3.0/settings.ini" ] || fail "GTK changed after failure"
	notlogged '^dunstctl'
}

t_palette_toggle_failure() {
	th_setup
	printf 'day\n' >"$XDG_CACHE_HOME/theme"
	# Fail the requested night merge only: falling back to day would hide it.
	cat >"$T/bin/xrdb" <<'EOF'
#!/bin/sh
printf 'xrdb %s\n' "$*" >>"$VT_STATE/log"
case $2 in */night) exit 1 ;; esac
EOF
	chmod +x "$T/bin/xrdb"
	DISPLAY=:0 "$VT_KSH" "$theme" toggle >"$T/out" 2>"$T/err" &&
		fail "toggle hid failed night merge"
	eq "state unchanged" day "$(cat "$XDG_CACHE_HOME/theme")"
	notlogged '^xrdb .*day|^dunstctl'
	eq "no terminal recolor" 0 "$(wc -c <"$T/dev/ttyp3" | tr -d ' ')"
}

t_palette_scrollbar_failure() {
	th_setup
	printf 'night\n' >"$XDG_CACHE_HOME/theme"
	# The scheme merge succeeds, but the following scrollbar merge fails.
	cat >"$T/bin/xrdb" <<'EOF'
#!/bin/sh
[ "$#" -eq 2 ]
EOF
	chmod +x "$T/bin/xrdb"
	DISPLAY=:0 "$VT_KSH" "$theme" day >"$T/out" 2>"$T/err" &&
		fail "failed scrollbar merge accepted"
	eq "state unchanged" night "$(cat "$XDG_CACHE_HOME/theme")"
	eq "no terminal recolor" 0 "$(wc -c <"$T/dev/ttyp3" | tr -d ' ')"
	[ ! -e "$XDG_CONFIG_HOME/gtk-3.0/settings.ini" ] || fail "GTK changed after failure"
	notlogged '^dunstctl'
}

t_palette_clock_retries_failure() {
	th_setup
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/pgrep"
	cat >"$T/bin/xrdb" <<'EOF'
#!/bin/sh
case $1 in
-query)
	count=$(cat "$VT_STATE/queries" 2>/dev/null || echo 0)
	count=$((count + 1))
	echo "$count" >"$VT_STATE/queries"
	[ "$count" -le 2 ] ;;
-merge)
	echo "merge $*" >>"$VT_STATE/log"
	if [ ! -e "$VT_STATE/failed" ]; then
		touch "$VT_STATE/failed"
		exit 1
	fi ;;
esac
EOF
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/sleep"
	chmod +x "$T/bin/pgrep" "$T/bin/xrdb" "$T/bin/sleep"
	DISPLAY=:0 "$VT_KSH" "$theme" clock || fail "clock failed"
	[ -s "$XDG_CACHE_HOME/theme" ] || fail "clock did not retry failed application"
	eq "terminal recolored on retry" 1 "$(count ']11;' "$T/dev/ttyp3")"
}

t_palette_missing_scheme() {
	th_setup
	printf 'night\n' >"$XDG_CACHE_HOME/theme"
	mkdir -p "$T/empty"
	sed "s|dir=\$conf/x11/themes|dir=$T/empty|" "$theme" >"$T/missing-theme"
	"$VT_KSH" "$T/missing-theme" day >"$T/out" 2>"$T/err" &&
		fail "missing scheme accepted"
	eq "state unchanged" night "$(cat "$XDG_CACHE_HOME/theme")"
	eq "no terminal recolor" 0 "$(wc -c <"$T/dev/ttyp3" | tr -d ' ')"
	notlogged '^xrdb|^dunstctl'
}

t_palette_switch() {
	th_setup
	DISPLAY=:0 "$VT_KSH" "$theme" day || fail "theme day failed"
	has "dunst" 'background = "#f5f1e8"' "$(cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf")"
	has "zathura" 'set default-bg "#f5f1e8"' "$(cat "$XDG_CONFIG_HOME/zathura/theme")"
	logged '^dunstctl reload$'
	DISPLAY=:0 "$VT_KSH" "$theme" toggle
	has "dunst night" 'background = "#17161d"' "$(cat "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf")"
	has "zathura night" 'set default-bg "#17161d"' "$(cat "$XDG_CONFIG_HOME/zathura/theme")"
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

# GTK follows day, night and wal: theme writes settings.ini and gtk.css
# whole, so the dotfiles need not track them.
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
		has "$p css scrollbar" "scrollbar, scrollbar trough { background-color: $bg; }" "$(cat "$css")"
		has "$p css slider" "scrollbar slider { background-color: $ac; }" "$(cat "$css")"
		hasnt "$p css no heredoc tabs" "	" "$(cat "$css")"
	done
	eq "not tracked" "" "$(git -C "$REPO" ls-files .config/gtk-3.0)"
	# wal themes GTK too: Adwaita-dark in the wallpaper's colours.
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*.foreground: #e0e0e0\n*.background: #101010\n*.color4: #4488cc\n' \
		>"$XDG_CACHE_HOME/wal/colors.Xresources"
	: >"$XDG_CACHE_HOME/wal/dunstrc"; : >"$XDG_CACHE_HOME/wal/zathurarc"
	"$VT_KSH" "$theme" day; "$VT_KSH" "$theme" wal || fail "theme wal failed"
	eq "wal" "gtk-theme-name=Adwaita-dark" "$(grep '^gtk-theme-name=' "$ini")"
	has "wal css bg" "@define-color theme_bg_color #101010;" "$(cat "$css")"
	has "wal css fg" "@define-color theme_fg_color #e0e0e0;" "$(cat "$css")"
	has "wal css accent" "@define-color theme_selected_bg_color #4488cc;" "$(cat "$css")"
	has "wal css views" "entry { color: #e0e0e0; background-color: #101010; }" \
		"$(cat "$css")"
	rm "$ini"; "$VT_KSH" "$theme" wal || fail "theme wal (no settings.ini) failed"
	eq "wal writes settings.ini" "gtk-theme-name=Adwaita-dark" \
		"$(grep '^gtk-theme-name=' "$ini")"
	return 0
}

t_palette_wal() {
	th_setup
	for cmd in xwallpaper xrdb dunstctl; do
		ln -s "$VT_MOCKS/_log" "$T/bin/$cmd" || fail "cannot mock $cmd"
	done
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/pgrep"
	chmod +x "$T/bin/pgrep"
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

# A cache theme cannot use is a failure, not a half-applied scheme: no
# xrdb merge, no dunst or zathura copy, no GTK, no state, and exit 1.
t_palette_wal_incomplete() {
	th_setup
	ini=$XDG_CONFIG_HOME/gtk-3.0/settings.ini
	css=$XDG_CONFIG_HOME/gtk-3.0/gtk.css
	d=$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf
	z=$XDG_CONFIG_HOME/zathura/theme
	"$VT_KSH" "$theme" day || fail "theme day failed"
	cp "$ini" "$T/ini.before"; cp "$css" "$T/css.before"
	cp "$d" "$T/dunst.before"; cp "$z" "$T/zathura.before"
	rm -f "$XDG_CACHE_HOME/theme"
	: >"$T/dev/ttyp3"; : >"$VT_STATE/log"
	DISPLAY=:0 "$VT_KSH" "$theme" wal 2>"$T/err"; rc=$?
	eq "no cache: status" 1 "$rc"
	has "no cache: message" \
		"theme: missing $XDG_CACHE_HOME/wal/colors.Xresources; run setbg with PALETTE=wal" \
		"$(cat "$T/err")"
	[ -e "$XDG_CACHE_HOME/theme" ] && fail "no cache: state written"
	notlogged '^xrdb|^dunstctl'
	eq "no cache: no OSC" 0 "$(wc -c <"$T/dev/ttyp3" | tr -d ' ')"
	eq "no cache: dunst untouched" "$(cat "$T/dunst.before")" "$(cat "$d")"
	eq "no cache: zathura untouched" "$(cat "$T/zathura.before")" "$(cat "$z")"
	eq "no cache: gtk.css untouched" "$(cat "$T/css.before")" "$(cat "$css")"
	eq "no cache: settings.ini untouched" "$(cat "$T/ini.before")" "$(cat "$ini")"
	# A cache without the rendered templates is incomplete in the same way.
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*.foreground: #e0e0e0\n*.background: #101010\n' \
		>"$XDG_CACHE_HOME/wal/colors.Xresources"
	DISPLAY=:0 "$VT_KSH" "$theme" wal 2>"$T/err"; rc=$?
	eq "no dunstrc: status" 1 "$rc"
	has "no dunstrc: message" "theme: missing $XDG_CACHE_HOME/wal/dunstrc" \
		"$(cat "$T/err")"
	[ -e "$XDG_CACHE_HOME/theme" ] && fail "no dunstrc: state written"
	notlogged '^xrdb|^dunstctl'
	return 0
}

# The wallpaper sets the colours: toggle and auto leave them alone while
# PALETTE=wal; an explicit day or night still applies.
t_palette_wal_toggle() {
	th_setup
	mkdir -p "$XDG_CACHE_HOME/wal"
	printf '*.foreground: #e0e0e0\n*.background: #101010\n*.color4: #4488cc\n' \
		>"$XDG_CACHE_HOME/wal/colors.Xresources"
	echo wal >"$XDG_CACHE_HOME/theme"
	: >"$T/dev/ttyp3"; : >"$VT_STATE/log"
	for w in toggle auto; do
		PALETTE=wal DISPLAY=:0 "$VT_KSH" "$theme" "$w" || fail "theme $w failed"
		eq "$w: state" wal "$(cat "$XDG_CACHE_HOME/theme")"
	done
	notlogged '^xrdb|^dunstctl'
	eq "no-op: no OSC" 0 "$(wc -c <"$T/dev/ttyp3" | tr -d ' ')"
	[ -e "$XDG_CONFIG_HOME/dunst/dunstrc.d/theme.conf" ] &&
		fail "toggle/auto wrote dunst under wal"
	PALETTE=wal DISPLAY=:0 "$VT_KSH" "$theme" day || fail "theme day failed"
	eq "day still applies" day "$(cat "$XDG_CACHE_HOME/theme")"
	logged '^xrdb -merge '
	return 0
}

# setbg resolves its argument before anything else: a path that does not
# exist is an error, never the saved wallpaper again.
t_palette_setbg_missing() {
	th_setup
	mkdir -p "$XDG_DATA_HOME"
	: >"$XDG_DATA_HOME/wall.jpg"
	ln -s wall.jpg "$XDG_DATA_HOME/bg"
	ln -s "$VT_MOCKS/_log" "$T/bin/xwallpaper"
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/pgrep"; chmod +x "$T/bin/pgrep"
	setbg "$T/nonexistent.jpg" 2>"$T/err"; rc=$?
	eq "missing argument: status" 1 "$rc"
	eq "missing argument: link" wall.jpg "$(readlink "$XDG_DATA_HOME/bg")"
	logged '^notify-send 🖼️ Error Not a valid image or directory.$'
	notlogged '^wal |^xwallpaper'
	: >"$VT_STATE/log"
	setbg -s "$T/nonexistent.jpg"; rc=$?
	eq "missing argument, silent: status" 1 "$rc"
	eq "missing argument, silent: link" wall.jpg "$(readlink "$XDG_DATA_HOME/bg")"
	notlogged '^notify-send|^wal |^xwallpaper'
	return 0
}

# A palette that cannot be made is reported and replaced by the clock's
# scheme, with the opt-in cleared (theme auto is a no-op under PALETTE=wal).
t_palette_setbg_wal_fail() {
	th_setup
	mkdir -p "$XDG_DATA_HOME"
	cp "$REPO/.local/share/vertrice/KEYS.png" "$T/wall.png"
	ln -s "$VT_MOCKS/_log" "$T/bin/xwallpaper"
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/pgrep"; chmod +x "$T/bin/pgrep"
	printf '#!/bin/sh\necho "wal $*" >>"$VT_STATE/log"; exit 1\n' >"$T/bin/wal"
	printf '#!/bin/sh\necho "theme PALETTE=[$PALETTE] $*" >>"$VT_STATE/log"\n' \
		>"$T/bin/theme"
	chmod +x "$T/bin/wal" "$T/bin/theme"
	PALETTE=wal setbg "$T/wall.png" || fail "setbg failed"
	logged '^wal -n -i '
	logged '^theme PALETTE=\[\] auto$'
	logged '^notify-send 🖼️ Error Wallpaper palette failed; using the clock scheme.$'
	logged "^xwallpaper --zoom $XDG_DATA_HOME/bg$"
	eq "wallpaper still set" "$T/wall.png" "$(readlink "$XDG_DATA_HOME/bg")"
	: >"$VT_STATE/log"
	PALETTE=wal setbg -s "$T/wall.png" || fail "silent setbg failed"
	logged '^theme PALETTE=\[\] auto$'
	notlogged '^notify-send'
	return 0
}

# The dmenu wrapper (openbsd/dmenu): Plex Mono and the palette theme last set,
# then the caller's own options; the menu, answer and exit status pass
# through. The real dmenu is the mock, by its full path.
dm_setup() {
	th_setup
	dm=$(derived .local/bin/openbsd/dmenu dmenu "s|/usr/local/bin/dmenu|$VT_MOCKS/dmenu|")
}
t_dmenu_wrap_palette() {
	dm_setup
	"$VT_KSH" "$theme" night >/dev/null
	answers b
	out=$(printf 'a\nb\n' | "$dm" -i -p Pick:) || fail "dmenu wrapper failed"
	eq "answer" b "$out"
	eq "menu" "a b" "$(paste -sd ' ' - <"$VT_STATE/menu.1")"
	logged '^dmenu -fn IBM Plex Mono:size=10 -nb #17161d -nf #e8e2d6 -sb #79b8ff -sf #17161d -i -p Pick:$'
	"$VT_KSH" "$theme" day >/dev/null
	printf 'a\n' | "$dm" -sb '#000000' -l 3
	logged '^dmenu -fn IBM Plex Mono:size=10 -nb #f5f1e8 -nf #383642 -sb #1f4fa8 -sf #f5f1e8 -sb #000000 -l 3$'
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
	grep -q '^exec /usr/local/bin/dmenu ' "$REPO/.local/bin/openbsd/dmenu" ||
		fail "the wrapper must run the package's dmenu by its full path"
}
