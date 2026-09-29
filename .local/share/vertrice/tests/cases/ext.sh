# ext: every archive type it names. Archives are built here with the same
# tools ext uses; a type whose tool is missing on this host is skipped.

# tree: a small directory to archive, d/f.txt holding "hello".
tree() { mkdir -p "$T/src/d" && echo hello >"$T/src/d/f.txt"; }
need() { for t; do command -v "$t" >/dev/null 2>&1 || skip "no $t on this host"; done; }

# unpacks ARCHIVE: ext must extract d/f.txt in a fresh directory.
unpacks() {
	rm -rf "$T/x" && mkdir "$T/x" && cp "$T/src/$1" "$T/x/" || fail "setup $1"
	(cd "$T/x" && ext "$1") || fail "ext $1: nonzero exit"
	eq "$1 extracted" hello "$(cat "$T/x/d/f.txt" 2>/dev/null)"
}
# decompresses FILE.EXT: a single compressed file, the original kept.
decompresses() {
	rm -rf "$T/x" && mkdir "$T/x" && cp "$T/src/$1" "$T/x/" || fail "setup $1"
	(cd "$T/x" && ext "$1") || fail "ext $1: nonzero exit"
	eq "$1 decompressed" hello "$(cat "$T/x/${1%.*}" 2>/dev/null)"
	[ -f "$T/x/$1" ] || fail "$1: original removed"
}

t_ext_tar() {
	need tar gzip bzip2 xz zstd
	tree; cd "$T/src" || exit 1
	tar cf a.tar d
	gzip -c a.tar >a.tar.gz; cp a.tar.gz a.tgz
	bzip2 -c a.tar >a.tar.bz2; cp a.tar.bz2 a.tbz2; cp a.tar.bz2 a.tbz
	xz -c a.tar >a.tar.xz; cp a.tar.xz a.txz
	zstd -qc a.tar >a.tar.zst; cp a.tar.zst a.tzst
	for a in a.tar a.tar.gz a.tgz a.tar.bz2 a.tbz2 a.tbz a.tar.xz a.txz a.tar.zst a.tzst; do
		unpacks "$a"
	done
}

t_ext_tar_Z() {
	need tar compress
	tree; cd "$T/src" || exit 1
	tar cf - d | compress -c >a.tar.Z; cp a.tar.Z a.taz
	unpacks a.tar.Z; unpacks a.taz
}

t_ext_single() {
	need gzip bzip2 xz zstd
	tree; cd "$T/src" || exit 1
	echo hello >one
	gzip -c one >one.gz; bzip2 -c one >one.bz2; xz -c one >one.xz; zstd -qc one >one.zst
	for a in one.gz one.bz2 one.xz one.zst; do decompresses "$a"; done
}

t_ext_single_Z() {
	need compress
	tree; cd "$T/src" || exit 1
	echo hello >one; compress -c one >one.Z
	decompresses one.Z
}

t_ext_zip() {
	tree; cd "$T/src" || exit 1
	if command -v zip >/dev/null 2>&1; then zip -qr a.zip d
	elif command -v 7z >/dev/null 2>&1; then 7z a -tzip a.zip d >/dev/null
	else skip "nothing here makes a zip"; fi
	need unzip
	cp a.zip a.jar; cp a.zip a.epub
	for a in a.zip a.jar a.epub; do unpacks "$a"; done
}

t_ext_7z() {
	need 7z
	tree; cd "$T/src" || exit 1
	7z a a.7z d >/dev/null
	unpacks a.7z
	# -aos: a file that exists is skipped, not overwritten.
	echo keep >"$T/x/d/f.txt"
	(cd "$T/x" && ext a.7z)
	eq "7z does not overwrite" keep "$(cat "$T/x/d/f.txt")"
}

t_ext_rar() {
	need rar 7z
	tree; cd "$T/src" || exit 1
	rar a -r -inul a.rar d
	unpacks a.rar
}

t_ext_iso() {
	need 7z
	tree; cd "$T/src" || exit 1
	if command -v xorriso >/dev/null 2>&1; then xorriso -as mkisofs -quiet -r -J -o a.iso d
	elif command -v mkisofs >/dev/null 2>&1; then mkisofs -quiet -r -J -o a.iso d
	elif command -v genisoimage >/dev/null 2>&1; then genisoimage -quiet -r -J -o a.iso d
	else skip "nothing here makes an ISO image"; fi
	# mkisofs puts the contents of d at the image root.
	mkdir -p "$T/x" && cp a.iso "$T/x/" && (cd "$T/x" && ext a.iso) || fail "ext a.iso"
	eq "a.iso extracted" hello "$(cat "$T/x/f.txt" 2>/dev/null)"
}

t_ext_no_overwrite() {
	need gzip
	echo new >one; gzip one; echo keep >one
	err=$(ext one.gz 2>&1); rc=$?
	eq "exit status" 1 "$rc"
	eq "message" "ext: one exists, skipped" "$err"
	eq "file kept" keep "$(cat one)"
}

t_ext_unknown_and_missing() {
	echo x >notes.txt
	err=$(ext notes.txt 2>&1); rc=$?
	eq "unknown: exit status" 1 "$rc"
	eq "unknown: message" "ext: notes.txt: unknown archive type" "$err"
	err=$(ext nothere.gz 2>&1); rc=$?
	eq "missing: exit status" 1 "$rc"
	eq "missing: message" "ext: nothere.gz: no such file" "$err"
	err=$(ext 2>&1); rc=$?
	eq "no arguments: exit status" 1 "$rc"
}

t_ext_dash_name() {
	need tar gzip
	tree; cd "$T/src" || exit 1
	echo hello >one; gzip -c one >./-one.gz
	tar czf ./-a.tar.gz d
	mkdir "$T/x" && cp ./-one.gz ./-a.tar.gz "$T/x/" && cd "$T/x" || exit 1
	ext -one.gz -a.tar.gz || fail "nonzero exit"
	eq "-one.gz decompressed to -one" hello "$(cat ./-one)"
	eq "-a.tar.gz extracted" hello "$(cat d/f.txt)"
}

t_ext_bad_archive() {
	need gzip
	echo "not gzip" >junk.gz
	ext junk.gz 2>/dev/null; rc=$?
	eq "exit status" 1 "$rc"
	[ -e junk ] && fail "partial output left behind"
	# One bad file does not stop the rest.
	echo hello >good; gzip good
	ext junk.gz good.gz 2>/dev/null; rc=$?
	eq "exit status with one bad" 1 "$rc"
	eq "the good one extracted" hello "$(cat good)"
}
