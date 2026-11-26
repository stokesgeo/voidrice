
image_names() {
	printf '%s\n' '-dash.png' '-zlast.png' 'a space.png' "b$(printf '\t')tab.png" \
	    'c*.png' 'c-match.png' 'd[ab]?.png' 'e\name.png' \
	    'f"quote.png' "g'quote.png" 'h;echo bad.png' 'i#hash.png' \
	    'j$HOME.png' 'k`cmd`.png' 'l.png ' 'm.png'
}

image_rotate_setup() {
	mkdir "$T/images"
	{ image_names; printf '%s\n' '.hidden.png'; } | sort >"$T/names"
	while IFS= read -r name; do : >"$T/images/$name"; done <"$T/names"
	cd "$T/images" || fail 'fixture cd'
}

t_image_return_rotdir() {
	image_rotate_setup
	while IFS= read -r name; do
		ROTDIR_TEST_NAME=$name awk '
		    { a[NR]=$0; if ($0 == ENVIRON["ROTDIR_TEST_NAME"]) start=NR }
		    END { for (i=0; i<NR; i++) print a[(start+i-1)%NR+1] }
		' "$T/names" >"$T/want"
		"$VT_SH" "$REPO/.local/bin/rotdir" "$PWD/$name" >"$T/got"
		cmp -s "$T/want" "$T/got" || fail "rotdir changed/split name: $name"
		"$VT_SH" "$REPO/.local/bin/rotdir" "$name" >"$T/got"
		cmp -s "$T/want" "$T/got" || fail "rotdir relative name: $name"
	done <"$T/names"
	"$VT_SH" "$REPO/.local/bin/rotdir" absent.png >"$T/got"
	cmp -s "$T/names" "$T/got" || fail 'absent basename preserves listing'
	rm -f "$T/images/"* "$T/images/.hidden.png"
	"$VT_SH" "$REPO/.local/bin/rotdir" absent.png >"$T/got"
	[ ! -s "$T/got" ] || fail 'empty directory emits no filename'
}

image_return_setup() {
	awk '/image\/\*\) / { sub(/^.*image\/\*\) /, ""); p=1 }
	    p { print } p && /done &/ { print "wait"; exit }' \
	    "$REPO/.config/lf/lfrc" >"$T/return.sh"
	[ -s "$T/return.sh" ] || fail 'image branch extraction'
	printf '%s\n' '#!/bin/sh' 'cat >"$T/viewer-input"' \
	    'cat "$T/marked"' >"$T/bin/nsxiv"
	printf '%s\n' '#!/bin/sh' '[ "$1" = -remote ] || exit 1' \
	    'printf "%s\n" "$2" >>"$T/remote"' >"$T/bin/lf"
	chmod +x "$T/bin/nsxiv" "$T/bin/lf"
	mkdir "$T/images"
	cd "$T/images" || fail 'fixture cd'
	: >plain.png
	: >"$T/remote"
	export f="$PWD/plain.png" id=4242
}

image_return_run() {
	"$VT_KSH" -n "$T/return.sh" || fail 'image branch shell syntax'
	"$VT_SH" -eu -c 'IFS="
"; . "$T/return.sh"'
}

t_image_return_recipient() {
	image_return_setup
	printf '%s\n' plain.png >"$T/marked"
	image_return_run
	[ "$(wc -l <"$T/remote" | tr -d ' ')" = 2 ] || fail 'one select and one toggle'
	awk '$1 != "send" || $2 != 4242 { exit 1 }' "$T/remote" ||
	    fail 'return broadcast instead of originating client'
	eq 'toggle behavior retained' 'send 4242 toggle' "$(tail -n 1 "$T/remote")"
}

t_image_return_paths() {
	image_return_setup
	printf '%s\n' plain.png ./plain.png "$PWD/plain.png" >"$T/marked"
	image_return_run
	printf 'send 4242 select "%s/plain.png"\nsend 4242 toggle\n' "$PWD" >"$T/want"
	printf 'send 4242 select "%s/./plain.png"\nsend 4242 toggle\n' "$PWD" >>"$T/want"
	printf 'send 4242 select "%s/plain.png"\nsend 4242 toggle\n' "$PWD" >>"$T/want"
	cmp -s "$T/want" "$T/remote" || fail 'relative returns must be anchored to viewer cwd; absolute returns retained'
}

t_image_return_glob_mime() {
	image_return_setup
	printf 'P3\n1 1\n255\n255 0 0\n' >'d[ab]?.png'
	printf 'not an image\n' >daa.png
	export f="$PWD/d[ab]?.png"
	awk '/^[[:space:]]*mime=\$\(file / { print; exit }' \
	    "$REPO/.config/lf/lfrc" >"$T/mime.sh"
	printf 'printf "%%s\\n" "$mime"\n' >>"$T/mime.sh"
	mime=$("$VT_SH" -eu -c 'IFS="
"; . "$T/mime.sh"')
	case $mime in image/*) ;; *) fail "literal image glob misclassified: $mime" ;; esac
}

t_image_return_glob_start() {
	image_return_setup
	: >'d[ab]?.png'
	: >daa.png
	export f="$PWD/d[ab]?.png"
	: >"$T/marked"
	image_return_run
	eq 'literal glob filename is the starting image' 'd[ab]?.png' \
	    "$(head -n 1 "$T/viewer-input")"
}

t_image_return_no_marks() {
	image_return_setup
	printf '\n\n' >"$T/marked"
	image_return_run
	[ ! -s "$T/remote" ] || fail 'unmarked viewer must not select or toggle'
}

t_image_return_quoting() {
	image_return_setup
	image_names >"$T/marked"
	printf ' leading.png\ntrailing.png \n\t tabs.png\t\n\n' >>"$T/marked"
	image_return_run
	awk -v dir="$PWD/" 'NF || length {
	    path=dir $0; gsub(/\\/, "\\\\", path); gsub(/"/, "\\\"", path)
	    print "send 4242 select \"" path "\""; print "send 4242 toggle"
	}' "$T/marked" >"$T/want"
	cmp -s "$T/want" "$T/remote" || fail 'filename bytes or lf language quoting changed'
}
