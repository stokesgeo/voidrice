# Fetches through base ftp(1) (mock/ftp), pauseallmpv through base nc(1)
# (mock/nc), and the base-tool fallbacks of setbg and lf's scope.

# stat -f %Sm -t FMT FILE, as BSD stat: the file's time is now. The blocks
# refetch when the date differs, so a file just written counts as fresh.
fx_stat() {
	cat >"$T/bin/stat" <<'EOF'
#!/bin/sh
for f; do :; done
[ -e "$f" ] || exit 1
fmt=; while [ $# -gt 0 ]; do [ "$1" = -t ] && fmt=$2; shift; done
date "+$fmt"
EOF
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/route"
	chmod +x "$T/bin/stat" "$T/bin/route"
}

t_fetch_weath() {
	printf 'Weather report: Paris\n\nsunny\n' | fx out.ftp
	out=$(weath Paris 2>&1) || fail "weath failed: $out"
	logged '^ftp -MV -w 5 -U curl -o - https://wttr\.is/Paris\?F$'
	has "report shown" "sunny" "$out"
	echo 1 >"$VT_STATE/rc.ftp"
	out=$(weath Paris 2>&1); rc=$?
	eq "fetch fails: exit 1" 1 "$rc"
	has "says so" "Failed to get weather forecast!" "$out"
	hasnt "ftp's own error kept out" "404" "$out"
}

t_fetch_sb_forecast() {
	fx_stat
	# Lines 13 and 16 are what the block reads: lows and highs, rain.
	{ for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "line $i"; done
	  echo "m+3 m+9 m12"; echo; echo; echo "rain 20% 70% 5%"; } | fx out.ftp
	out=$(LOCATION=Paris BLOCK_BUTTON=2 sb-forecast)
	logged '^ftp -MV -U curl -o .*/weatherreport https://wttr\.in/Paris$'
	eq "block" "☔70% 🥶3° 🌞12°" "$(printf '%s\n' "$out" | sed -n 1p)"
}

t_fetch_sb_moonphase() {
	fx_stat
	mkdir -p "$HOME/.local/share"
	echo 🌔 | fx out.ftp
	eq "first run: empty while it fetches" "" "$(sb-moonphase)"
	waitfor 5 test -s "$HOME/.local/share/moonphase" || fail "never fetched"
	logged '^ftp -MV -U curl -o .*/moonphase https://wttr\.in/\?format=%m$'
	eq "phase" "🌔" "$(sb-moonphase)"
}

t_fetch_sb_price() {
	fx_stat
	echo 61234.567 | fx out.ftp
	out=$(BLOCK_BUTTON=2 sb-price btc-usd Bitcoin B)
	logged '^ftp -MV -U curl -o .*/crypto-prices/btc-usd https://usd\.rate\.sx/1btc$'
	logged '^ftp -MV -U curl -o .*/crypto-prices/btc-usd-chart https://usd\.rate\.sx/btc@14d$'
	eq "price" 'B$61234.57' "$out"
}

t_fetch_sb_ticker() {
	fx_stat
	printf '  ^GSPC \033[32m0.09\033[0m\n  ^DJI \033[31m-1.88\033[0m\n' | fx out.ftp
	out=$(BLOCK_BUTTON=2 sb-ticker)
	logged '^ftp -MV -w 10 -U curl -o .*/stock-prices https://terminal-stocks\.dev/\^GSPC,\^DJI,\^IXIC$'
	eq "one change per ticker, in order" "^GSPC: 0.09%
^DJI: -1.88%
^IXIC: %" "$out"
	eq "fresh file: fetched once" 1 "$(nlogged '^ftp ')"
	echo 1 >"$VT_STATE/rc.ftp"
	BLOCK_BUTTON=2 sb-ticker >/dev/null
	[ -e "$XDG_CACHE_HOME/stock-prices" ] && fail "failed fetch left the price file"
	return 0
}

t_fetch_getbib() {
	mkdir -p "$HOME/latex"; : >"$HOME/latex/uni.bib"
	echo '@article{Smith_2020, title={A}, DOI={10.1000/xyz}, author={B} }' | fx out.ftp
	out=$(getbib doi:10.1000/xyz 2>&1)
	logged '^ftp -MV -o - https://api\.crossref\.org/works/10\.1000/xyz/transform/application/x-bibtex$'
	has "added" "Added bibtex entry for DOI: 10.1000/xyz" "$out"
	has "entry written" "@article{smith20," "$(cat "$HOME/latex/uni.bib")"
	echo 1 >"$VT_STATE/rc.ftp"
	out=$(getbib doi:10.1000/abc 2>&1)
	has "HTTP error: no entry" "Failed to fetch bibtex entry for DOI: 10.1000/abc" "$out"
}

# getbib's DOI filter under a sed that takes only what OpenBSD sed takes. On
# a GNU host the guard runs GNU sed with --posix, which refuses GNU-only
# commands such as T (upstream's "T; q"); OpenBSD sed has no T at all
# (usr.bin/sed/compile.c). The PDF's metadata has two DOIs: the first wins.
t_fetch_getbib_posix_sed() {
	realsed=$(PATH=$syspath command -v sed)
	if "$realsed" --version 2>/dev/null | grep -q GNU; then
		printf '#!/bin/sh\nexec %s --posix "$@"\n' "$realsed" >"$T/bin/sed"
	else
		printf '#!/bin/sh\nexec %s "$@"\n' "$realsed" >"$T/bin/sed"
	fi
	printf '#!/bin/sh\nprintf "Title: x\\nSubject: doi:10.1000/first\\nKeywords: DOI 10.1000/second\\n"\n' >"$T/bin/pdfinfo"
	# find: OpenBSD's has no -quit (usr.bin/find/option.c); GNU's does.
	realfind=$(PATH=$syspath command -v find)
	printf '#!/bin/sh\nfor a; do [ "$a" = -quit ] && { echo "find: -quit: unknown primary" >&2; exit 1; }; done\nexec %s "$@"\n' "$realfind" >"$T/bin/find"
	chmod +x "$T/bin/sed" "$T/bin/pdfinfo" "$T/bin/find"
	echo x | sed -n 's/x/y/p; T; q' >/dev/null 2>&1 &&
		fail "the guard sed took GNU's T: the case would prove nothing"
	# No ~/latex/uni.bib: getbib finds a .bib file under $HOME.
	mkdir -p "$HOME/refs"; : >"$HOME/refs/mine.bib"; : >"$T/paper.pdf"
	echo '@article{A_2020, DOI={10.1000/first} }' | fx out.ftp
	out=$(getbib "$T/paper.pdf" 2>&1)
	logged '^ftp -MV -o - https://api\.crossref\.org/works/10\.1000/first/transform/application/x-bibtex$'
	notlogged 'second'
	has "added" "Added bibtex entry for DOI: 10.1000/first" "$out"
	has "written to the .bib file found" "@article{a20," "$(cat "$HOME/refs/mine.bib")"
}

t_fetch_rssget() {
	printf '<link rel="alternate" type="application/rss+xml" href="/feed.xml">\n' | fx out.ftp
	out=$(rssget https://example.com/blog/post news)
	logged '^ftp -MV -o - https://example\.com/blog/post$'
	eq "feed from the page" "https://example.com/feed.xml news" "$out"
	printf '<script>{"rssUrl":"https://www.youtube.com/feeds/videos.xml?channel_id=UC1","x":1}</script>\n' | fx out.ftp
	eq "youtube /c/ page" "https://www.youtube.com/feeds/videos.xml?channel_id=UC1 " \
		"$(rssget https://www.youtube.com/c/someone)"
	[ -e "$T/tmp_rssget_yt" ] && fail "left a temporary file behind"
	return 0
}

t_fetch_peertubetorrent() {
	printf '#!/bin/sh\necho "transadd $*" >>"$VT_STATE/log"\n' >"$T/bin/transadd"
	chmod +x "$T/bin/transadd"
	t=https://tube.example/download/torrents/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0-480.torrent
	printf '{"files":[{"torrentUrl":"%s"}]}\n' "$t" | fx out.ftp
	peertubetorrent https://tube.example/w/abc123 480
	logged '^ftp -MV -o - https://tube\.example/api/v1/videos/abc123$'
	logged "^transadd $t\$"
}

t_fetch_linkhandler_image() {
	printf '#!/bin/sh\necho "nsxiv $*" >>"$VT_STATE/log"\n' >"$T/bin/nsxiv"
	chmod +x "$T/bin/nsxiv"
	name=vt-fetch-$$.png
	linkhandler "https://example.com/$name"
	waitfor 5 grep -q '^nsxiv ' "$VT_STATE/log" || fail "nsxiv never ran"
	f=$(sed -n 's/^nsxiv -a //p' "$VT_STATE/log")
	"$VT_REAL_RM" -rf "${f%/*}"
	# The file lands in a private mktemp directory (desktop.sh checks that).
	logged "^ftp -MV -o /tmp/[^/]+/$name https://example\.com/$name\$"
	eq "nsxiv opens what ftp wrote" "$name" "${f##*/}"
}

t_fetch_pauseallmpv() {
	command -v python3 >/dev/null 2>&1 || skip "no python3 to make a Unix socket"
	# The sockets are in the cache directory the mpvSockets script uses.
	d=$XDG_CACHE_HOME/mpvSockets
	mkdir "$d"
	for s in 111 222; do
		python3 -c 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$d/$s"
	done
	: >"$d/not-a-socket"
	pauseallmpv
	eq "one nc per socket" 2 "$(nlogged '^nc ')"
	logged "^nc -NU -w 1 $d/111\$"
	logged "^nc -NU -w 1 $d/222\$"
	notlogged 'not-a-socket'
	eq "pause sent to each" 2 "$(nlogged '^nc< \{ "command": \["set_property", "pause", true\] \}$')"
	"$VT_REAL_RM" -r "$d"
	pauseallmpv || fail "no sockets: failed"
	eq "no sockets: no nc" 2 "$(nlogged '^nc ')"
	# The script and pauseallmpv agree on the directory; nothing is in /tmp.
	lua=$REPO/.config/mpv/scripts/mpvSockets.lua
	grep -q '"XDG_CACHE_HOME"' "$lua" && grep -q '"mpvSockets"' "$lua" ||
		fail "mpvSockets.lua does not use the cache directory"
	grep -rq '/tmp/mpvSockets' "$REPO/.local/bin" "$REPO/.config" &&
		fail "something still reads /tmp/mpvSockets"
	[ -e "$REPO/.gitmodules" ] && fail ".gitmodules is back"
	return 0
}

t_fetch_setbg_no_xwallpaper() {
	command -v xwallpaper >/dev/null 2>&1 && skip "this host has xwallpaper"
	mkdir -p "$XDG_CONFIG_HOME/x11"
	ln -s "$REPO/.config/x11/themes" "$XDG_CONFIG_HOME/x11/themes"
	echo night >"$XDG_CACHE_HOME/theme"
	setbg -s
	logged '^xsetroot -solid #24232e$'
	: >"$VT_STATE/log"; "$VT_REAL_RM" "$XDG_CACHE_HOME/theme"
	VT_EPOCH=1790665200 setbg -s	# 07:00 UTC, no theme applied yet: day
	logged '^xsetroot -solid #f5f1e8$'
	: >"$VT_STATE/log"
	printf '#!/bin/sh\necho "xwallpaper $*" >>"$VT_STATE/log"\n' >"$T/bin/xwallpaper"
	chmod +x "$T/bin/xwallpaper"
	setbg -s
	logged '^xwallpaper --zoom '
	notlogged '^xsetroot'
}

t_fetch_scope_no_bat() {
	command -v bat >/dev/null 2>&1 && skip "this host has bat"
	printf 'one\ntwo\nthree\nfour\n' >"$T/notes.txt"
	eq "first screenful" "one
two
three" "$("$VT_SH" "$REPO/.config/lf/scope" "$T/notes.txt" 80 3 0 0)"
}

# lf passes file, width, height, x, y. bat's width is the width ($2) less
# two; upstream used $4, the x position.
t_fetch_scope_bat_width() {
	# scope runs under set -C; ksh then refuses ">/dev/null" when
	# /dev/null is a regular file (seen on a broken Linux host), so bat
	# would never be found. There, point the redirections at a scratch file.
	scope=$REPO/.config/lf/scope
	[ -c /dev/null ] || scope=$(derived .config/lf/scope scope "s|/dev/null|$T/null|g")
	printf '#!/bin/sh\necho "bat $*" >>"$VT_STATE/log"\n' >"$T/bin/bat"
	chmod +x "$T/bin/bat"
	printf 'one\n' >"$T/notes.txt"
	"$VT_SH" "$scope" "$T/notes.txt" 80 3 41 1 >"$T/out"
	logged '^bat -p --theme ansi --terminal-width 78 -f .*/notes\.txt$'
}

# Archives list through the tool ext would use for the same name.
t_fetch_scope_archives() {
	for c in tar unzip bzip2 7z; do
		printf '#!/bin/sh\necho "%s $*" >>"$VT_STATE/log"\n' "$c" >"$T/bin/$c"
		chmod +x "$T/bin/$c"
	done
	for f in a.tar.gz b.tgz c.tar d.zip e.tar.bz2 f.7z; do : >"$T/$f"; done
	for f in a.tar.gz b.tgz c.tar d.zip e.tar.bz2 f.7z; do
		"$VT_SH" "$REPO/.config/lf/scope" "$T/$f" 80 20 41 1 >/dev/null
	done
	logged "^tar tzf $T/a\.tar\.gz$"
	logged "^tar tzf $T/b\.tgz$"
	logged "^tar tf $T/c\.tar$"
	logged "^unzip -l $T/d\.zip$"
	logged "^bzip2 -dc -- $T/e\.tar\.bz2$"
	logged "^tar tf -$"
	logged "^7z l $T/f\.7z$"
	notlogged 'atool'
}

# No image previewer installed: a message, not a blank pane.
t_fetch_scope_image_message() {
	command -v mediainfo >/dev/null 2>&1 && skip "this host has mediainfo"
	printf '#!/bin/sh\necho "image/png"\n' >"$T/bin/file"
	chmod +x "$T/bin/file"
	: >"$T/pic.png"
	out=$("$VT_SH" "$REPO/.config/lf/scope" "$T/pic.png" 80 20 41 1)
	has "names the file" "pic.png" "$out"
	has "says why it is blank" "(no image preview installed)" "$out"
}
