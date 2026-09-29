# vertrice-dict: GCIDE and Roget compiled for dictd, run as root on the
# machine. Here a copy of the script sits beside a copy of its data, with
# /etc and /usr/local/share rewritten to $R (see derived in lib.sh). ftp is
# the mock; dictfmt keeps what it reads in $VT_STATE/dictfmt.NAME; dictzip
# and rcctl log.

dict_setup() {
	R=$T/sys
	mkdir -p "$T/x/bin" "$T/x/share" "$R/etc" "$R/share/doc/gcide"
	cp -R "$REPO/.local/share/openbsd" "$T/x/share/"
	derived .local/bin/vertrice-dict x/bin/vertrice-dict \
		"s|/etc/|$R/etc/|g; s|/usr/local/share/|$R/share/|g" >/dev/null
	for m in dictzip rcctl; do ln -s "$VT_MOCKS/_log" "$T/bin/$m"; done
	cat >"$T/bin/dictfmt" <<'EOF'
#!/bin/sh
echo "dictfmt $*" >>"$VT_STATE/log"
for a; do n=$a; done
cat >"$VT_STATE/dictfmt.$n"
EOF
	chmod +x "$T/bin/dictfmt"
	# GCIDE: each file opens with its licence in a comment; an entry is
	# <p><ent>, more <ent> lines for other spellings, then the text.
	cat >"$R/share/doc/gcide/CIDE.A" <<'EOF'
<-- This file is part 1 of the GNU version of
    The Collaborative International Dictionary of English (GCIDE)
-->

<p><-- p. 1 --></p><br/

<p><centered><point26>A.</point26></centered><br/
[<source>1913 Webster</source>]</p>

<p><ent>Abb</ent><br/
<hw>Abb</hw> <pr>(<acr/b)</pr>, <pos>n.</pos> <def>Among weavers, yarn for the warp.<-- note --></def><br/
[<source>1913 Webster</source>]</p>

<p><ent>Aesthetic</ent><br/
<ent>Esthetic</ent><br/
<hw><AE/s*thet"ic</hw> <pr>(<ecr/s)</pr>, <def><ldquo/fine<rdquo/ <hand/ see <udd/</def></p>
EOF
	cat >"$R/share/doc/gcide/CIDE.B" <<'EOF'
<-- This file is part 2 of the GNU version of
-->

<p><ent>Bee</ent><br/
<hw>Bee</hw>, <pos>n.</pos> <def>An insect.</def></p>
EOF
	# Roget, Project Gutenberg #22: CRLF lines, headings #N. between the
	# Gutenberg header and footer, class and section titles in capitals.
	printf '%s\r\n' "The Project Gutenberg eBook of Roget's Thesaurus" "" \
		"*** START OF THE PROJECT GUTENBERG EBOOK ROGET'S THESAURUS ***" "CLASS I" \
		"#1. Existence.—N. existence, being &c. 494; entity[obs3]." \
		"     V. exist, be." "" "SECTION II. RELATION" \
		"#914a. Pity.—N. pity, ruth; being." "#" \
		"*** END OF THE PROJECT GUTENBERG EBOOK ROGET'S THESAURUS ***" \
		"Section 1. General Terms of Use" >"$VT_STATE/out.ftp"
}
dict_run() { "$VT_SH" "$T/x/bin/vertrice-dict" >"$T/out" 2>&1; }

t_dict_compile() {
	dict_setup; dict_run || fail "vertrice-dict failed: $(cat "$T/out")"
	cmp -s "$T/x/share/openbsd/dictd.conf" "$R/etc/dictd.conf" || fail "dictd.conf not installed"
	logged '^dictfmt -c5 -q --without-headword --headword-separator %%% -s GCIDE gcide$'
	logged '^dictzip gcide.dict$'
	eq "gcide as dictfmt -c5 reads it" '_____

Abb
Abb (ab), n. Among weavers, yarn for the warp.
[1913 Webster]

_____

Aesthetic%%%Esthetic
AEs*thet"ic (es), "fine"  see u
_____

Bee
Bee, n. An insect.' "$(cat "$VT_STATE/dictfmt.gcide")"
	logged '^ftp -o pg22.txt https://www.gutenberg.org/cache/epub/22/pg22.txt$'
	logged "^dictfmt -c5 -q --utf8 --without-headword --headword-separator %%% -s Roget's Thesaurus \\(1911\\) roget\$"
	logged '^dictzip roget.dict$'
	eq "roget: a heading's words find it" '_____

existence%%%being%%%entity%%%exist%%%be
#1. Existence.—N. existence, being &c. 494; entity[obs3].
     V. exist, be.
_____

pity%%%ruth%%%being
#914a. Pity.—N. pity, ruth; being.' "$(cat "$VT_STATE/dictfmt.roget")"
	eq "dictd on localhost" "rcctl enable dictd
rcctl set dictd flags --listen-to localhost
rcctl restart dictd" "$(grep '^rcctl' "$VT_STATE/log")"
}

t_dict_fetch_fails() {
	# No Roget text: stop before dictd is started with a missing database.
	dict_setup
	echo 1 >"$VT_STATE/rc.ftp"
	dict_run && fail "vertrice-dict went on without Roget"
	notlogged '^rcctl'
	notlogged 'roget'
}

t_dict_conf() {
	# Both databases, at the paths vertrice-dict writes.
	f=$REPO/.local/share/openbsd/dictd.conf
	for d in gcide roget; do
		grep -q "^database $d {" "$f" || fail "no $d database"
		grep -q "\"/usr/local/share/dictd/$d.index\"" "$f" || fail "no $d index"
		grep -q "\"/usr/local/share/dictd/$d.dict.dz\"" "$f" || fail "no $d data"
	done
	for p in dictd-client dictd-server gcide; do
		grep -qx "$p" "$REPO/.local/share/openbsd/pkglist.extra" || fail "$p not in pkglist.extra"
	done
}
