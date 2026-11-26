# Local HTML only; no desktop, endpoint, credentials or owner configuration.
t_html_renderer_native() {
	command -v w3m >/dev/null 2>&1 || skip 'no native w3m'
	printf '<html><body>caf\303\251 tea</body></html>\n' >"$T/utf8.html"
	printf '<html><body>caf\351 tea</body></html>\n' >"$T/latin.html"
	for encoding in utf8 latin; do
		out=$(TERMINAL_BROWSER=w3m html-to-text "$T/$encoding.html" 80) || fail 'native rendering failed'
		has 'UTF-8 output from detected charset' "$(printf 'caf\303\251 tea')" "$out"
	done
}

t_html_renderer_boundaries() {
	for browser in w3m lynx elinks; do
		cat >"$T/bin/$browser" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$VT_STATE/renderer.args"
EOF
		chmod +x "$T/bin/$browser"
	done
	printf '<b>local</b>\n' >"$T/page.html"
	TERMINAL_BROWSER=w3m html-to-text "$T/page.html" 48 UTF-8 || fail 'w3m dispatch'
	eq 'safe w3m arguments' "-config
/dev/null
-dump
-T
text/html
-cols
48
-I
UTF-8
-O
UTF-8
-no-cookie
-o
frame=0
-o
meta_refresh=0
-o
display_image=0" "$(cat "$VT_STATE/renderer.args")"
	TERMINAL_BROWSER=lynx html-to-text "$T/page.html" 64 UTF-8 || fail 'lynx dispatch'
	has 'lynx local-only' '-localhost
-restrictions=all' "$(cat "$VT_STATE/renderer.args")"
	TERMINAL_BROWSER=elinks html-to-text "$T/page.html" 72 windows-1252 || fail 'elinks dispatch'
	has 'elinks no connections' '-no-connect' "$(cat "$VT_STATE/renderer.args")"
	has 'elinks no scripts' 'set ecmascript.enable = 0' "$(cat "$VT_STATE/renderer.args")"
	rm "$VT_STATE/renderer.args"
	for kind in width charset missing; do
		case $kind in
		width) set -- "$T/page.html" 0 UTF-8 ;;
		charset) set -- "$T/page.html" 80 'UTF-8"; bad' ;;
		missing) set -- "$T/missing.html" 80 UTF-8 ;;
		esac
		TERMINAL_BROWSER=elinks html-to-text "$@" >"$T/out" 2>"$T/err" && fail "accepted $kind"
		[ ! -e "$VT_STATE/renderer.args" ] || fail 'invalid input reached renderer'
	done
	TERMINAL_BROWSER=missing-fixture-renderer html-to-text "$T/page.html" >"$T/out" 2>"$T/err"
	eq 'explicit missing preference preserved' 127 "$?"
}
