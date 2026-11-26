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
		"$(od -An -tu1 -N8 "$REPO/.local/share/vertrice/KEYS.png" | awk '{ for (i=1; i<=NF; i++) $i+=0; print }')"
	eq '1920x1080 PNG dimensions' '0 0 7 128 0 0 4 56' \
		"$(od -An -tu1 -j16 -N8 "$REPO/.local/share/vertrice/KEYS.png" | awk '{ for (i=1; i<=NF; i++) $i+=0; print }')"
}

# These labels must describe actions, not merely name an existing key.
t_wallpaper_guide_actions() {
	guide=$REPO/.local/share/vertrice/KEYS.svg
	config=$REPO/.config/cwm/cwmrc
	while IFS='|' read -r key action row label; do
		eq "$key action" "$action" "$(awk -v key="$key" '$1 == "bind-key" && $2 == key { print $3 }' "$config")"
		grep -Eq "y=\"$row\" data-bind=\"([^\"]* )?$key( [^\"]*)?\"" "$guide" || fail "guide row missing: $key"
		grep -Fq "$label</text>" "$guide" || fail "guide label wrong: $key ($label)"
	done <<'EOF'
4-Tab|window-cycle-ingroup|639|<text x="945" y="639">Cycle in group
4-j|window-cycle-ingroup|310|<text x="945" y="310">Cycle in group
4-k|window-rcycle-ingroup|310|<text x="945" y="310">Cycle in group
4-t|window-vtile|357|<text x="945" y="357">Tile vertically
4-space|window-vtile|404|<text x="945" y="404">V-tile / make master
4-1|group-only-1|545|<text x="945" y="545">Show only group
4-0|group-toggle-all|889|<text x="1300" y="889" data-bind="4-0">Super+0         toggle all groups
EOF
	for n in 1 2 3 4 5 6 7 8 9; do
		eq "Ctrl+$n toggles visibility" "group-toggle-$n" \
			"$(awk -v key="4C-$n" '$1 == "bind-key" && $2 == key { print $3 }' "$config")"
	done
}
