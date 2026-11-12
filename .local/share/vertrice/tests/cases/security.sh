# Security regressions: untrusted filenames and metadata must stay data.
t_security_booksplit_literal_args() {
	cat >"$T/bin/ffmpeg" <<'EOF'
#!/bin/sh
printf '%s\000' "$@" >"$VT_STATE/ffmpeg.args"
printf x >>"$VT_STATE/ffmpeg.calls"
EOF
	chmod +x "$T/bin/ffmpeg"
	audio='audio $(touch INPUT_EXECUTED).mp3'
	title='One "quoted" $(touch TITLE_EXECUTED) `touch BACKTICK_EXECUTED`'
	last='Two; $(touch LAST_EXECUTED)'
	book='Book $(touch BOOK_EXECUTED)'
	author='Author $(touch AUTHOR_EXECUTED)'
	year='2026 $(touch YEAR_EXECUTED)'
	: >"$audio"
	printf '00:00:00\t%s\n00:10:00\t%s\n' "$title" "$last" >tc
	printf '%s\n' "$book" "$author" "$year" | booksplit "$audio" tc >/dev/null || fail 'booksplit failed'
	for f in INPUT_EXECUTED TITLE_EXECUTED BACKTICK_EXECUTED LAST_EXECUTED BOOK_EXECUTED AUTHOR_EXECUTED YEAR_EXECUTED; do
		[ ! -e "$f" ] || fail "metadata executed: $f"
	done
	eq 'single ffmpeg process' x "$(cat "$VT_STATE/ffmpeg.calls")"
	# NUL separators verify exact argv boundaries, not just a rendered command.
	{
		printf '%s\000' -i "$audio" -nostdin -y
		printf '%s\000' -metadata "artist=$author" -metadata "title=$title" -metadata "album=$book" \
			-metadata "year=$year" -metadata track=1 -metadata total=2 -ss 00:00:00 -to 00:10:00 \
			-vn -c:a copy ./book-touch-bookexecuted/01-one-quoted-touch-titleexecuted-touch-backtickexecuted.mp3
		printf '%s\000' -metadata "artist=$author" -metadata "title=$last" -metadata "album=$book" \
			-metadata "year=$year" -metadata track=2 -metadata total=2 -ss 00:10:00 \
			-vn -c copy ./book-touch-bookexecuted/02-two-touch-lastexecuted.mp3
	} >"$T/expected"
	cmp "$T/expected" "$VT_STATE/ffmpeg.args" || fail 'ffmpeg arguments changed or split'
}

t_security_nvim_no_exit_cleanup() {
	[ -n "$VT_REAL_NVIM" ] || skip 'no native nvim'
	mkdir -p "$XDG_CONFIG_HOME/nvim/autoload"
	cat >"$XDG_CONFIG_HOME/nvim/autoload/plug.vim" <<'EOF'
function! plug#begin(...)
  command! -nargs=+ Plug call len([])
endfunction
function! plug#end()
endfunction
EOF
	printf '#!/bin/sh\necho latexmk >>"$VT_STATE/log"\n' >"$T/bin/latexmk"
	chmod +x "$T/bin/latexmk"
	# No project interpreter should run merely because an ordinary file closes.
	for f in ordinary.tex 'hostile$(touch NVIM_EXECUTED).tex'; do
		printf 'fixture\n' >"$f"
		"$VT_REAL_NVIM" --headless -n -i NONE -u "$REPO/.config/nvim/init.vim" \
			"$T/$f" -c qa >"$T/nvim.out" 2>&1 || fail "nvim failed: $(cat "$T/nvim.out")"
	done
	[ ! -e NVIM_EXECUTED ] || fail 'TeX filename executed shell code'
	notlogged '^latexmk$'
}
