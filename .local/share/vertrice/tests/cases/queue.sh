# The download queue: qndl on nq (mock/nq runs the job at once),
# queueandnotify, newsboat's a macro, sb-tasks; newsup, the cron reload.

# newsup: stand-ins for newsboat (logs its arguments) and for pgrep, which
# finds a running newsboat when $T/nb-open exists.
nu_setup() {
	printf '#!/bin/sh\necho "newsboat $*" >>"$VT_STATE/log"\n' >"$T/bin/newsboat"
	printf '#!/bin/sh\necho "pgrep $*" >>"$VT_STATE/log"; [ -e "$T/nb-open" ]\n' >"$T/bin/pgrep"
	chmod +x "$T/bin/newsboat" "$T/bin/pgrep"
}
# An open newsboat in xterm got an xdotool "R", which xterm drops when the
# window is not focused (allowSendEvents is false by default), while
# xdotool still exits 0: no reload happened. Now newsup leaves an open
# newsboat to its own auto-reload.
t_newsup_open() {
	nu_setup; : >"$T/nb-open"
	"$VT_SH" "$REPO/.local/bin/cron/newsup"
	notlogged '^xdotool'
	notlogged '^newsboat'
	notlogged '^notify-send'
	grep -qx 'auto-reload yes' "$REPO/.config/newsboat/config" ||
		fail "an open newsboat reloads only with auto-reload yes"
}
t_newsup_closed() {
	nu_setup
	"$VT_SH" "$REPO/.local/bin/cron/newsup"
	logged '^newsboat -x reload$'
	logged '^notify-send .*RSS feed update complete\.$'
	[ -e "$XDG_CACHE_HOME/newsupdate" ] && fail "left the newsupdate icon"
	return 0
}

# yt-dlp stand-in: logs each argument in brackets, to show the word split.
fx_ytdlp() {
	printf '#!/bin/sh\nl=yt-dlp; for a; do l="$l [$a]"; done; echo "$l" >>"$VT_STATE/log"\n' >"$T/bin/yt-dlp"
	chmod +x "$T/bin/yt-dlp"
}

t_queue_qndl() {
	fx_ytdlp
	qndl 'https://x.example/a;touch${IFS}pwned'
	logged '^yt-dlp \[--embed-metadata\] \[-ic\] \[https://x\.example/a;touch\$\{IFS\}pwned\]$'
	[ -e "$T/pwned" ] && fail "the URL ran as shell text"
	logged '^notify-send 👍 a;touch\$\{IFS\}pwned done\.$'
	: >"$VT_STATE/log"
	# $2 is split into words, as voidrice's tsp $cmd was: no quotes in it.
	qndl https://x.example/v/1 'yt-dlp -o %(title)s.%(ext)s -f bestaudio'
	logged '^yt-dlp \[-o\] \[%\(title\)s\.%\(ext\)s\] \[-f\] \[bestaudio\] \[https://x\.example/v/1\]$'
	logged '^nq -cq mv 1 1$'
	eq "dmenuhandler's audio entry passes no quotes" "" \
		"$(grep "queue yt-dlp audio\" ) qndl" "$REPO/.local/bin/dmenuhandler" | grep '"%')"
}

t_queue_ftp_rename() {
	: >"$VT_STATE/ftp.byname"
	mkdir -p "$HOME/.local/share/newsboat"
	echo 'https://pod.example/Show%20One.mp3?source=rss "/x"' >"$HOME/.local/share/newsboat/queue"
	queueandnotify
	logged '^ftp https://pod\.example/Show%20One\.mp3\?source=rss$'
	[ -f "$T/Show One.mp3" ] || fail "not renamed: $(ls "$T")"
	logged '^notify-send 👍 Show One\.mp3 done\.$'
	eq "queue emptied" "" "$(tr -d '\n' <"$HOME/.local/share/newsboat/queue")"
}

t_queue_newsboat_a() {
	fx_ytdlp
	# newsboat puts the URL, single-quoted, where %u is (view.cpp).
	cmd=$(sed -n 's/^macro a set browser "\(.*\)" ; open-in-browser.*/\1/p' "$REPO/.config/newsboat/config")
	eval "$(printf '%s' "$cmd" | sed "s|%u|'https://x.example/v/4'|")"
	logged '^yt-dlp \[--embed-metadata\] \[-xic\] \[-f\] \[bestaudio/best\] \[--restrict-filenames\] \[https://x\.example/v/4\]$'
}

t_queue_sb_tasks() {
	d=$XDG_CACHE_HOME/qndl; mkdir -p "$d"
	"$VT_REAL_SLEEP" 30 & track $!; : >"$d/,1.$!"; chmod u+x "$d/,1.$!"
	"$VT_REAL_SLEEP" 30 & track $!; : >"$d/,2.$!"
	sh -c 'exit 0' & wait $!; : >"$d/,0.$!"
	eq "running 1, queued 1, done one left out" "🤖2(1)" "$(sb-tasks)"
}
