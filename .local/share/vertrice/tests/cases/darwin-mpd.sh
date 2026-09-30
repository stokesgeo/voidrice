# mpd on both systems: one shared mpd.conf, and the sound output in a
# file of each system's own (sndio.conf, osx.conf) that mpd.conf pulls in
# with include_optional. The selection lists place them (select.sh). The
# Mac's launchd agent starts mpd with mpd.conf named. No mpd runs here.
#
# Known (mpd.conf(5), src/config/File.cxx, 0.21 to 0.24.15): include and
# include_optional take a path relative to the including file;
# include_optional skips a file that is not there.

# outputs DIR: the audio_output types mpd would read from DIR/mpd.conf,
# in order, expanding include_optional as mpd does.
outputs() {
	awk -v d="$1" '
	function read(f,   l, a) {
		while ((getline l < f) > 0) {
			if (l ~ /^[ \t]*include_optional[ \t]/) {
				split(l, a, "\"")
				if ((getline _ < (d "/" a[2])) >= 0) { close(d "/" a[2]); read(d "/" a[2]) }
			} else if (l ~ /^[ \t]*type[ \t]/) {
				split(l, a, "\""); printf "%s ", a[2]
			}
		}
		close(f)
	}
	BEGIN { read(d "/mpd.conf") }'
}

# mpd_on FILE: a checkout of the shared mpd.conf with one system's FILE.
mpd_on() {
	rm -rf "$T/mpd"; mkdir -p "$T/mpd"
	cp "$REPO/.config/mpd/mpd.conf" "$REPO/.config/mpd/$1" "$T/mpd/"
}

t_darwin_mpd_outputs() {
	c=$REPO/.config/mpd/mpd.conf
	grep -q '^include_optional "sndio.conf"$' "$c" || fail "no sndio.conf line"
	grep -q '^include_optional "osx.conf"$' "$c" || fail "no osx.conf line"
	grep -Eq 'type[[:space:]]+"(sndio|osx)"' "$c" && fail "a system's output in the shared file"
	mpd_on sndio.conf
	eq "the X220: sndio, then the fifo, as before" "sndio fifo " "$(outputs "$T/mpd")"
	mpd_on osx.conf
	eq "the Mac: CoreAudio, then the fifo" "osx fifo " "$(outputs "$T/mpd")"
}

t_darwin_mpd_agent() {
	ln -s "$VT_MOCKS/_log" "$T/bin/mpd"
	cmd=$(agentcmd vertrice.mpd | sed 's|/opt/homebrew/bin/mpd|mpd|')
	"$VT_SH" -c "$cmd" || fail "agent failed"
	logged "^mpd --no-daemon $HOME/.config/mpd/mpd.conf\$"
	grep -q '<key>RunAtLoad</key>' "$REPO/.local/share/darwin/vertrice.mpd.plist" ||
		fail "not started at login"
}
