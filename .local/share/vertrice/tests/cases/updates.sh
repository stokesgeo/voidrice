# The update notice: root's cron line (openbsd/updates.cron) lists what
# syspatch -c and pkg_add -u -n -v would install in /var/db/updates;
# sb-updates counts the lines; sb-popupgrade installs them in a terminal.
# /var/db/updates is $T/updates here (derived, lib.sh).

up_setup() {
	sub="s|/var/db/updates|$T/updates|g"
	bar=$(derived .local/bin/statusbar/sb-updates sb-updates "$sub")
	# The cron job's command: field 6 on, without cron's -ns.
	cut -f6- "$REPO/.local/share/openbsd/updates.cron" | grep . | grep -v '^#' |
		sed "s/^-ns //; $sub" >"$T/job"
}
# pkg_add -u -n -v output, as read in pkg_add's PkgAdd.pm (tweak_header):
# an update set is "Adding old->new" once, and may show again with a step.
pkgout() {
	fx out.pkg_add <<'EOF'
quirks-7.140 signed on 2026-09-28T10:00:00Z
Adding quirks-7.140->7.141(pretending)
Adding mpv-0.40.0->0.40.1(pretending)
mpv-0.40.0->0.40.1 (extracting)(pretending)
Adding ffmpeg-7.1p2->7.1p3(pretending)
EOF
}

t_updates_release_counts() {
	up_setup; pkgout
	printf '001_net\n002_kern\n' | fx out.syspatch
	"$VT_SH" "$T/job" || fail "job failed"
	logged '^syspatch -c$'
	logged '^pkg_add -u -n -v$'
	eq "bar" "📦5" "$("$VT_SH" "$bar")"
}

t_updates_snapshot() {
	# syspatch refuses a snapshot; the packages still count.
	up_setup; pkgout
	echo 1 >"$VT_STATE/rc.syspatch"
	"$VT_SH" "$T/job" || fail "job failed"
	eq "bar: packages only" "📦3" "$("$VT_SH" "$bar")"
}

t_updates_nothing() {
	up_setup
	"$VT_SH" "$T/job" || fail "job failed"
	eq "nothing waiting" "" "$("$VT_SH" "$bar")"
	rm -f "$T/updates"
	eq "no file: nothing" "" "$("$VT_SH" "$bar")"
}

# sb-popupgrade in a terminal: Enter to close.
t_popupgrade_runs() {
	script --version 2>/dev/null | grep -q util-linux || skip "needs util-linux script(1) to feed a terminal"
	printf '\n' | script -qec "$VT_SH $REPO/.local/bin/statusbar/sb-popupgrade" /dev/null >"$T/tty.out" 2>&1
	logged '^doas syspatch$'
	logged '^doas pkg_add -u$'
	logged '^doas rm -f /var/db/updates$'
}

t_popupgrade_no_terminal() {
	sb-popupgrade </dev/null
	logged '^xterm -e .*sb-popupgrade$'
	notlogged '^doas'
}
