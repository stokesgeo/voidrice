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
	logged '^yt-dlp \[--embed-metadata\] \[-c\] \[https://x\.example/a;touch\$\{IFS\}pwned\]$'
	[ -e "$T/pwned" ] && fail "the URL ran as shell text"
	logged '^notify-send 👍 a;touch\$\{IFS\}pwned done\.$'
	: >"$VT_STATE/log"
	# $2 is split into words, as voidrice's tsp $cmd was: no quotes in it.
	qndl https://x.example/v/1 'yt-dlp -o %(title)s.%(ext)s -f bestaudio'
	logged '^yt-dlp \[-o\] \[%\(title\)s\.%\(ext\)s\] \[-f\] \[bestaudio\] \[https://x\.example/v/1\]$'
	eq "one queued job" 1 "$(nlogged '^nq -cq ')"
	eq "successful job" 0 "$(cat "$VT_STATE/status.nq")"
	notlogged '^nq -cq mv '
	# Command words are literal too: no glob expansion or shell evaluation.
	: >"$T/glob-match"
	: >"$VT_STATE/log"
	qndl 'https://x.example/a b?x=1&y=$HOME' 'yt-dlp glob-* $(touch pwned)'
	logged '^yt-dlp \[glob-\*\] \[\$\(touch\] \[pwned\)\] \[https://x\.example/a b\?x=1&y=\$HOME\]$'
	[ ! -e "$T/pwned" ] || fail "command words ran as shell text"
	eq "one queued literal-argument job" 1 "$(nlogged '^nq -cq ')"
	eq "dmenuhandler's audio entry passes no quotes" "" \
		"$(grep "queue yt-dlp audio\" ) qndl" "$REPO/.local/bin/dmenuhandler" | grep '"%')"
}

t_queue_ftp_no_rename() {
	: >"$VT_STATE/ftp.byname"
	mkdir -p "$HOME/.local/share/newsboat"
	echo 'https://pod.example/Show%20One.mp3?source=rss "/x"' >"$HOME/.local/share/newsboat/queue"
	queueandnotify
	logged '^ftp https://pod\.example/Show%20One\.mp3\?source=rss$'
	[ -f "$T/Show%20One.mp3?source=rss" ] || fail "downloader filename changed"
	[ ! -e "$T/Show One.mp3" ] || fail "created a cleaned filename"
	logged '^notify-send 👍 Show%20One\.mp3\?source=rss done\.$'
	eq "one queued ftp job" 1 "$(nlogged '^nq -cq ')"
	notlogged '^nq -cq mv '
	eq "successful ftp job" 0 "$(cat "$VT_STATE/status.nq")"
	eq "queue emptied" "" "$(tr -d '\n' <"$HOME/.local/share/newsboat/queue")"
}

t_queue_submission_failure() {
	fx_ytdlp
	echo 37 >"$VT_STATE/rc.nq"
	qndl https://x.example/not-queued
	eq "qndl submission failure status" 37 "$?"
	notlogged '^yt-dlp'
	[ ! -e "$VT_STATE/status.nq" ] || fail "ran a rejected job"
}

t_queue_failed_enqueue_retains_queue() {
	mkdir -p "$HOME/.local/share/newsboat"
	queuefile=$HOME/.local/share/newsboat/queue
	printf '%s\n' 'https://pod.example/one.mp3 "/x"' \
	    'https://pod.example/two.mp3 "/y"' >"$queuefile"
	cp "$queuefile" "$T/queue.before"
	echo 37 >"$VT_STATE/rc.nq"
	queueandnotify
	eq "queueandnotify submission failure status" 37 "$?"
	cmp -s "$T/queue.before" "$queuefile" || fail "changed queue on enqueue failure"
	eq "stopped after rejected submission" 1 "$(nlogged '^nq -cq ')"
	notlogged '^ftp '
	[ ! -e "$VT_STATE/status.nq" ] || fail "ran a rejected job"
}

# Both notification attempts may fail without changing the queued job status.
t_queue_notification_failure() {
	fx_ytdlp
	echo 19 >"$VT_STATE/rc.notify-send"
	qndl https://x.example/ok
	eq "enqueue status" 0 "$?"
	eq "successful download despite notification failure" 0 "$(cat "$VT_STATE/status.nq")"
	logged '^notify-send 👍 ok done\.$'
}

t_queue_download_failure() {
	: >"$VT_STATE/ftp.byname"
	echo 23 >"$VT_STATE/rc.ftp"
	echo 19 >"$VT_STATE/rc.notify-send"
	qndl 'https://pod.example/failed.mp3?source=rss' ftp
	eq "enqueue status is not job status" 0 "$?"
	eq "downloader status survives failed notification" 23 "$(cat "$VT_STATE/status.nq")"
	eq "one failed job" 1 "$(nlogged '^nq -cq ')"
	logged '^notify-send qndl: failed\.mp3\?source=rss failed \(exit 23\)\.$'
	notlogged '^notify-send 👍'
	[ ! -e "$T/failed.mp3?source=rss" ] || fail "failed download created a file"
	set -- "$XDG_CACHE_HOME/qndl"/,*
	[ -f "$1" ] || fail "failed job log not retained"
	grep -q 'ftp: Error retrieving' "$1" || fail "missing download error"
}

t_queue_missing_nq() {
	fx_ytdlp
	mkdir "$T/no-nq"
	ln -s /usr/bin/printf "$T/no-nq/printf"
	# An isolated PATH ensures this holds even on hosts with real nq.
	printf '#!/bin/sh\nprintf "notify-send %%s\\n" "$*" >>"$VT_STATE/log"\nexit 19\n' >"$T/no-nq/notify-send"
	chmod +x "$T/no-nq/notify-send"
	PATH="$T/no-nq" "$VT_SH" "$REPO/.local/bin/qndl" \
	    https://x.example/no-queue "$T/bin/yt-dlp" 2>"$T/err"
	eq "missing nq status survives failed notification" 127 "$?"
	grep -q 'qndl: nq not found; download not queued' "$T/err" || fail "missing nq diagnostic"
	logged '^notify-send qndl: nq not found; download not queued$'
	# Exercise the same missing-nq path through the Newsboat consumer.
	ln -s "$(command -v qndl)" "$T/no-nq/qndl"
	mkdir -p "$HOME/.local/share/newsboat"
	queuefile=$HOME/.local/share/newsboat/queue
	printf '%s\n' 'https://pod.example/no-queue.mp3 "/x"' >"$queuefile"
	cp "$queuefile" "$T/queue.before"
	PATH="$T/no-nq" "$VT_SH" "$REPO/.local/bin/queueandnotify" 2>"$T/err"
	eq "missing nq consumer status" 127 "$?"
	cmp -s "$T/queue.before" "$queuefile" || fail "changed queue with nq missing"
	notlogged '^yt-dlp'
	notlogged '^nq '
}

t_queue_missing_downloader() {
	# Use an explicitly absent executable; no real downloader can be run.
	qndl https://x.example/no-downloader "$T/absent-downloader"
	eq "missing downloader job status" 127 "$(cat "$VT_STATE/status.nq")"
	logged '^notify-send qndl: no-downloader failed \(exit 127\)\.$'
	notlogged '^notify-send 👍'
	eq "one missing-downloader job" 1 "$(nlogged '^nq -cq ')"
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
