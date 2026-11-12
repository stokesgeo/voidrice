# bk, the backup script, run from $T with /mnt/backup moved to $T/backup
# (see derived). The mount mock lists that as mounted once disk has run;
# /home is the mock's sd1k. dump is a mock that writes a one-line fake
# dump directly to -f FILE. VT_EPOCH fixes the clock, so prefixes are
# known: 1790000000 is 2026-09-21 14:13 UTC.

now=1790000000

bk_setup() {
	bk=$(derived .local/bin/bk bk "s|/mnt/backup|$T/backup|g")
	mkdir -p "$T/backup"
	cat >"$T/bin/dump" <<'EOF'
#!/bin/sh
echo "dump $*" >>"$VT_STATE/log"
[ "$2" = -f ] && [ "$3" != - ] || exit 99
[ ! -e "$VT_STATE/fail.dump.output" ] || exit 3
printf 'VTDUMP %s\n' "$*" >"$3" || exit 3
rc=$(cat "$VT_STATE/rc.dump" 2>/dev/null || echo 0)
[ "$rc" -eq 0 ] || exit "$rc"
echo completed >>"$VT_STATE/dumpdates"
EOF
	printf '#!/bin/sh\necho gzip >>"$VT_STATE/log"\nexit 99\n' >"$T/bin/gzip"
	# The shared doas mock deliberately executes only shared mocks. Route this
	# fixture's dump explicitly; no other command is executed here.
	cat >"$T/bin/doas" <<'EOF'
#!/bin/sh
echo "doas $*" >>"$VT_STATE/log"
[ "$1" = dump ] || exit 99
shift
exec "$T/bin/dump" "$@"
EOF
	chmod +x "$T/bin/dump" "$T/bin/gzip" "$T/bin/doas"
}
# disk: mount the backup disk (in the mount mock's list only).
disk() {
	mount >/dev/null
	echo "/dev/sd3a on $T/backup type ffs (local, nodev, nosuid)" >>"$VT_STATE/mounts"
}

t_bk_full() {
	bk_setup; disk
	export VT_EPOCH=$now
	with_tty "$VT_KSH" "$bk" full
	f=$(find "$T/backup/dump" -name home.dump)
	logged '^doas dump -0au -f .*/home.dump.part /home$'
	[ -f "$f" ] || fail "no dump file; tty: $(cat "$T/tty.out")"
	eq "the file holds dump's output" "VTDUMP -0au -f $f.part /home" "$(cat "$f")"
	eq "a private directory" "drwx------" "$(ls -ld "$T/backup/dump" | cut -c1-10)"
	[ -z "$(find "$T/backup" -name '*.part')" ] || fail ".part left behind"
	logged '^notify-send 💾 Backup done\. .*/x220-20260921-1413-l0\.[^/]+/home.dump$'
	notlogged '^gzip'
}

t_bk_incr() {
	bk_setup; disk
	export VT_EPOCH=$now
	with_tty "$VT_KSH" "$bk" incr
	logged '^doas dump -1au -f .*/home.dump.part /home$'
	[ -n "$(find "$T/backup/dump" -path '*-l1.*/home.dump')" ] || fail "no level 1 file"
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
	[ -n "$(find "$T/backup" -name home.dump.part)" ] || fail "partial attempt discarded"
	[ ! -e "$VT_STATE/dumpdates" ] || fail "mock recorded failed dump"
	logged '^notify-send 💾 Backup failed\. Attempt kept at '
}

t_bk_repeated_minute_preserves_backups() {
	bk_setup; disk
	export VT_EPOCH=$now
	mkdir -p "$T/backup/dump"
	printf 'old compressed backup\n' >"$T/backup/dump/x220-20260921-1413-l0.dump.gz"
	printf 'recoverable old attempt\n' >"$T/backup/dump/old.part"
	with_tty "$VT_KSH" "$bk" full || fail "first backup failed"
	f=$(find "$T/backup/dump" -name home.dump)
	before=$(cksum <"$f")
	with_tty "$VT_KSH" "$bk" full || fail "second backup failed"
	eq "two completed dumps" 2 "$(find "$T/backup/dump" -name home.dump | wc -l | tr -d ' ')"
	eq "first untouched" "$before" "$(cksum <"$f")"
	eq "old compressed backup kept" 'old compressed backup' "$(cat "$T/backup/dump/x220-20260921-1413-l0.dump.gz")"
	eq "old partial kept" 'recoverable old attempt' "$(cat "$T/backup/dump/old.part")"
}

t_bk_finalization_failure_keeps_completed_dump() {
	bk_setup; disk
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/mv"; chmod +x "$T/bin/mv"
	with_tty "$VT_KSH" "$bk" full && fail "finalization failure reported success"
	f=$(find "$T/backup/dump" -name home.dump.part)
	[ -s "$f" ] || fail "completed dump discarded"
	eq "dump completed before finalization" completed "$(cat "$VT_STATE/dumpdates")"
	logged '^notify-send 💾 Backup finalization failed\. Completed dump kept at '
	notlogged '^rm .*home.dump'
}

t_bk_output_failure_no_mock_dumpdate() {
	bk_setup; disk
	: >"$VT_STATE/fail.dump.output"
	with_tty "$VT_KSH" "$bk" full && fail "output failure reported success"
	[ ! -e "$VT_STATE/dumpdates" ] || fail "mock recorded failed output"
	[ -z "$(find "$T/backup/dump" -name home.dump)" ] || fail "failed dump finalized"
	notlogged '^gzip'
}

t_bk_notification_failure_keeps_completed_dump() {
	bk_setup; disk
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/notify-send"; chmod +x "$T/bin/notify-send"
	with_tty "$VT_KSH" "$bk" full && fail "notification failure not returned"
	f=$(find "$T/backup/dump" -name home.dump)
	[ -s "$f" ] || fail "completed dump removed after notification failure"
	eq "mock dumpdate retained with its dump" completed "$(cat "$VT_STATE/dumpdates")"
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
