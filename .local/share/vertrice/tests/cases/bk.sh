# bk, the backup script. The backup disk is a directory $T/backup that the
# mount mock lists as a mounted FFS volume; /home is the mock's sd1k. dump
# and restore are mocks that pass a one-line fake dump between them; gzip
# is the real one. VT_EPOCH fixes the clock, so file names are known:
# 1790000000 is 2026-09-21 14:13 UTC.

now=1790000000
day=86400

# disk: mount the backup disk (in the mount mock's list only).
disk() {
	mount >/dev/null
	echo "/dev/sd3a on $T/backup type ffs (local, nodev, nosuid)" >>"$VT_STATE/mounts"
	mkdir -p "$T/backup"
	export BK_DIR="$T/backup"
}
# stampfile KIND AGE: a record of a good KIND run AGE seconds before $now.
stampfile() {
	mkdir -p "$HOME/.local/state/bk"
	echo "$((now - $2)) x220-test-$1" >"$HOME/.local/state/bk/$1"
}
# fakedump NAME ARGS: a gzipped dump the restore mock accepts.
fakedump() {
	mkdir -p "$T/backup/dump"
	_n=$1; shift
	echo "VTDUMP $*" | gzip -c >"$T/backup/dump/$_n"
}

t_bk_full() {
	disk
	export VT_EPOCH=$now
	with_tty bk full
	f=$T/backup/dump/x220-20260921-1413-l0.dump.gz
	logged '^doas true$'
	logged '^doas dump -0au -f - /home$'
	[ -f "$f" ] || fail "no dump file; tty: $(cat "$T/tty.out")"
	eq "the file holds dump's output" "VTDUMP -0au -f - /home" "$(gzip -dc "$f")"
	eq "mode 600" "-rw-------" "$(ls -l "$f" | cut -c1-10)"
	[ -z "$(find "$T/backup" -name '*.part')" ] || fail ".part left behind"
	eq "stamp" "$now x220-20260921-1413-l0.dump.gz" "$(cat "$HOME/.local/state/bk/full")"
	logged '^notify-send 💾 Backup done\. x220-20260921-1413-l0\.dump\.gz$'
}

t_bk_incr() {
	disk
	export VT_EPOCH=$now
	with_tty bk incr
	logged '^doas dump -1au -f - /home$'
	[ -f "$T/backup/dump/x220-20260921-1413-l1.dump.gz" ] || fail "no level 1 file"
	[ -f "$HOME/.local/state/bk/incr" ] || fail "no incr stamp"
	[ -f "$HOME/.local/state/bk/full" ] && fail "incr stamped as full"
	return 0
}

t_bk_refuses_unmounted() {
	# The directory exists but is not a mount point: the laptop's disk.
	mkdir -p "$T/backup"
	export BK_DIR="$T/backup"
	for cmd in full incr restore-test; do
		bk $cmd </dev/null 2>"$T/err" && fail "bk $cmd ran without the disk"
		has "bk $cmd says why" "is not mounted" "$(cat "$T/err")"
	done
	notlogged '^(doas|dump|restore|xterm)'
	logged "^notify-send 💾 Backup $T/backup is not mounted"
	[ -z "$(ls "$T/backup")" ] || fail "wrote to the unmounted directory"
}

t_bk_dump_fails() {
	disk
	echo 3 >"$VT_STATE/rc.dump"
	with_tty bk full
	[ -z "$(find "$T/backup" -type f)" ] || fail "a file was left: $(find "$T/backup" -type f)"
	[ -f "$HOME/.local/state/bk/full" ] && fail "failure stamped"
	logged '^notify-send 💾 Backup Level 0 dump of /home failed\.$'
}

t_bk_reopens_in_terminal() {
	disk
	bk full </dev/null
	logged "^xterm -name floatterm -geometry 80x16 -e $REPO/.local/bin/bk full\$"
	TERMINAL=st bk incr </dev/null
	logged "^st -n floatterm -g 80x16 -e $REPO/.local/bin/bk incr\$"
	notlogged '^doas'
}

t_bk_unknown_command() {
	bk backup 2>"$T/err" && fail "unknown command accepted"
	has "usage shown" "bk full" "$(cat "$T/err")"
	notlogged '^(doas|dump|restore)'
}

t_bk_restore_test() {
	disk
	export BK_FS=$T	# so HOME ($T/home) is ./home in the dump
	fakedump x220-20260920-0900-l0.dump.gz -0au -f - "$T"
	fakedump x220-20260901-0900-l0.dump.gz old
	printf '         2\t.\n       100\t./home\n       101\t./home/.profile\n       102\t./home/notes/todo\n' >"$VT_STATE/toc"
	bk restore-test >"$T/out" 2>&1 || fail "default key file not found: $(cat "$T/out")"
	logged '^restore -tf -$'
	logged '^restore TMPDIR set$'
	logged "^restore-read VTDUMP -0au -f - $T\$"
	notlogged 'restore-read VTDUMP old'
	mkdir -p "$HOME/.config/bk"
	printf '# keys\nnotes/todo\n.profile\nnotes/gone\n' >"$HOME/.config/bk/keyfiles"
	bk restore-test >"$T/out" 2>&1 && fail "missing key file passed"
	has "names the missing file" "lacks: ./home/notes/gone" "$(cat "$T/out")"
	hasnt "not the present ones" "notes/todo " "$(cat "$T/out")"
	# A newer incremental is read through; a broken one fails the test.
	printf 'notes/todo\n' >"$HOME/.config/bk/keyfiles"
	fakedump x220-20260921-0900-l1.dump.gz -1au -f - "$T"
	: >"$VT_STATE/log"
	bk restore-test >"$T/out" 2>&1 || fail "good pair failed: $(cat "$T/out")"
	logged "^restore-read VTDUMP -1au"
	echo garbage | gzip -c >"$T/backup/dump/x220-20260921-0900-l1.dump.gz"
	bk restore-test >"$T/out" 2>&1 && fail "broken incremental passed"
	has "names it" "x220-20260921-0900-l1.dump.gz does not read back" "$(cat "$T/out")"
	# Nothing of the live system is written: only the backup disk, the
	# state directory, and restore's own scratch directory, since removed.
	rm -f "$T/backup/dump/"*l0*
	bk restore-test >"$T/out" 2>&1 && fail "passed with no full dump"
	has "no full" "no full dump of x220" "$(cat "$T/out")"
}

t_bk_remind() {
	export VT_EPOCH=$now
	bk remind
	logged '^notify-send 💾 No backup yet\.'
	: >"$VT_STATE/log"
	stampfile full $((6 * day))
	bk remind
	notlogged notify-send
	stampfile full $((7 * day))
	bk remind
	notlogged notify-send	# exactly 7 days is not older than 7
	stampfile full $((7 * day + 1))
	bk remind
	logged '^notify-send 💾 Backup is 7 days old\.'
	: >"$VT_STATE/log"
	stampfile incr $((2 * day))	# a fresh incremental counts
	bk remind
	notlogged notify-send
	stampfile incr $((20 * day))
	BK_DAYS=30 bk remind
	notlogged notify-send
	bk remind
	logged '^notify-send 💾 Backup is 7 days old\.'
}

t_bk_status() {
	export VT_EPOCH=$now
	stampfile full $((9 * day + 5))
	stampfile incr 60
	out=$(bk status)
	eq "status" "full     9 days ago  x220-test-full
incr     0 days ago  x220-test-incr" "$out"
	rm "$HOME/.local/state/bk/incr"
	eq "never" "incr  never" "$(bk status | sed -n 2p)"
}

t_bk_xprofile() {
	# The reminder runs from xprofile, in the background.
	grep -q '^bk remind &' "$REPO/.xprofile" || fail "xprofile does not run bk remind"
}
