# Login reuses the selected wallpaper without changing its link or needing dwm.
t_wallpaper_login_existing() {
	mkdir -p "$XDG_DATA_HOME"
	: >"$XDG_DATA_HOME/wallpaper.jpg"
	ln -s wallpaper.jpg "$XDG_DATA_HOME/bg"
	ln -s "$VT_MOCKS/_log" "$T/bin/xwallpaper"
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/pgrep"
	chmod +x "$T/bin/pgrep"
	out=$("$VT_SH" "$REPO/.local/bin/setbg" 2>&1) || fail "login wallpaper failed: $out"
	eq "no login warnings" "" "$out"
	eq "selected link unchanged" wallpaper.jpg "$(readlink "$XDG_DATA_HOME/bg")"
	logged "^xwallpaper --zoom $XDG_DATA_HOME/bg$"
}

wallpaper_setup() {
	mkdir -p "$XDG_DATA_HOME/vertrice"
	cp "$REPO/.local/share/vertrice/KEYS.png" "$XDG_DATA_HOME/vertrice/KEYS.png"
	ln -s "$VT_MOCKS/_log" "$T/bin/xwallpaper"
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/pgrep"
	chmod +x "$T/bin/pgrep"
}

t_wallpaper_openbsd_default() {
	wallpaper_setup
	"$VT_SH" "$REPO/.local/bin/setbg" || fail 'default wallpaper failed'
	logged "^xwallpaper --maximize $XDG_DATA_HOME/vertrice/KEYS.png$"
	[ ! -e "$XDG_DATA_HOME/bg" ] || fail 'default became a saved user choice'
}

t_wallpaper_selected_guide() {
	wallpaper_setup
	ln -s vertrice/KEYS.png "$XDG_DATA_HOME/bg"
	"$VT_SH" "$REPO/.local/bin/setbg" || fail 'selected guide failed'
	logged "^xwallpaper --maximize $XDG_DATA_HOME/bg$"
	eq 'guide choice preserved' vertrice/KEYS.png "$(readlink "$XDG_DATA_HOME/bg")"
}

t_wallpaper_mac_default() {
	wallpaper_setup
	printf '#!/bin/sh\necho Darwin\n' >"$T/bin/uname"
	chmod +x "$T/bin/uname"
	: >"$XDG_DATA_HOME/thiemeyer_road_to_samarkand.jpg"
	"$VT_SH" "$REPO/.local/bin/setbg" || fail 'Mac default failed'
	logged "^xwallpaper --zoom $XDG_DATA_HOME/thiemeyer_road_to_samarkand.jpg$"
}

t_wallpaper_guide_source() {
	guide=$REPO/.local/share/vertrice/KEYS.svg
	for key in $(sed -n 's/.*data-bind="\([^"]*\)".*/\1/p' "$guide"); do
		grep -Eq "^bind-key[[:space:]]+$key[[:space:]]" "$REPO/.config/cwm/cwmrc" || fail "guide key missing: $key"
	done
	grep -Fq 'ipe-pi FILE' "$guide" || fail 'no writing entry'
	grep -Fq ':w   explicitly save' "$guide" || fail 'no explicit save reminder'
	eq 'PNG signature' '137 80 78 71 13 10 26 10' \
		"$(od -An -tu1 -N8 "$REPO/.local/share/vertrice/KEYS.png" | xargs)"
	eq '1920x1080 PNG dimensions' '0 0 7 128 0 0 4 56' \
		"$(od -An -tu1 -j16 -N8 "$REPO/.local/share/vertrice/KEYS.png" | xargs)"
}
