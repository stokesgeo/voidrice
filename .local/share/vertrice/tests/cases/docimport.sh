di() { "$VT_SH" "$REPO/.local/bin/openbsd/docimport" "$@"; }

di_mock() {
	cat >"$T/bin/pandoc" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$T/args"
pwd >"$T/cwd"
printf 'partial\n' >document.md
if [ "${DI_FAIL:-0}" = 1 ]; then
	printf 'fixture conversion failure\n' >&2
	exit 9
fi
EOF
	chmod +x "$T/bin/pandoc"
}

t_docimport_args_literal() {
	di_mock
	name='- draft '\''[x]* café
line.DoCx'
	printf 'original\n' >"$T/$name"
	di "$name" >"$T/path" 2>"$T/err" || fail "literal import"
	out="$T/${name%.*}.import"
	printf '%s\n' "$out/document.md" >"$T/want-path"
	cmp -s "$T/path" "$T/want-path" || fail "literal output path"
	eq "working directory" "$out" "$(cat "$T/cwd")"
	printf '%s\n' --sandbox --from=docx --to=markdown+pipe_tables-simple_tables-multiline_tables-grid_tables-smart \
	    --track-changes=accept --extract-media=media --output=document.md \
	    -- "$T/$name" >"$T/want-args"
	cmp -s "$T/args" "$T/want-args" || fail "explicit Pandoc arguments"
	[ -d "$out/media" ] || fail "no media directory"
	di --review "$name" >"$T/path" 2>"$T/err" || fail "review import"
	grep -qx -- '--track-changes=all' "$T/args" || fail "review not all"
	[ -f "$T/${name%.*}.review/document.md" ] || fail "no review sibling"
	eq "original unchanged" original "$(cat "$T/$name")"
}

t_docimport_refusal_failure() {
	di_mock
	printf 'source\n' >a.docx
	mkdir a.import
	printf 'keep\n' >a.import/keep
	if di a.docx >out 2>err; then fail "overwrote directory"; fi
	eq "existing output retained" keep "$(cat a.import/keep)"
	rm -rf a.import
	ln -s nowhere a.import
	if di a.docx >out 2>err; then fail "accepted dangling symlink"; fi
	[ -L a.import ] || fail "removed existing symlink"
	rm a.import
	export DI_FAIL=1
	if di a.docx >out 2>err; then fail "ignored conversion failure"; fi
	has "visible diagnostic" 'fixture conversion failure' "$(cat err)"
	[ ! -e a.import ] || fail "partial output retained"
	eq "source retained after failure" source "$(cat a.docx)"
	eq "failure prints no output path" '' "$(cat out)"
	unset DI_FAIL
	printf 'odt\n' >a.ODT
	if di --review a.ODT >out 2>err; then fail "accepted ODT review"; fi
	has "ODT review diagnostic" 'DOCX-only' "$(cat err)"
	[ ! -e a.review ] || fail "ODT review created output"
	di a.ODT >out 2>err || fail "ODT default"
	grep -qx -- '--from=odt' "$T/args" || fail "ODT reader"
	for args in '' '--review' 'a.docx a.ODT' '--unknown' 'a.pdf'; do
		if di $args >out 2>err; then fail "accepted invalid args: $args"; fi
	done
}

di_lf_body() {
	sed -n "/^cmd $1 [\$!]{{\$/,/^}}\$/p" "$REPO/.config/lf/lfrc" |
	    sed '1d;$d' >"$T/lf-$1.sh"
	[ -s "$T/lf-$1.sh" ] || fail "missing LF $1"
	"$VT_KSH" -n "$T/lf-$1.sh" || fail "LF $1 syntax"
}

t_docimport_lf() {
	for cmd in open docimport docreview; do di_lf_body "$cmd"; done
	for cmd in docimport docreview; do
		grep -qx "cmd $cmd !{{" "$REPO/.config/lf/lfrc" || fail "LF $cmd not native shell-wait"
	done
	cat >"$T/bin/file" <<'EOF'
#!/bin/sh
printf '%s\n' "$DI_MIME"
EOF
	cat >"$T/bin/uname" <<'EOF'
#!/bin/sh
printf '%s\n' "$DI_OS"
EOF
	cat >"$T/bin/detach" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$T/launched"
EOF
	cat >"$T/bin/docimport" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$T/imported"
EOF
	cat >"$T/bin/lf" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$T/remote"
EOF
	chmod +x "$T/bin/file" "$T/bin/uname" "$T/bin/detach" "$T/bin/docimport" "$T/bin/lf"
	export id=1234 OPENER=generic-opener
	export DI_OS=OpenBSD f="$T/a '\" [x]*.DoCx" fx="$T/other.docx"
	for mime in application/vnd.openxmlformats-officedocument.wordprocessingml.document \
	    application/vnd.oasis.opendocument.text application/octet-stream application/zip; do
		export DI_MIME=$mime
		for suffix in docx odt DoCx ODT; do
			f="$T/a '\" [x]*.$suffix"
			"$VT_SH" -eu "$T/lf-open.sh" >out 2>err || fail "LF OpenBSD open"
			printf '%s\n' -remote "send $id echo 'DOCX/ODT: use :docimport (reading) or :docreview (DOCX annotations); original retained.'" >"$T/want-remote"
			cmp -s "$T/want-remote" "$T/remote" || fail "LF native notice emission"
			rm "$T/remote"
			[ ! -e "$T/launched" ] || fail "LF launched app"
			DI_OS=Darwin "$VT_SH" -eu "$T/lf-open.sh" || fail "LF Darwin open"
			app=libreoffice
			case $mime:$suffix in
			application/octet-stream:DoCx|application/octet-stream:ODT) app=zathura ;;
			application/zip:*) app=generic-opener ;;
			esac
			eq "Darwin preserved" "$(printf '%s\n%s' "$app" "$fx")" "$(cat "$T/launched")"
			rm "$T/launched"
		done
	done
	"$VT_SH" -eu "$T/lf-docimport.sh" || fail "LF docimport"
	eq "focused file only" "$f" "$(cat "$T/imported")"
	"$VT_SH" -eu "$T/lf-docreview.sh" || fail "LF docreview"
	eq "focused review" "$(printf '%s\n%s' --review "$f")" "$(cat "$T/imported")"
	printf '#!/bin/sh\nprintf "localc\\n" >"$T/launched"\n' >"$T/bin/localc"
	chmod +x "$T/bin/localc"
	for spec in 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet localc' \
	    'application/vnd.oasis.opendocument.spreadsheet libreoffice' \
	    'application/octet-stream libreoffice'; do
		DI_MIME=${spec% *}; export DI_MIME
		f="$T/legacy.doc"
		"$VT_SH" -eu "$T/lf-open.sh" || fail "LF office notice"
		printf '%s\n' -remote "send $id echo 'No handler configured for this office format.'" >"$T/want-remote"
		cmp -s "$T/want-remote" "$T/remote" || fail "LF fixed office notice"
		[ ! -e "$T/launched" ] || fail "LF launched office app"
		rm "$T/remote"
		DI_OS=Darwin "$VT_SH" -eu "$T/lf-open.sh" || fail "LF Darwin office"
		eq "Darwin office dispatch" "${spec#* }" "$(head -n 1 "$T/launched")"
		rm "$T/launched"
	done
	DI_MIME=application/pdf "$VT_SH" -eu "$T/lf-open.sh" || fail "LF PDF"
	eq "PDF unchanged" zathura "$(head -n 1 "$T/launched")"
}

t_docimport_lf_zip() {
	command -v python3 >/dev/null 2>&1 || skip "no Python for ZIP fixture"
	di_lf_body open
	python3 "$REPO/.local/share/vertrice/tests/fixtures/docimport.py" "$T/fixtures" || fail "ZIP fixture generation"
	printf '#!/bin/sh\nprintf "OpenBSD\\n"\n' >"$T/bin/uname"
	cat >"$T/bin/lf" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$T/remote"
EOF
	cat >"$T/bin/detach" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$T/launched"
EOF
	chmod +x "$T/bin/uname" "$T/bin/lf" "$T/bin/detach"
	export id=1234 OPENER=generic-opener fx="$T/other.docx"
	mime=$(file -b --mime-type "$T/fixtures/foreign.docx")
	[ "$VT_HOST" != OpenBSD ] || eq "actual DOCX MIME" application/zip "$mime"
	for suffix in docx DoCx odt ODT; do
		cp "$T/fixtures/foreign.docx" "$T/document.$suffix"
		export f="$T/document.$suffix"
		"$VT_SH" -eu "$T/lf-open.sh" >out 2>err || fail "LF ZIP open"
		has "ZIP notice emission" "send $id echo 'DOCX/ODT:" "$(cat "$T/remote")"
		[ ! -e "$T/launched" ] || fail "LF ZIP reached generic opener"
		rm "$T/remote"
	done
}

t_docimport_preview() {
	cat >"$T/bin/mimetype" <<'EOF'
#!/bin/sh
printf '%s\n' "$DI_MIME"
EOF
	cp "$T/bin/mimetype" "$T/bin/file"
	printf '#!/bin/sh\nprintf "%%s\\n" "$@" >"$T/args"\nprintf "preview text\\n"\n' >"$T/bin/pandoc"
	printf '#!/bin/sh\nprintf "%%s\\n" "$@" >"$T/mac-args"\n' >"$T/bin/odt2txt"
	chmod +x "$T/bin/mimetype" "$T/bin/file" "$T/bin/pandoc" "$T/bin/odt2txt"
	name="$T/- draft ' [x]*.odt"
	printf 'original\n' >"$name"
	export DI_MIME=application/vnd.oasis.opendocument.text
	status=0
	"$VT_SH" "$REPO/.config/lf/scope" "$name" 48 20 0 0 >out || status=$?
	eq 'ODT preview status contract' 1 "$status"
	printf '%s\n' --sandbox --from=odt --to=plain -- "$name" >want
	cmp -s want "$T/args" || fail 'ODT preview literal arguments'
	eq 'ODT preview output' 'preview text' "$(cat out)"
	rm "$T/args"
	for mime in application/vnd.oasis.opendocument.spreadsheet application/vnd.oasis.opendocument.text-template; do
		export DI_MIME=$mime
		"$VT_SH" "$REPO/.config/lf/scope" "$name" 48 20 0 0 >out || :
		eq 'unsupported OpenDocument preview' 'No preview configured for this OpenDocument format.' "$(cat out)"
		[ ! -e "$T/args" ] || fail 'unsupported format converted'
	done
	[ ! -e "$XDG_CACHE_HOME/lf" ] || fail 'office preview created cache'
	[ ! -e "$T/media" ] || fail 'office preview extracted media'
	eq 'preview source untouched' original "$(cat "$name")"
	printf '#!/bin/sh\nprintf "Darwin\\n"\n' >"$T/bin/uname"
	chmod +x "$T/bin/uname"
	"$VT_SH" "$REPO/.config/lf/scope" "$name" 48 20 0 0 >out || :
	eq 'Mac odt2txt retained' "$name" "$(cat "$T/mac-args")"
	[ ! -e "$T/args" ] || fail 'Mac preview used Pandoc'
}

t_docimport_preview_native() {
	command -v pandoc >/dev/null 2>&1 || skip 'no native Pandoc'
	command -v python3 >/dev/null 2>&1 || skip 'no Python for independent ODT fixture'
	python3 "$REPO/.local/share/vertrice/tests/fixtures/docimport.py" "$T/fixtures" || fail 'ODT fixture generation'
	cp "$T/fixtures/foreign.odt" "$T/original.odt"
	status=0
	"$VT_SH" "$REPO/.config/lf/scope" "$T/fixtures/foreign.odt" 48 20 0 0 >out 2>err || status=$?
	eq 'native ODT preview status' 1 "$status"
	text=$(cat out)
	has 'ODT preview heading' 'Fixture heading' "$text"
	has 'ODT preview Unicode' 'café Ω 中文 —' "$text"
	has 'ODT preview table' 'Name' "$text"
	cmp -s "$T/original.odt" "$T/fixtures/foreign.odt" || fail 'preview changed ODT'
	[ ! -e "$XDG_CACHE_HOME/lf" ] || fail 'native ODT preview created cache'
	[ ! -e "$T/media" ] || fail 'native ODT preview extracted media'
}

t_docimport_native() {
	command -v pandoc >/dev/null 2>&1 || skip "no native Pandoc"
	command -v python3 >/dev/null 2>&1 || skip "no Python for fixture generation/media comparison"
	fixtures=${DOCIMPORT_FIXTURES:-}
	if [ -z "$fixtures" ]; then
		fixtures=$T/fixtures
		python3 "$REPO/.local/share/vertrice/tests/fixtures/docimport.py" "$fixtures" \
		    >"$T/fixtures.log" 2>&1 || fail "fixture generation: $(cat "$T/fixtures.log")"
	fi
	[ -f "$fixtures/foreign.docx" ] && [ -f "$fixtures/foreign.odt" ] ||
	    fail "missing independent fixtures in $fixtures"
	for fmt in docx odt; do
		cp "$fixtures/foreign.$fmt" "$T/$fmt.$fmt"
		cp "$T/$fmt.$fmt" "$T/original.$fmt"
		di "$T/$fmt.$fmt" >out 2>err || fail "native $fmt: $(cat err)"
		md="$T/$fmt.import/document.md"
		text=$(cat "$md")
		has "$fmt heading" '# Fixture heading' "$text"
		has "$fmt literal Unicode" 'café Ω 中文 —' "$text"
		has "$fmt emphasis" '*italic*' "$(printf '%s' "$text" | sed 's/styled italic/italic/g;s/direct italic/italic/g')"
		has "$fmt list" 'First bullet' "$text"
		has "$fmt pipe table" '| Name' "$text"
		[ -n "$(find "$T/$fmt.import/media" -type f -name '*.png' -print)" ] || fail "$fmt media missing"
		has "$fmt media link" 'media/' "$text"
		python3 - "$fixtures/foreign.$fmt" "$T/$fmt.import/media" <<'EOF' || fail "$fmt media bytes"
from pathlib import Path
from zipfile import ZipFile
import sys
with ZipFile(sys.argv[1]) as package:
    expected = [package.read(n) for n in package.namelist() if n.endswith('.png')]
actual = [p.read_bytes() for p in Path(sys.argv[2]).rglob('*.png')]
assert actual and sorted(actual) == sorted(expected)
EOF
		cmp -s "$T/original.$fmt" "$T/$fmt.$fmt" || fail "$fmt original changed"
		if di "$T/$fmt.$fmt" >out 2>err; then fail "$fmt overwrite accepted"; fi
	done
	text=$(cat "$T/docx.import/document.md")
	has "default accepts insertion" 'new phrase' "$text"
	hasnt "default omits deletion" 'old phrase' "$text"
	hasnt "default omits comment" 'Fixture comment' "$text"
	di --review "$T/docx.docx" >out 2>err || fail "native review: $(cat err)"
	text=$(tr '\n' ' ' <"$T/docx.review/document.md")
	for annotation in 'new phrase' 'old phrase' 'Fixture comment' insertion deletion; do
		has "review annotation" "$annotation" "$text"
	done
	cmp -s "$T/original.docx" "$T/docx.docx" || fail "review changed original"
	name='- literal '\''[x]* café
line.DOCX'
	cp "$fixtures/foreign.docx" "$T/$name"
	di "$name" >out 2>err || fail "native literal path: $(cat err)"
	printf '%s\n' "$T/${name%.*}.import/document.md" >want
	cmp -s out want || fail "native literal output path"
	di --review "$name" >out 2>err || fail "native literal review"
	cmp -s "$fixtures/foreign.docx" "$T/$name" || fail "native literal original changed"
	printf 'not a zip\n' >bad.docx
	if di bad.docx >out 2>err; then fail "native malformed accepted"; fi
	[ -s err ] || fail "native failure hidden"
	[ ! -e bad.import ] || fail "native failure output retained"
}
