# The native wal shim, ~/.local/bin/wal: ImageMagick derives the palette
# that setbg and theme consume. It never touches DISPLAY, so these cases
# run without X; the runner already unsets it.

walsh=$REPO/.local/bin/wal

# The shim needs ImageMagick's convert; the host may not have it.
wal_need_convert() {
	command -v convert >/dev/null 2>&1 ||
		skip "no ImageMagick convert on this host"
}

# wal_col FILE KEY: the value of *.KEY in a colors.Xresources.
wal_col() { sed -n "s/^\\*\\.$2: //p" "$1"; }

# wal_ratio BG FG: WCAG contrast ratio, for the shim's legibility bands.
wal_ratio() {
	awk -v a="$1" -v b="$2" '
	function chan(h, i) {
		h = toupper(h)
		return (index("0123456789ABCDEF", substr(h, i, 1)) - 1) * 16 + \
			index("0123456789ABCDEF", substr(h, i + 1, 1)) - 1
	}
	function lin(c) {
		c = c / 255
		return c <= 0.03928 ? c / 12.92 : exp(2.4 * log((c + 0.055) / 1.055))
	}
	function lum(h) {
		return 0.2126 * lin(chan(h, 2)) + 0.7152 * lin(chan(h, 4)) + \
			0.0722 * lin(chan(h, 6))
	}
	BEGIN {
		x = lum(a); y = lum(b)
		if (x < y) { t = x; x = y; y = t }
		printf "%.4f\n", (x + 0.05) / (y + 0.05)
	}'
}

# wal_at_least BG FG MIN DESC: fail unless the pair reaches MIN:1.
wal_at_least() {
	_r=$(wal_ratio "$1" "$2")
	awk -v r="$_r" -v m="$3" 'BEGIN { exit !(r >= m) }' ||
		fail "$4: contrast $_r is below $3"
}

# wal_between BG FG LO HI DESC: fail unless the pair is within [LO,HI].
wal_between() {
	_r=$(wal_ratio "$1" "$2")
	awk -v r="$_r" -v lo="$3" -v hi="$4" \
		'BEGIN { exit !(r >= lo && r <= hi) }' ||
		fail "$5: contrast $_r is outside [$3,$4]"
}

# wal_chroma HEX: max-min of the channels, 0..255. A lifted background
# colour has almost none; a real accent has plenty.
wal_chroma() {
	awk -v h="$1" 'BEGIN {
		h = toupper(h)
		for (i = 0; i < 3; i++) {
			v[i] = 0
			for (j = 0; j < 2; j++)
				v[i] = v[i] * 16 + index("0123456789ABCDEF", substr(h, 2 + i * 2 + j, 1)) - 1
		}
		mx = v[0]; mn = v[0]
		for (i = 1; i < 3; i++) {
			if (v[i] > mx) mx = v[i]
			if (v[i] < mn) mn = v[i]
		}
		print mx - mn
	}'
}

t_wal_usage() {
	"$VT_SH" "$walsh" 2>"$T/err"; rc=$?
	eq "no arguments: status" 2 "$rc"
	has "no arguments: usage" "usage: wal [-n] -i IMAGE [-o POSTRUN]" "$(cat "$T/err")"
	"$VT_SH" "$walsh" -x 2>"$T/err"; rc=$?
	eq "unknown option: status" 2 "$rc"
	"$VT_SH" "$walsh" -n 2>"$T/err"; rc=$?
	eq "no image: status" 2 "$rc"
	[ ! -e "$XDG_CACHE_HOME/wal/colors.Xresources" ] ||
		fail "usage wrote a palette"
	return 0
}

t_wal_unreadable() {
	wal_need_convert
	"$VT_SH" "$walsh" -n -i "$T/missing.png" 2>"$T/err"; rc=$?
	eq "missing image: status" 1 "$rc"
	has "missing image: message" "cannot read image: $T/missing.png" "$(cat "$T/err")"
	cp "$REPO/.local/share/vertrice/KEYS.png" "$T/secret.png"
	chmod 000 "$T/secret.png"
	if [ ! -r "$T/secret.png" ]; then	# as root the bit proves nothing
		"$VT_SH" "$walsh" -n -i "$T/secret.png" 2>"$T/err"; rc=$?
		eq "unreadable image: status" 1 "$rc"
		has "unreadable image: message" "cannot read image: $T/secret.png" \
			"$(cat "$T/err")"
	fi
	chmod 600 "$T/secret.png"
	[ ! -e "$XDG_CACHE_HOME/wal/colors.Xresources" ] ||
		fail "a rejected image wrote a palette"
	return 0
}

t_wal_few_colours() {
	wal_need_convert
	convert -size 64x64 xc:'#336699' "$T/solid.png" ||
		fail "convert cannot make a solid image"
	"$VT_SH" "$walsh" -n -i "$T/solid.png" 2>"$T/err"; rc=$?
	eq "solid image: status" 1 "$rc"
	grep -Eq 'only [0-5] distinct colours in' "$T/err" ||
		fail "expected a sparse-colour error: $(cat "$T/err")"
	[ ! -e "$XDG_CACHE_HOME/wal/colors.Xresources" ] ||
		fail "a sparse image wrote a palette"
	return 0
}

t_wal_palette() {
	wal_need_convert
	pal=$XDG_CACHE_HOME/wal/colors.Xresources
	"$VT_SH" "$walsh" -n -i "$REPO/.local/share/vertrice/KEYS.png" ||
		fail "wal on KEYS.png failed"
	eq "19 keys" 19 "$(wc -l <"$pal" | tr -d ' ')"
	awk -F': ' '
		BEGIN {
			split("background foreground cursorColor color0 color1 " \
				"color2 color3 color4 color5 color6 color7 color8 " \
				"color9 color10 color11 color12 color13 color14 " \
				"color15", k, " ")
			for (i in k) want[k[i]] = 1
		}
		{
			key = $1; sub(/^\*\./, "", key)
			if (!(key in want) || seen[key]++ || NF != 2 ||
			    $2 !~ /^#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]$/)
				bad = 1
		}
		END {
			for (key in want) if (seen[key] != 1) bad = 1
			exit bad
		}' "$pal" || fail "not 19 #rrggbb keys with 16 colours"
	bg=$(wal_col "$pal" background) fg=$(wal_col "$pal" foreground)
	wal_at_least "$bg" "$fg" 9 "foreground on background"
	for k in 1 2 3 4 5 6 9 10 11 12 13 14; do
		wal_at_least "$bg" "$(wal_col "$pal" "color$k")" 3 "color$k on background"
	done
	wal_between "$bg" "$(wal_col "$pal" color8)" 4.5 5.2 "color8 on background"
	# Accents come from image hues, never from a lifted background: a grey
	# here means the background itself was selected and pastelised.
	for k in 1 2 3 4 5 6 9 10 11 12 13 14; do
		c=$(wal_col "$pal" "color$k")
		[ "$(wal_chroma "$c")" -ge 20 ] ||
			fail "color$k $c is a lifted grey, not an accent"
	done
	# The same image twice: byte-identical colours.
	cp "$pal" "$T/first.xresources"
	rm -rf "$XDG_CACHE_HOME/wal"
	"$VT_SH" "$walsh" -n -i "$REPO/.local/share/vertrice/KEYS.png" ||
		fail "second wal run failed"
	eq "deterministic colours" "$(cat "$T/first.xresources")" "$(cat "$pal")"
	return 0
}

t_wal_templates() {
	wal_need_convert
	mkdir -p "$XDG_CONFIG_HOME/wal"
	ln -s "$REPO/.config/wal/templates" "$XDG_CONFIG_HOME/wal/templates"
	"$VT_SH" "$walsh" -n -i "$REPO/.local/share/vertrice/KEYS.png" ||
		fail "wal failed"
	pal=$XDG_CACHE_HOME/wal/colors.Xresources
	bg=$(wal_col "$pal" background) c0=$(wal_col "$pal" color0)
	c8=$(wal_col "$pal" color8)
	for f in dunstrc zathurarc; do
		out=$XDG_CACHE_HOME/wal/$f
		[ -f "$out" ] || fail "no rendered $f"
		eq "$f placeholders" "" "$(grep -Eo '\{[A-Za-z0-9]+\}' "$out" || :)"
		[ "$(grep -c -F "$bg" "$out")" -ge 1 ] ||
			fail "$f does not use the palette background"
	done
	# The repository's own templates, with colour0 on the reading surfaces.
	has "dunst normal fg" "foreground = \"$c0\"" \
		"$(cat "$XDG_CACHE_HOME/wal/dunstrc")"
	has "dunst critical frame" "frame_color = \"$c0\"" \
		"$(cat "$XDG_CACHE_HOME/wal/dunstrc")"
	has "dunst low fg" "foreground = \"$c8\"" \
		"$(cat "$XDG_CACHE_HOME/wal/dunstrc")"
	has "zathura completion fg" "set completion-fg                  \"$c0\"" \
		"$(cat "$XDG_CACHE_HOME/wal/zathurarc")"
	has "zathura completion highlight fg" \
		"set completion-highlight-fg        \"$c0\"" \
		"$(cat "$XDG_CACHE_HOME/wal/zathurarc")"
	return 0
}

t_wal_postrun() {
	wal_need_convert
	printf '#!/bin/sh\n: >"%s/postrun-plain"\n' "$T" >"$T/post.sh"
	"$VT_SH" "$walsh" -n -i "$REPO/.local/share/vertrice/KEYS.png" \
		-o "$T/post.sh" || fail "wal with a plain postrun failed"
	[ -f "$T/postrun-plain" ] || fail "a non-executable postrun did not run"
	printf '#!/bin/sh\n: >"%s/postrun-exec"\n' "$T" >"$T/postx.sh"
	chmod +x "$T/postx.sh"
	"$VT_SH" "$walsh" -n -i "$REPO/.local/share/vertrice/KEYS.png" \
		-o "$T/postx.sh" || fail "wal with an executable postrun failed"
	[ -f "$T/postrun-exec" ] || fail "an executable postrun did not run"
	# A palette written but not applied is a failure: setbg falls back.
	printf '#!/bin/sh\nexit 1\n' >"$T/postfail.sh"
	pal=$XDG_CACHE_HOME/wal/colors.Xresources
	rm -f "$pal"
	"$VT_SH" "$walsh" -n -i "$REPO/.local/share/vertrice/KEYS.png" \
		-o "$T/postfail.sh" 2>"$T/err"; rc=$?
	eq "failing postrun: status" 1 "$rc"
	has "failing postrun: message" "postrun failed: $T/postfail.sh" "$(cat "$T/err")"
	[ -f "$pal" ] || fail "a failing postrun left no palette"
	return 0
}

t_wal_two_images() {
	wal_need_convert
	convert -size 120x120 gradient:'#102030-#e0d0c0' "$T/gradient.png" ||
		fail "convert cannot make a gradient image"
	pal=$XDG_CACHE_HOME/wal/colors.Xresources
	"$VT_SH" "$walsh" -n -i "$REPO/.local/share/vertrice/KEYS.png" ||
		fail "wal on KEYS.png failed"
	first=$(wal_col "$pal" background)
	rm -rf "$XDG_CACHE_HOME/wal"
	"$VT_SH" "$walsh" -n -i "$T/gradient.png" ||
		fail "wal on the gradient failed"
	second=$(wal_col "$pal" background)
	[ "$first" != "$second" ] ||
		fail "two different images gave the same background $first"
	return 0
}
