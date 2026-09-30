# The Mac's spelling: spellcheck and proof through the spell stand-in in
# ~/.local/bin/darwin, over aspell. mac (darwin-shims.sh) sets uname and
# the stand-ins; aspell here is a mock that logs its arguments and prints
# each word of stdin not in $VT_STATE/dict, in the order read and as
# often as it appears, as `aspell list` does. Nothing here ran on a Mac.

# sp_mac: the Mac, the aspell mock, and the spell lists in place.
sp_mac() {
	mac
	cat >"$T/bin/aspell" <<'EOF'
#!/bin/sh
printf 'aspell|' >>"$VT_STATE/log"; printf '%s|' "$@" >>"$VT_STATE/log"; echo >>"$VT_STATE/log"
tr -cs "A-Za-z'" '\n' | sed "s/^'*//; s/'*\$//; /^\$/d" |
	awk 'FILENAME != "-" { known[tolower($0)] = 1; next } !(tolower($0) in known)' "$VT_STATE/dict" -
EOF
	chmod +x "$T/bin/aspell"
	mkdir -p "$HOME/.local/share/spell" && cp "$REPO/.local/share/spell/contractions" "$HOME/.local/share/spell/"
}

t_darwin_spell_standin() {
	sp_mac
	printf '%s\n' she said the | fx dict
	printf 'Zeb said the zeb. She said teh.\n' >a.md
	eq "sorted, once each" "Zeb
teh
zeb" "$(spell a.md)"
	logged '^aspell\|-d\|en_US\|--encoding=utf-8\|list\|$'
	printf '%s\n' Zeb >w
	eq "a +list passes its words, case-blind" "teh" "$(spell +w a.md)"
	printf 'teh\n' >v
	eq "every +list" "" "$(spell +w +v a.md)"
	eq "stdin with no file" "teh" "$(spell +w <a.md)"
}

# spellcheck is the X220's script, unchanged: its lists reach aspell's
# answer through the stand-in.
t_darwin_spell_spellcheck() {
	sp_mac
	printf '%s\n' she said zeb the to go | fx dict
	d=$HOME/.local/share/spell
	printf "She said Zeb isn't sure.\nZeb said I've to go.\n" >a.md
	eq "flagged in their lines, contractions pass" "1:She said Zeb isn't sure." "$(spellcheck a.md)"
	notlogged '^spell '
	printf 'sure\n' >"$d/words"
	out=$(spellcheck a.md); rc=$?
	eq "own words pass" "" "$out"
	eq "clean: exit 1, as grep" 1 "$rc"
}

t_darwin_spell_brewfile() {
	grep -qx 'brew "aspell"' "$REPO/.local/share/darwin/Brewfile" ||
		fail "aspell is not in the Brewfile"
}
