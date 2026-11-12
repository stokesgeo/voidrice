# Explicit providers for shipped OpenBSD actions, not package-name guessing.
t_dependencies_openbsd_no_codex() {
	for list in pkglist pkglist.extra; do
		if grep -Eq '^[[:space:]]*codex([[:space:]]|$)' "$REPO/.local/share/openbsd/$list"; then
			fail "deprecated Codex must not be installed by $list"
		fi
	done
	for p in node fd; do
		grep -Fxq "$p" "$REPO/.local/share/openbsd/pkglist" || fail "Pi dependency $p missing"
	done
}

t_dependencies_openbsd_helpers() {
	for p in p5-File-MimeInfo poppler-utils mediainfo ffmpegthumbnailer tesseract arandr shellcheck w3m-- libiconv; do
		grep -Fxq "$p" "$REPO/.local/share/openbsd/pkglist" || fail "$p missing from core packages"
	done
}

t_dependencies_openbsd_html_mime() {
	export TERMINAL_BROWSER=w3m
	printf '#!/bin/sh\necho "mimetype $*" >>"$VT_STATE/log"\necho text/html\n' >"$T/bin/mimetype"
	printf '#!/bin/sh\necho text/plain\n' >"$T/bin/file"
	printf '#!/bin/sh\necho "w3m $*" >>"$VT_STATE/log"\n' >"$T/bin/w3m"
	chmod +x "$T/bin/mimetype" "$T/bin/file" "$T/bin/w3m"
	printf '<!doctype html><html><p>fixture</p></html>\n' >"$T/page.html"
	"$VT_SH" "$REPO/.config/lf/scope" "$T/page.html" 48 20 0 0 >"$T/preview"
	logged '^mimetype -b .*/page\.html$'
	logged '^w3m -dump -cols 48 -o document_charset=UTF-8 -O UTF-8 .*/page\.html$'
}

t_dependencies_mac_mime_unchanged() {
	export TERMINAL_BROWSER=lynx
	printf '#!/bin/sh\necho Darwin\n' >"$T/bin/uname"
	printf '#!/bin/sh\necho text/html\n' >"$T/bin/file"
	printf '#!/bin/sh\necho "unexpected mimetype" >>"$VT_STATE/log"\nexit 1\n' >"$T/bin/mimetype"
	printf '#!/bin/sh\necho "lynx $*" >>"$VT_STATE/log"\n' >"$T/bin/lynx"
	chmod +x "$T/bin/uname" "$T/bin/file" "$T/bin/mimetype" "$T/bin/lynx"
	: >"$T/page.html"
	"$VT_SH" "$REPO/.config/lf/scope" "$T/page.html" 48 20 0 0 >"$T/preview"
	logged '^lynx -width=48 -display_charset=utf-8 -dump .*/page\.html$'
	notlogged 'unexpected mimetype'
}

t_dependencies_openbsd_optional() {
	for p in ImageMagick abook profanity djvulibre inkscape gnome-epub-thumbnailer odt2txt libreoffice gimp gtkwave calcurse sox sent latexmk; do
		grep -Fxq "$p" "$REPO/.local/share/openbsd/pkglist.extra" || fail "$p missing from optional packages"
	done
}

t_dependencies_browser_roles() {
	grep -Eq '^bind-key 4-w[[:space:]]+"sh -c .exec \$BROWSER' "$REPO/.config/cwm/cwmrc" || fail 'human browser key must follow BROWSER'
	grep -Eq '^bind-key 4S-w[[:space:]]+chrome([[:space:]]|$)' "$REPO/.config/cwm/cwmrc" || fail 'agent browser key must use native chrome'
}

t_dependencies_tex_cleanup_guard() {
	# Even an installed latexmk may evaluate untrusted project configuration.
	if grep -Eq 'autocmd[[:space:]]+VimLeave.*latexmk' "$REPO/.config/nvim/init.vim"; then
		fail 'editor exit must not invoke latexmk'
	fi
}

t_dependencies_preview_creates_cache() {
	export XDG_CACHE_HOME="$T/fresh-cache"
	printf '#!/bin/sh\necho application/pdf\n' >"$T/bin/mimetype"
	printf '#!/bin/sh\n: >"$6.jpg"\n' >"$T/bin/pdftoppm"
	printf '#!/bin/sh\necho metadata\n' >"$T/bin/mediainfo"
	chmod +x "$T/bin/mimetype" "$T/bin/pdftoppm" "$T/bin/mediainfo"
	: >"$T/doc.pdf"
	status=0
	"$VT_SH" "$REPO/.config/lf/scope" "$T/doc.pdf" 80 20 0 0 >"$T/out" 2>"$T/err" || status=$?
	eq 'preview status contract' 1 "$status"
	[ -d "$XDG_CACHE_HOME/lf" ] || fail 'preview cache was not created'
	[ ! -s "$T/err" ] || fail "thumbnail failed: $(cat "$T/err")"
	eq 'metadata fallback retained' metadata "$(cat "$T/out")"
}

t_dependencies_html_mail_renderer() {
	grep -Fq 'text/html; html-to-text %s 1024 %{charset}; nametemplate=%s.html; copiousoutput;' \
		"$REPO/.config/mutt/mailcap" || fail 'HTML auto-view must use selected renderer and MIME charset'
	grep -Fq 'text/html; /usr/local/lib/mutt-wizard/openfile %s ; nametemplate=%s.html' \
		"$REPO/.config/mutt/mailcap" || fail 'normal HTML opening must be retained'
}

t_html_to_text_w3m() {
	printf '#!/bin/sh\nprintf "%%s\\n" "$@" >"$VT_STATE/render-args"\n' >"$T/bin/w3m"
	chmod +x "$T/bin/w3m"
	printf '<html>caf\303\251 na\303\257ve</html>\n' >"$T/a file.html"
	TERMINAL_BROWSER=w3m html-to-text "$T/a file.html" 48 us-ascii
	eq 'w3m argv' "-dump
-cols
48
-o
document_charset=UTF-8
-O
UTF-8
$T/a file.html" "$(cat "$VT_STATE/render-args")"
}

t_html_to_text_w3m_charset_fallback() {
	printf '#!/bin/sh\nprintf "%%s\\n" "$@" >"$VT_STATE/render-args"\n' >"$T/bin/w3m"
	chmod +x "$T/bin/w3m"
	printf '<html>caf\351 na\357ve</html>\n' >"$T/latin.html"
	for hint in '' us-ascii US-ASCII Us-AsCiI; do
		TERMINAL_BROWSER=w3m html-to-text "$T/latin.html" 48 "$hint"
		grep -Fxq 'document_charset=ISO-8859-1' "$VT_STATE/render-args" || fail 'invalid UTF-8 must retain Latin-1 fallback'
	done
	printf '<html>caf\303\251</html>\n' >"$T/utf8.html"
	for hint in '' us-ascii US-ASCII Us-AsCiI; do
		TERMINAL_BROWSER=w3m html-to-text "$T/utf8.html" 48 "$hint"
		grep -Fxq 'document_charset=UTF-8' "$VT_STATE/render-args" || fail 'valid UTF-8 must not use Latin-1 fallback'
	done
	# Explicit MIME data remains authoritative, even when bytes are valid UTF-8.
	TERMINAL_BROWSER=w3m html-to-text "$T/utf8.html" 48 windows-1252
	grep -Fxq 'document_charset=windows-1252' "$VT_STATE/render-args" || fail 'explicit charset changed'
}

t_html_to_text_lynx() {
	printf '#!/bin/sh\nprintf "%%s\\n" "$@" >"$VT_STATE/render-args"\n' >"$T/bin/lynx"
	chmod +x "$T/bin/lynx"
	TERMINAL_BROWSER=lynx html-to-text "$T/a file.html" 64 UTF-8
	eq 'lynx argv' "-width=64
-assume_charset=UTF-8
-display_charset=utf-8
-dump
$T/a file.html" "$(cat "$VT_STATE/render-args")"
}

t_html_to_text_elinks() {
	printf '#!/bin/sh\nprintf "%%s\\n" "$@" >"$VT_STATE/render-args"\n' >"$T/bin/elinks"
	chmod +x "$T/bin/elinks"
	TERMINAL_BROWSER=elinks html-to-text "$T/a file.html" 72 windows-1252
	eq 'elinks argv' "-no-connect
-dump
-dump-width
72
-dump-charset
UTF-8
-eval
set ecmascript.enable = 0
-eval
set document.css.enable = 0
-eval
set document.html.display_frames = 0
-eval
set document.html.display_iframes = 0
-eval
set document.codepage.assume = \"windows-1252\"
$T/a file.html" "$(cat "$VT_STATE/render-args")"
}

t_html_to_text_rejects_invalid_data() {
	printf '#!/bin/sh\necho ran >"$VT_STATE/renderer-ran"\n' >"$T/bin/elinks"
	chmod +x "$T/bin/elinks"
	status=0
	TERMINAL_BROWSER=elinks html-to-text "$T/a.html" 80 'UTF-8"; bad' >"$T/out" 2>"$T/err" || status=$?
	eq 'invalid charset refused' 2 "$status"
	[ ! -e "$VT_STATE/renderer-ran" ] || fail 'invalid charset reached renderer'
	status=0
	TERMINAL_BROWSER=elinks html-to-text "$T/a.html" 0 >"$T/out" 2>"$T/err" || status=$?
	eq 'invalid width refused' 2 "$status"
	status=0
	TERMINAL_BROWSER=unknown html-to-text "$T/a.html" 80 >"$T/out" 2>"$T/err" || status=$?
	eq 'unknown renderer refused' 2 "$status"
}
