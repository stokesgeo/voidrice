# bk, the backup script, run from $T with /mnt/backup moved to $T/backup
# (see derived). The mount mock lists that as mounted once disk has run;
# /home is the mock's sd1k. dump is a mock that writes a one-line fake
# dump; gzip is the real one. VT_EPOCH fixes the clock, so file names are
# known: 1790000000 is 2026-09-21 14:13 UTC.

now=1790000000

bk_setup() { bk=$(derived .local/bin/bk bk "s|/mnt/backup|$T/backup|g"); mkdir -p "$T/backup"; }
# disk: mount the backup disk (in the mount mock's list only).
disk() {
	mount >/dev/null
	echo "/dev/sd3a on $T/backup type ffs (local, nodev, nosuid)" >>"$VT_STATE/mounts"
}

t_bk_full() {
	bk_setup; disk
	export VT_EPOCH=$now
	with_tty "$VT_KSH" "$bk" full
	f=$T/backup/dump/x220-20260921-1413-l0.dump.gz
	logged '^doas dump -0au -f - /home$'
	[ -f "$f" ] || fail "no dump file; tty: $(cat "$T/tty.out")"
	eq "the file holds dump's output" "VTDUMP -0au -f - /home" "$(gzip -dc "$f")"
	eq "a private directory" "drwx------" "$(ls -ld "$T/backup/dump" | cut -c1-10)"
	[ -z "$(find "$T/backup" -name '*.part')" ] || fail ".part left behind"
	logged '^notify-send 💾 Backup done\. x220-20260921-1413-l0\.dump\.gz$'
}

t_bk_incr() {
	bk_setup; disk
	export VT_EPOCH=$now
	with_tty "$VT_KSH" "$bk" incr
	logged '^doas dump -1au -f - /home$'
	[ -f "$T/backup/dump/x220-20260921-1413-l1.dump.gz" ] || fail "no level 1 file"
}

t_bk_refuses_unmounted() {
	# The directory exists but is not a mount point: the laptop's disk.
	bk_setup
	for cmd in full incr; do
		with_tty "$VT_KSH" "$bk" $cmd && fail "bk $cmd ran without the disk"
	done
	notlogged '^(doas|dump)'
	logged '^notify-send 💾 Mount the backup disk first'
	[ -z "$(ls "$T/backup")" ] || fail "wrote to the unmounted directory"
}

t_bk_dump_fails() {
	bk_setup; disk
	echo 3 >"$VT_STATE/rc.dump"
	with_tty "$VT_KSH" "$bk" full && fail "exit 0 after a failed dump"
	[ -z "$(find "$T/backup" -type f)" ] || fail "a file was left: $(find "$T/backup" -type f)"
	logged '^notify-send 💾 Backup failed\.$'
}

t_bk_reopens_in_terminal() {
	bk_setup; disk
	"$VT_KSH" "$bk" full </dev/null
	logged "^xterm -name floatterm -geometry 80x16 -e $bk full\$"
	notlogged '^doas'
	"$VT_KSH" "$bk" backup 2>"$T/err" && fail "unknown command accepted"
	has "usage shown" "bk full|incr" "$(cat "$T/err")"
}

# xprofile's reminder: dump -w lists /home once it is due (fstab's
# dump-frequency field, set to 7 on the /home line).
t_bk_reminder() {
	line=$(grep '^dump -w' "$REPO/.xprofile") || fail "xprofile has no dump -w reminder"
	"$VT_SH" -c "${line%&}"
	notlogged '^notify-send'
	printf '   sd1k\t( /home) Last dump: Level 1, Date Mon Sep 14 09:00\n' >"$VT_STATE/dumpw"
	"$VT_SH" -c "${line%&}"
	logged '^notify-send 💾 Backup due\.'
}
