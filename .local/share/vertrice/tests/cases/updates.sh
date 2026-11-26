# Update notice and popup user paths. Native updater stubs and derived
# root paths are shared with updater.sh; no real privileged command runs.

up_setup() {
	updates_setup
	bar=$(derived .local/bin/statusbar/sb-updates sb-updates "s|/var/db/updates|$T/db/updates|g")
}
# pkg_add -u -n -v output, as read in pkg_add's PkgAdd.pm (tweak_header):
# an update set is "Adding old->new" once, and may show again with a step.
pkgout() {
	cat >"$VT_STATE/packages" <<'EOF'
quirks-7.140 signed on 2026-09-28T10:00:00Z
Adding quirks-7.140->7.141(pretending)
Adding mpv-0.40.0->0.40.1(pretending)
mpv-0.40.0->0.40.1 (extracting)(pretending)
Adding ffmpeg-7.1p2->7.1p3(pretending)
EOF
}

t_updates_release_counts() {
	up_setup; pkgout
	printf '001_net\n002_kern\n' >"$VT_STATE/patches"
	updates_run --check || fail "check failed"
	grep -q '^syspatch -c$' "$VT_STATE/native.calls" || fail "no base check"
	grep -q '^pkg_add -u -I -n -v$' "$VT_STATE/native.calls" || fail "no package check"
	eq "bar" "📦5" "$("$VT_SH" "$bar")"
}

t_updates_snapshot() {
	# A refused base check now preserves the complete previous estimate.
	up_setup; pkgout
	UP_CHECK_RC=1
	updates_run --check && fail "failed base check accepted"
	eq "bar: previous count" "📦1" "$("$VT_SH" "$bar")"
}

t_updates_nothing() {
	up_setup
	: >"$VT_STATE/patches"; : >"$VT_STATE/packages"
	updates_run --check || fail "empty check failed"
	eq "nothing waiting" "" "$("$VT_SH" "$bar")"
	rm -f "$T/db/updates"
	eq "no file: nothing" "" "$("$VT_SH" "$bar")"
}

# sb-popupgrade in a terminal: Enter to close.
t_popupgrade_runs() {
	command -v script >/dev/null 2>&1 || skip "no script(1) to provide a terminal"
	popup=$(derived .local/bin/statusbar/sb-popupgrade popup "s|/var/db/updates|$T/updates|g")
	( printf '\n'; "$VT_REAL_SLEEP" 1 ) |
		pty "$VT_SH $popup" >"$T/tty.out" 2>&1
	logged '^doas syspatch$'
	logged '^doas pkg_add -u$'
	logged "^doas rm -f $T/updates\$"
}

t_popupgrade_no_terminal() {
	sb-popupgrade </dev/null
	logged '^xterm -e .*sb-popupgrade$'
	notlogged '^doas'
}
