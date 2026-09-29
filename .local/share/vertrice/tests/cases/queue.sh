# The download queue: qndl on nq (mock/nq runs each job in the
# foreground), queueandnotify, sb-tasks, and the callers' queue entries.

# yt-dlp is a package, not base: a stand-in in $T/bin that logs each
# argument in brackets, so a case sees how the words were split.
fx_ytdlp() {
	cat >"$T/bin/yt-dlp" <<'EOF'
#!/bin/sh
l=yt-dlp; for a; do l="$l [$a]"; done
echo "$l" >>"$VT_STATE/log"
exit "$(cat "$VT_STATE/rc.yt-dlp" 2>/dev/null || echo 0)"
EOF
	chmod +x "$T/bin/yt-dlp"
}
qdir() { printf '%s\n' "$XDG_CACHE_HOME/qndl"; }

t_queue_qndl_default() {
	fx_ytdlp
	qndl 'https://www.youtube.com/watch?v=abc' || fail "qndl failed"
	logged '^notify-send ⏳ Queuing watch\?v=abc\.\.\.$'
	logged '^nq -c -q sh -c '
	logged '^yt-dlp \[--embed-metadata\] \[-ic\] \[https://www\.youtube\.com/watch\?v=abc\]$'
	logged '^notify-send 👍 watch\?v=abc done\.$'
	eq "queue is private" drwx------ "$(ls -ld "$(qdir)" | cut -c1-10)"
	eq "done job file removed (-c)" "" "$(ls "$(qdir)")"
}

t_queue_qndl_command_words() {
	fx_ytdlp
	# dmenuhandler's audio entry: the quotes in the command group words.
	qndl 'https://x.example/v/1' 'yt-dlp -o "%(title)s.%(ext)s" -f bestaudio' ||
		fail "qndl failed"
	logged '^yt-dlp \[-o\] \[%\(title\)s\.%\(ext\)s\] \[-f\] \[bestaudio\] \[https://x\.example/v/1\]$'
	# The URL is an argument, never shell text.
	: >"$VT_STATE/log"
	qndl 'https://x.example/a;touch${IFS}pwned' || fail "qndl failed"
	[ -e "$T/pwned" ] && fail "the URL ran as a command"
	logged '^yt-dlp \[--embed-metadata\] \[-ic\] \[https://x\.example/a;touch\$\{IFS\}pwned\]$'
}

t_queue_qndl_ftp_rename() {
	: >"$VT_STATE/ftp.byname"
	echo audio | fx out.ftp
	qndl 'https://pod.example/ep/Show%20One.mp3?source=rss' ftp || fail "qndl failed"
	logged '^ftp https://pod\.example/ep/Show%20One\.mp3\?source=rss$'
	[ -f "$T/Show One.mp3" ] || fail "not renamed: $(ls "$T")"
	eq "content" audio "$(cat "$T/Show One.mp3")"
	logged '^notify-send 👍 Show One\.mp3 done\.$'
}

t_queue_qndl_failure() {
	fx_ytdlp
	echo 1 >"$VT_STATE/rc.yt-dlp"
	qndl 'https://x.example/v/2'
	logged '^notify-send ❌ 2 failed\.$'
	notlogged 'done\.$'
	n=$(ls "$(qdir)" | wc -l | tr -d ' ')
	eq "failed job kept for fq -a" 1 "$n"
	has "its status" "[exited with status 1.]" "$(cat "$(qdir)"/,*)"
}

t_queue_qndl_no_url() {
	qndl || fail "no URL: nonzero exit"
	notlogged '^nq'
}

t_queue_queueandnotify() {
	: >"$VT_STATE/ftp.byname"
	mkdir -p "$HOME/.local/share/newsboat"
	printf '%s\n' 'https://pod.example/a.mp3 "/home/u/a.mp3"' '' \
		'https://pod.example/b.ogg	"/home/u/b.ogg"' >"$HOME/.local/share/newsboat/queue"
	queueandnotify
	eq "one job per URL" 2 "$(nlogged '^nq ')"
	logged '^ftp https://pod\.example/a\.mp3$'
	logged '^ftp https://pod\.example/b\.ogg$'
	[ -f "$T/a.mp3" ] && [ -f "$T/b.ogg" ] || fail "files not saved: $(ls "$T")"
	eq "queue emptied" "" "$(tr -d '\n' <"$HOME/.local/share/newsboat/queue")"
}

t_queue_linkhandler_audio() {
	: >"$VT_STATE/ftp.byname"
	linkhandler 'https://pod.example/c.opus'
	logged '^nq -c -q sh -c '
	logged '^ftp https://pod\.example/c\.opus$'
}

t_queue_dmenuhandler_entries() {
	fx_ytdlp
	answers "queue yt-dlp audio"
	dmenuhandler 'https://x.example/v/3'
	logged '^yt-dlp \[-o\] \[%\(title\)s\.%\(ext\)s\] \[-f\] \[bestaudio\] \[--embed-metadata\] \[--restrict-filenames\] \[https://x\.example/v/3\]$'
}

t_queue_newsboat_macros() {
	f=$REPO/.config/newsboat/config
	hasnt "no task-spooler left" "tsp" "$(cat "$f")"
	has "t queues" 'macro t set browser "qndl"' "$(cat "$f")"
	# newsboat puts the URL, single-quoted, where %u is (view.cpp).
	cmd=$(sed -n 's/^macro a set browser "\(.*\)" ; open-in-browser.*/\1/p' "$f")
	fx_ytdlp
	eval "$(printf '%s' "$cmd" | sed "s|%u|'https://x.example/v/4'|")"
	logged '^yt-dlp \[--embed-metadata\] \[-xic\] \[-f\] \[bestaudio/best\] \[--restrict-filenames\] \[https://x\.example/v/4\]$'
}

# sb-tasks: live job files carry the PID of a live process. The x bit
# marks the running one.
t_queue_sb_tasks() {
	eq "no queue directory: nothing" "" "$(sb-tasks)"
	d=$(qdir); mkdir -p "$d"
	"$VT_REAL_SLEEP" 30 & p1=$!; track "$p1"
	"$VT_REAL_SLEEP" 30 & p2=$!; track "$p2"
	"$VT_REAL_SLEEP" 30 & p3=$!; track "$p3"
	sh -c 'exit 0' & dead=$!; wait "$dead"
	: >"$d/,00000000001.$p1"; chmod u+x "$d/,00000000001.$p1"
	: >"$d/,00000000002.$p2"
	: >"$d/,00000000003.$p3"
	: >"$d/,00000000000.$dead"
	: >"$d/.,00000000004.$p1"	# nq's name before the lock is taken
	eq "one running, two queued, finished one left out" "🤖3(2)" "$(sb-tasks)"
	kill "$p1" "$p2" "$p3"; wait 2>/dev/null
	eq "all done: nothing" "" "$(sb-tasks)"
}

t_queue_nq_mock_flags() {
	nq -x true 2>/dev/null && fail "nq mock took -x"
	NQDIR=$T/q nq -q true || fail "nq -q failed"
	NQDIR=$T/q nq -w || fail "nq -w failed"
	return 0
}
