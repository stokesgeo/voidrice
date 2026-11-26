# The writing tools: spellcheck, dupwords, proof, sb-words, writemode, and
# nvim's prose settings. spell is a mock (mock/spell) that flags any word
# not in $VT_STATE/dict or a +list; diction and style are logging mocks.

# wr_dict: the mock spell's word list, one word per line on stdin; and the
# spell lists in place, as the dotfiles put them.
wr_dict() {
	fx dict
	mkdir -p "$HOME/.local/share/spell" && cp "$REPO/.local/share/spell/contractions" "$HOME/.local/share/spell/"
}

t_writing_spellcheck_context() {
	printf '%s\n' she the letter said it was an email | wr_dict
	printf 'She recieved the letter.\nIt was an email.\n' >a.md
	eq "flagged words in their lines" "1:She recieved the letter." "$(spellcheck a.md)"
	printf 'It was the letter.\n' >b.md
	out=$(spellcheck b.md); rc=$?
	eq "clean file: exit 1, as grep" 1 "$rc"
	eq "clean file: silent" "" "$out"
}

t_writing_spellcheck_lists() {
	printf '%s\n' she the said to go | wr_dict
	d=$HOME/.local/share/spell
	printf "She said Zeb isn't sure.\nZeb said I've to go.\n" >a.md
	eq "contractions pass" "1:She said Zeb isn't sure.
2:Zeb said I've to go." "$(spellcheck a.md)"
	logged "^spell \\+$d/contractions \\+$d/words a\\.md\$"
	# The own list, as the header says to keep it: sort -f.
	printf '%s\n' sure Zeb | sort -f >"$d/words"
	out=$(spellcheck a.md); rc=$?
	eq "own words pass" "" "$out"
}

t_writing_contractions_sorted() {
	# spell searches its lists by bisection: an unsorted list loses words.
	LC_ALL=C sort -fc "$REPO/.local/share/spell/contractions" 2>&1 ||
		fail "contractions is not sorted with sort -f"
}

t_writing_dupwords() {
	printf 'It was the\nthe end. End of it. She had had\nenough. "Go. Go." And And then\n' >a.md
	out=$(dupwords a.md); rc=$?
	eq "exit 1 when found" 1 "$rc"
	eq "across lines, case ignored, punctuation breaks a run" "a.md:2: the the
a.md:2: had had
a.md:3: And And" "$out"
	printf 'Go. Go.\n' >b.md
	dupwords b.md >/dev/null
	eq "none: exit 0" 0 "$?"
}

# wr_files: a writing directory with files of known ages.
wr_files() {
	WRITING_DIR="$HOME/writing"
	mkdir -p "$WRITING_DIR/part one" "$WRITING_DIR/.git"
	printf 'one two three\n' >"$WRITING_DIR/old.md"
	printf 'four five\n' >"$WRITING_DIR/part one/new.txt"
	printf 'not prose\n' >"$WRITING_DIR/notes.tex"
	printf 'hidden\n' >"$WRITING_DIR/.git/x.md"
	touch -t 202601010000 "$WRITING_DIR/old.md"
	touch -t 202602010000 "$WRITING_DIR/part one/new.txt"
	touch -t 202603010000 "$WRITING_DIR/notes.tex" "$WRITING_DIR/.git/x.md"
}

t_writing_last_file_and_words() {
	out=$(sb-words); rc=$?
	eq "no writing dir: exit 1" 1 "$rc"
	eq "no writing dir: no output" "" "$out"
	wr_files
	eq "newest .md or .txt, hidden dirs skipped" "$WRITING_DIR/part one/new.txt" "$(proof -l)"
	eq "block" "📝2" "$(sb-words)"
	touch "$WRITING_DIR/old.md"
	eq "follows the newest" "📝3" "$(sb-words)"
	fakeblocks
	has "sbar shows it" "net | 📝3 | clock" "$(sbar -1)"
}

t_writing_proof() {
	wr_files
	printf '%s\n' four five | wr_dict
	echo "No phrases in 1 sentence found." >"$VT_STATE/out.diction"
	f="$WRITING_DIR/part one/new.txt"
	out=$(proof)
	has "spelling section" "== spellcheck
== dupwords" "$out"
	has "diction's words" "== diction -s
No phrases in 1 sentence found." "$out"
	logged "^diction -s $f\$"
	logged "^style $f\$"
	proof "$WRITING_DIR/nope.md" 2>/dev/null
	eq "unreadable: exit 1" 1 "$?"
}

t_writing_writemode() {
	# shellcheck disable=SC2016
	printf '#!/bin/sh\necho "nvim $*" >>"$VT_STATE/log"\n' >"$T/bin/nvim"
	chmod +x "$T/bin/nvim"
	writemode
	[ -d "$HOME/writing" ] || fail "writing directory not made"
	logged '^xterm -name write -fullscreen -e nvim \.$'
	printf 'x\n' >"$HOME/writing/a.md"
	writemode
	logged "^xterm -name write -fullscreen -e nvim -c silent! Goyo $HOME/writing/a.md\$"
}

t_writing_writemode_relative_file() {
	mkdir -p "$T/drafts"
	printf 'caller-owned prose\n' >"$T/drafts/a page.md"
	writemode 'drafts/a page.md'
	logged "^xterm -name write -fullscreen -e nvim -c silent! Goyo $T/drafts/a page\.md\$"
	[ ! -e "$HOME/writing/drafts/a page.md" ] || fail 'created a different writing file'
}

t_writing_latest_global_sort() {
	wr_files
	# Multiple stat batches can arrive out of order. Sort every record, not
	# each batch; retain spaces and subsecond timestamp differences.
	cat >"$T/bin/stat" <<'EOF'
#!/bin/sh
printf '100.100000000 %s\n100.900000000 %s\n' "$HOME/writing/old.md" "$HOME/writing/part one/new.txt"
EOF
	printf '#!/bin/sh\nprintf "%%s\\n" "$HOME/writing/old.md"\n' >"$T/bin/ls"
	chmod +x "$T/bin/stat" "$T/bin/ls"
	eq 'globally newest record' "$HOME/writing/part one/new.txt" "$(proof -l)"
}

t_writing_cwm_key() {
	# Super+Control+F2 is the tool layer: bound once, to writemode. cwm -n
	# and the function-name check (config.sh) cover the rest of the line.
	eq "Super+Control+F2" "writemode" \
		"$(awk '$1 == "bind-key" && $2 == "4C-F2" { print $3 }' "$REPO/.config/cwm/cwmrc")"
}

t_writing_nvim_prose() {
	command -v nvim >/dev/null 2>&1 || skip "no nvim on this host"
	# A stand-in for vim-plug, so init.vim loads with no download.
	c=$HOME/.config/nvim
	mkdir -p "$c/autoload" "$HOME/writing/sub"
	ln -s "$REPO/.config/nvim/init.vim" "$c/init.vim"
	cat >"$c/autoload/plug.vim" <<'EOF'
function! plug#begin(...)
endfunction
function! plug#end()
	filetype plugin indent on
endfunction
command! -nargs=+ Plug :
EOF
	q='call writefile([&wrap.&linebreak.&number.&relativenumber.&textwidth.&spell], "'$T/opts'", "a")'
	for f in "$HOME/writing/sub/a.md" "$HOME/writing/b.txt" "$HOME/c.md"; do
		XDG_CONFIG_HOME=$HOME/.config nvim --headless -c "$q" -c 'qa!' "$f" >/dev/null 2>&1
	done
	eq "prose in the writing dir only (wrap lbr nu rnu tw spell)" "110000
110000
101100" "$(cat "$T/opts")"
	# K looks a word up with dict(1) in Markdown and text, anywhere.
	q='call writefile([&keywordprg], "'$T/kp'", "a")'
	for f in "$HOME/c.md" "$HOME/writing/b.txt" "$HOME/d.sh"; do
		XDG_CONFIG_HOME=$HOME/.config nvim --headless -c "$q" -c 'qa!' "$f" >/dev/null 2>&1
	done
	eq "keywordprg: dict for prose" "dict
dict
:Man" "$(cat "$T/kp")"
}

# Exercise ONLY the two source mappings, never the full init/plugin bootstrap.
t_writing_nvim_render_view_mappings() {
	[ -x "$VT_REAL_NVIM" ] || skip 'no native nvim'
	awk '/^[[:space:]]*map <leader>[cp] / { print }' "$REPO/.config/nvim/init.vim" >"$T/mappings.vim"
	eq 'two mappings extracted' 2 "$(wc -l <"$T/mappings.vim" | tr -d ' ')"
	for cmd in compiler opout; do
		cat >"$T/bin/$cmd" <<'EOF'
#!/bin/sh
printf '%s\n' "$#" "$@" >"$VT_STATE/${0##*/}.args"
cat "$1" >"$VT_STATE/${0##*/}.content"
EOF
		chmod +x "$T/bin/$cmd"
	done
	cat >"$T/check.vim" <<'EOF'
let mapleader = ','
execute 'source ' . fnameescape($T . '/mappings.vim')
execute 'edit ' . fnameescape($OP_FILE)
call setline(1, 'saved render')
normal ,c
call setline(1, 'unsaved view')
normal ,p
call writefile([string(&modified), getline(1)], $T . '/buffer-state')
qa!
EOF
	# Literal harmless shell/Ex special characters, including both quotes.
	for name in 'a page' 'dollar$OPTEST' 'bang!' 'percent%' 'hash#' "single'quote" 'double"quote' 'all$ ! % # '\''"'; do
		file=$T/$name.md
		printf 'original\n' >"$file"
		OPTEST=EXPANDED OP_FILE="$file" "$VT_REAL_NVIM" --headless -u NONE -i NONE -n -S "$T/check.vim" >"$T/nvim.out" 2>&1 || fail "isolated nvim: $name"
		for cmd in compiler opout; do
			eq "$cmd gets one literal absolute argument" "1
$file" "$(cat "$VT_STATE/$cmd.args")"
			eq "$cmd sees saved disk contents" 'saved render' "$(cat "$VT_STATE/$cmd.content")"
		done
		eq ',c saved; ,p did not save' 'saved render' "$(cat "$file")"
		eq ',p leaves modified buffer' '1
unsaved view' "$(cat "$T/buffer-state")"
	done
}

# compiler's Markdown order, the owner's pick: lowdown into groff, then
# pandoc if installed, else a message. groffdown (no port) is gone.
cm_mock() { for v; do ln -s "$VT_MOCKS/_log" "$T/bin/$v"; done; }
cm_nohost() {
	for v; do
		PATH=$syspath command -v "$v" >/dev/null 2>&1 && skip "this host has $v"
	done
	return 0
}

t_compiler_markdown_lowdown() {
	cm_mock lowdown groff pandoc
	: >"$T/doc.md"
	compiler "$T/doc.md"
	logged '^lowdown --parse-no-intraemph --roff-no-numbered .*doc\.md -Tms$'
	logged '^groff -mpdfmark -ms -kept -T pdf$'
	notlogged '^pandoc'
	notlogged 'groffdown'
}

t_compiler_markdown_paths() {
	cm_mock lowdown groff pandoc
	printf 'mock PDF\n' >"$VT_STATE/out.groff"
	mkdir -p 'part one'
	for name in doc 'a page'; do
		for file in "$name.md" "./$name.md" "part one/$name.md" "$T/part one/$name.md"; do
			printf '# Source retained\n' >"$file"
			cp "$file" "$T/original"
			: >"$VT_STATE/log"
			compiler "$file" || fail "compile $file"
			eq "adjacent output: $file" 'mock PDF' "$(cat "${file%.md}.pdf")"
			cmp -s "$T/original" "$file" || fail "source changed: $file"
			has 'correct source passed to lowdown' \
				"lowdown --parse-no-intraemph --roff-no-numbered ./${file##*/} -Tms" "$(cat "$VT_STATE/log")"
			notlogged '^pandoc'
			rm "${file%.md}.pdf"
		done
	done
}

t_compiler_markdown_native() {
	for tool in lowdown groff pdftotext; do
		PATH=$syspath command -v "$tool" >/dev/null 2>&1 || skip "no native $tool"
	done
	printf '# First heading\n\nFirst body.\n\n## Second heading\n\nSecond body.\n\n### Third heading\n\nThird body.\n' >'native page.md'
	cp 'native page.md' original
	PATH=$syspath "$VT_SH" "$REPO/.local/bin/compiler" 'native page.md' || fail 'native compiler'
	cmp -s original 'native page.md' || fail 'native source changed'
	[ -s 'native page.pdf' ] || fail 'native PDF missing'
	PATH=$syspath pdftotext -layout 'native page.pdf' native.txt || fail 'PDF text extraction'
	for heading in First Second Third; do
		grep -Eq "^[[:space:]]*$heading heading[[:space:]]*$" native.txt || fail "numbered or missing $heading heading"
	done
	PATH=$syspath lowdown --parse-no-intraemph --roff-no-numbered 'native page.md' -Tms >native.ms || fail 'native roff'
	eq 'heading macro depths retained' '.SH 1
.SH 2
.SH 3' "$(grep '^\.SH ' native.ms)"
	! grep -q '^\.NH' native.ms || fail 'numbered heading macro'
	# Native render + candidate opener: only the viewer submission is stubbed.
	cat >"$T/bin/detach" <<'EOF'
#!/bin/sh
printf '%s\n' "$#" "$@" >"$VT_STATE/native-launch"
EOF
	chmod +x "$T/bin/detach"
	mkdir elsewhere alias
	(cd elsewhere && opout "$T/native page.md") || fail 'native output submission'
	eq 'native exact output' "2
xdg-open
$T/native page.pdf" "$(cat "$VT_STATE/native-launch")"
	ln -s '../native page.md' alias/linked.md
	PATH=$syspath "$VT_SH" "$REPO/.local/bin/compiler" alias/linked.md || fail 'native symlink render'
	[ -s alias/linked.pdf ] || fail 'native alias PDF missing'
	(cd elsewhere && opout ../alias/linked.md) || fail 'native symlink output submission'
	eq 'native final source symlink identity' "2
xdg-open
$T/alias/linked.pdf" "$(cat "$VT_STATE/native-launch")"
}

t_compiler_markdown_pandoc() {
	cm_nohost lowdown
	cm_mock groff pandoc
	: >"$T/doc.md"
	compiler "$T/doc.md"
	logged '^pandoc -t ms --highlight-style=kate -s -o .*doc\.pdf .*doc\.md$'
}

t_compiler_markdown_none() {
	cm_nohost lowdown pandoc
	: >"$T/doc.md"
	compiler "$T/doc.md" 2>/dev/null && fail "exit 0 with nothing to build with"
	return 0
}

t_compiler_cpp_uses_cxx() {
	cm_mock c++
	ln -s "$VT_MOCKS/_log" "$T/a"
	: >"$T/a.cpp"
	compiler "$T/a.cpp" >/dev/null 2>&1 || fail 'compile/run C++'
	logged '^c\+\+ \./a\.cpp -o \./a$'
	logged '^a '
}
