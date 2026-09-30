# The Mac's desktop: theme's Darwin branch, the bar (sketchybar/), the
# window manager's keys (aerospace/), Caps Lock (karabiner/) and Ghostty.
# uname, defaults, osascript and sketchybar are generic mocks in $T/bin;
# th_setup and count are in desktop.sh.

# mac_setup [dark]: a Mac, light, or dark with "dark".
mac_setup() {
	th_setup
	for c in uname defaults osascript sketchybar; do ln -s "$VT_MOCKS/_log" "$T/bin/$c"; done
	echo Darwin >"$VT_STATE/out.uname"
	if [ "$1" = dark ]; then echo Dark >"$VT_STATE/out.defaults"
	else echo 1 >"$VT_STATE/rc.defaults"; fi
}
# pal NAME KEY: a colour of the palette x11/themes/NAME.
pal() { sed -n "s/^\*\.$2: //p" "$REPO/.config/x11/themes/$1"; }

t_darwin_desktop_theme_auto() {
	mac_setup dark
	"$VT_KSH" "$theme" auto || fail "theme auto failed"
	eq "state" night "$(cat "$XDG_CACHE_HOME/theme")"
	notlogged '^osascript'
	notlogged '^xrdb'
	# Ghostty's two themes, from the palettes: 16 colours, text, cursor.
	for p in day night; do
		g=$XDG_CONFIG_HOME/ghostty/themes/vertrice-$p
		[ -f "$g" ] || fail "no Ghostty theme $p"
		eq "$p palette" 16 "$(grep -c '^palette = [0-9]*=#' "$g")"
		has "$p colour 4" "palette = 4=$(pal "$p" color4)" "$(cat "$g")"
		has "$p background" "background = $(pal "$p" background)" "$(cat "$g")"
		has "$p foreground" "foreground = $(pal "$p" foreground)" "$(cat "$g")"
		has "$p cursor" "cursor-color = $(pal "$p" cursorColor)" "$(cat "$g")"
		eq "$p lines" 20 "$(wc -l <"$g" | tr -d ' ')"
	done
	bg=$(pal night background) fg=$(pal night foreground)
	logged "^sketchybar --bar color=0xff${bg#\#} --set /\.\*/ label.color=0xff${fg#\#}\$"
	# No terminal is sent colours (Ghostty switches itself), and nothing
	# of the X desktop is written.
	for t in p3 q1; do eq "tty$t untouched" 0 "$(wc -c <"$T/dev/tty$t" | tr -d ' ')"; done
	[ -e "$XDG_CONFIG_HOME/dunst" ] && fail "dunst written on the Mac"
	[ -e "$XDG_CONFIG_HOME/gtk-3.0" ] && fail "GTK written on the Mac"
	echo 1 >"$VT_STATE/rc.defaults"; rm "$VT_STATE/out.defaults"
	"$VT_KSH" "$theme" auto
	eq "light: day" day "$(cat "$XDG_CACHE_HOME/theme")"
	logged "^sketchybar --bar color=0xff$(pal day background | tr -d '#') "
}

# day, night and toggle set macOS's appearance, only when it changes.
t_darwin_desktop_theme_set() {
	mac_setup
	"$VT_KSH" "$theme" day
	notlogged '^osascript'
	eq "day" day "$(cat "$XDG_CACHE_HOME/theme")"
	"$VT_KSH" "$theme" night
	logged '^osascript -e tell application "System Events" to tell appearance preferences to set dark mode to true$'
	eq "night" night "$(cat "$XDG_CACHE_HOME/theme")"
	: >"$VT_STATE/log"
	echo Dark >"$VT_STATE/out.defaults"; rm "$VT_STATE/rc.defaults"
	"$VT_KSH" "$theme" toggle
	logged 'set dark mode to false$'
	eq "toggle from dark" day "$(cat "$XDG_CACHE_HOME/theme")"
}

t_darwin_desktop_theme_clock() {
	mac_setup
	"$VT_KSH" "$theme" clock || fail "clock must leave quietly"
	[ -e "$XDG_CACHE_HOME/theme" ] && fail "clock wrote the state"
	notlogged '^(osascript|sketchybar)'
	"$VT_KSH" "$theme" wal 2>/dev/null; eq "wal: X only" 1 "$?"
}

# Ghostty's theme names are the files theme writes.
t_darwin_desktop_ghostty() {
	mac_setup
	"$VT_KSH" "$theme" auto
	c=$REPO/.config/ghostty/config
	eq "theme line" "theme = light:vertrice-day,dark:vertrice-night" "$(grep '^theme' "$c")"
	for p in day night; do
		[ -f "$XDG_CONFIG_HOME/ghostty/themes/vertrice-$p" ] || fail "no theme file for $p"
	done
	eq "font as xterm's" "font-family = IBM Plex Mono" "$(grep '^font-family' "$c")"
}

# block turns SketchyBar's clicks and scrolls into $BLOCK_BUTTON, as
# dwmblocks sets it, and hides an item whose block prints nothing.
t_darwin_desktop_block() {
	ln -s "$VT_MOCKS/_log" "$T/bin/sketchybar"
	printf '#!/bin/sh\necho "b$BLOCK_BUTTON"\necho second\n' >"$T/bin/sb-fake"
	printf '#!/bin/sh\necho\n' >"$T/bin/sb-empty"
	chmod +x "$T/bin/sb-fake" "$T/bin/sb-empty"
	blk=$REPO/.config/sketchybar/block
	[ -x "$blk" ] || fail "block is not executable"
	for c in routine:::b mouse.clicked:left:none:b1 mouse.clicked:left:shift:b6 \
	    mouse.clicked:left:shift,cmd:b6 mouse.clicked:right:none:b3 \
	    mouse.clicked:other:none:b2 mouse.scrolled:::b5; do
		IFS=: read -r s b m want <<EOF
$c
EOF
		: >"$VT_STATE/log"
		NAME=sb-fake SENDER=$s BUTTON=$b MODIFIER=$m "$VT_SH" "$blk"
		eq "$c" "sketchybar --set sb-fake drawing=on label=$want" "$(cat "$VT_STATE/log")"
	done
	: >"$VT_STATE/log"
	NAME=sb-fake SENDER=mouse.scrolled SCROLL_DELTA=3 "$VT_SH" "$blk"
	logged 'label=b4$'
	: >"$VT_STATE/log"
	NAME=sb-empty SENDER=routine "$VT_SH" "$blk"
	eq "empty: hidden" "sketchybar --set sb-empty drawing=off" "$(cat "$VT_STATE/log")"
}

# The bar: along the bottom, as tall as the gap aerospace.toml leaves;
# sbar's blocks in sbar's order, each drawn by block.
t_darwin_desktop_bar() {
	ln -s "$VT_MOCKS/_log" "$T/bin/sketchybar"
	CONFIG_DIR=$REPO/.config/sketchybar "$VT_SH" "$REPO/.config/sketchybar/sketchybarrc" ||
		fail "sketchybarrc failed"
	gap=$(sed -n 's/^gaps\.outer\.bottom = \([0-9]*\).*/\1/p' "$REPO/.config/aerospace/aerospace.toml")
	[ -n "$gap" ] || fail "aerospace.toml leaves no gap"
	logged "^sketchybar --bar position=bottom height=$gap "
	want=$(sed -n 's/^blocks="\(.*\)"$/\1/p' "$REPO/.local/bin/statusbar/sbar")
	# Right-hand items are added right to left.
	got=$(sed -n 's/^sketchybar --add item \(sb-[a-z]*\) right .*/\1/p' "$VT_STATE/log" |
		awk '{ l = $0 " " l } END { sub(/ $/, "", l); print l }')
	eq "sbar's blocks" "$want" "$got"
	for b in $got; do
		logged "^sketchybar --add item $b right --set $b script=$REPO/.config/sketchybar/block update_freq=5 --subscribe $b mouse.clicked mouse.scrolled\$"
		[ -x "$REPO/.local/bin/statusbar/$b" ] || fail "no block $b"
	done
	logged '^sketchybar --add event appearance AppleInterfaceThemeChangedNotification .* script=theme auto '
	logged '^sketchybar --update$'
}

# aerospace.toml: Super is cmd-alt-ctrl, as karabiner.json makes Caps
# Lock; each key once; none of macOS's diagnostics keys; each command one
# AeroSpace has; each script run by name one this repository has.
t_darwin_desktop_keys() {
	a=$REPO/.config/aerospace/aerospace.toml
	if command -v python3 >/dev/null 2>&1; then
		python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$a" ||
			fail "aerospace.toml is not TOML"
	fi
	keys=$(sed -n '/^\[mode\.main\.binding\]$/,$s/^\([a-z][A-Za-z0-9-]*\) = .*/\1/p' "$a")
	[ "$(echo $keys | wc -w)" -gt 60 ] || fail "too few bindings found"
	eq "every binding on Super" "" "$(printf '%s\n' "$keys" | grep -v '^cmd-alt-ctrl-')"
	eq "each key once" "" "$(printf '%s\n' "$keys" | sort | uniq -d)"
	for k in period comma w; do
		hasnt "Hyper+$k is macOS's" " cmd-alt-ctrl-shift-$k " " $(echo $keys) "
	done
	# The keys AeroSpace knows (its default config lists them).
	for k in $keys; do
		k=${k#cmd-alt-ctrl-}; k=${k#shift-}
		case $k in
		[a-z0-9]|f[1-9]|f1[0-2]|minus|equal|period|comma|backslash|semicolon|backtick|leftSquareBracket|rightSquareBracket|space|enter|backspace|tab|pageUp|pageDown) ;;
		*) fail "unknown key $k" ;;
		esac
	done
	sed -n "s/^cmd-[^=]* = '*\([a-z-]*\).*/\1/p" "$a" | sort -u | while read -r c; do
		case $c in
		close|exec-and-forget|focus|fullscreen|layout|move|move-node-to-workspace|reload-config|resize|volume|workspace|workspace-back-and-forth) ;;
		*) fail "not an AeroSpace command: $c" ;;
		esac
	done
	for s in $(sed -n 's/.*aerospace\/run \([a-z][a-z-]*\).*/\1/p' "$a" | sort -u); do
		case $s in mpc|sketchybar) continue ;; esac
		[ -f "$REPO/.local/bin/$s" ] || [ -f "$REPO/.local/bin/statusbar/$s" ] ||
			fail "run names $s, which is not in .local/bin"
	done
	[ -x "$REPO/.config/aerospace/run" ] || fail "run is not executable"
	k=$REPO/.config/karabiner/karabiner.json
	if command -v python3 >/dev/null 2>&1; then
		python3 -m json.tool "$k" >/dev/null || fail "karabiner.json is not JSON"
	fi
	has "Caps Lock held" '"key_code": "left_control",
                                        "modifiers": ["left_command", "left_option"]' "$(cat "$k")"
	has "tapped: Escape" '"to_if_alone": [
                                    { "key_code": "escape" }' "$(cat "$k")"
}

# run: the profile first, so $TERMINAL and the rest are set.
t_darwin_desktop_run() {
	printf 'export TERMINAL=ghostty-term\n' >"$HOME/.profile"
	eq "profile read" "ghostty-term -e x" "$("$VT_SH" "$REPO/.config/aerospace/run" 'echo $TERMINAL -e x')"
	eq "words joined" "a b" "$("$VT_SH" "$REPO/.config/aerospace/run" echo a b)"
}
