t_tag_cleanup_literal_path() {
	cat >"$T/bin/mktemp" <<'EOF'
#!/bin/sh
[ "$1" = -p ] || exit 2
printf '%s\n' "$2/tmp.fixed" >"$VT_STATE/temp-path"
: >"$2/tmp.fixed" || exit 1
printf '%s\n' "$2/tmp.fixed"
EOF
	cat >"$T/bin/ffmpeg" <<'EOF'
#!/bin/sh
[ "$1" = -i ] || exit 2
cmp "$2" "$VT_STATE/audio" || exit 3
printf '%s\000' "$@" >"$VT_STATE/ffmpeg.args"
if [ "$TAG_SIGNAL" = TERM ]; then
	kill -TERM "$PPID" || exit 4
fi
exit "$TAG_STATUS"
EOF
	cat >"$T/bin/rm" <<'EOF'
#!/bin/sh
printf 'cleanup\n' >>"$VT_STATE/cleanup.calls"
exec "$VT_REAL_RM" "$@"
EOF
	chmod +x "$T/bin/mktemp" "$T/bin/ffmpeg" "$T/bin/rm"
	mkdir -p 'tag space*glob' 'spaceXglob'
	printf 'synthetic audio\n' >'tag space*glob/chapter.mp3'
	cp 'tag space*glob/chapter.mp3' "$VT_STATE/audio"
	for mode in success failure signal; do
		printf 'sentinel\n' >tag
		printf 'sentinel\n' >spaceXglob/tmp.fixed
		printf 'sentinel\n' >"$T/sentinel"
		case $mode in
		success) TAG_STATUS=0 TAG_SIGNAL= ;;
		failure) TAG_STATUS=23 TAG_SIGNAL= ;;
		signal) TAG_STATUS=0 TAG_SIGNAL=TERM ;;
		esac
		export TAG_STATUS TAG_SIGNAL
		: >"$VT_STATE/cleanup.calls"
		unset TMPDIR
		"$VT_SH" "$REPO/.local/bin/tag" -t Title -a Artist -A Album -n 1 \
			'./tag space*glob/chapter.mp3' >"$T/out" 2>"$T/err"
		status=$?
		if [ "$mode" = signal ]; then
			eq 'TERM and EXIT cleanup handlers ran' 2 "$(wc -l <"$VT_STATE/cleanup.calls" | tr -d ' ')"
		else
			eq 'EXIT cleanup handler ran' 1 "$(wc -l <"$VT_STATE/cleanup.calls" | tr -d ' ')"
		fi
		[ "$mode" != failure ] || eq 'ffmpeg failure status preserved' 23 "$status"
		[ "$mode" != success ] || eq 'success status preserved' 0 "$status"
		cmp tag "$T/sentinel" || fail "$mode cleanup removed split-prefix sentinel"
		cmp spaceXglob/tmp.fixed "$T/sentinel" || fail "$mode cleanup expanded a wildcard"
		cmp 'tag space*glob/chapter.mp3' "$VT_STATE/audio" || fail 'fixture input changed'
		[ ! -e 'tag space*glob/tmp.fixed' ] || fail "$mode temporary copy leaked"
		{
			printf '%s\000' -i './tag space*glob/tmp.fixed' -map 0 -y -codec copy \
				-metadata title=Title -metadata album=Album -metadata artist=Artist \
				-metadata track=1 './tag space*glob/chapter.mp3'
		} >"$T/expected"
		cmp "$T/expected" "$VT_STATE/ffmpeg.args" || fail 'ffmpeg argv changed'
	done
}
