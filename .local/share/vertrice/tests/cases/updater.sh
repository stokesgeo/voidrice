# Native OpenBSD updater fixtures. Only a derived copy changes paths/PATH;
# no root, real syspatch/pkg_add/logger, crontab installation or network calls.
# Cron migration and root:wheel install argv are covered in cases/install.sh.

updates_setup() {
	[ "$VT_HOST" = OpenBSD ] || skip "native OpenBSD updater fixtures"
	mkdir -p "$T/native" "$T/db"
	cat >"$T/native/stub" <<'EOF'
#!/bin/ksh
name=${0##*/}
lock=${VT_STATE%/state}/lock
print -r -- "$name $*" >>"$VT_STATE/native.calls"
signal_updater() {
	[ "${UP_SIGNAL_AT:-}" != "$1" ] || kill -"${UP_SIGNAL:-TERM}" "$PPID"
}
case $name in
id) print "${UP_UID:-0}" ;;
uname)
	[ "${UP_FAULT:-}" != output-open ] || /bin/mkdir "$lock/output"
	print -r -- "${UP_RELEASE:-8.0}" ;;
fw_update)
	print 'native firmware output'
	[ ! -f "$VT_STATE/firmware" ] || cat "$VT_STATE/firmware"
	exit "${UP_FW_RC:-0}" ;;
su)
	printf '%s\n' "$@" >"$VT_STATE/su.args"
	print 'native user phase output'
	signal_updater su
	exit "${UP_SU_RC:-0}" ;;
syspatch)
	if [ "${1-}" = -c ]; then
		cat "$VT_STATE/patches"
		exit "${UP_CHECK_RC:-0}"
	fi
	n=0
	[ ! -f "$VT_STATE/attempt" ] || read -r n <"$VT_STATE/attempt"
	print "$((n + 1))" >"$VT_STATE/attempt"
	if [ "${UP_PAUSE:-0}" = 1 ]; then
		: >"$VT_STATE/ready"
		while [ ! -f "$VT_STATE/release" ]; do /bin/sleep 0.1; done
	fi
	print 'native patch advice (including reboot)'
	[ "${UP_FAULT:-}" != report-write ] || /bin/chmod 400 "$lock/report"
	[ "${UP_FAULT:-}" != foreign ] || print 'not owned by updater' >"$lock/foreign"
	signal_updater syspatch
	case ${UP_PATCH:-success} in
	noop) : >"$VT_STATE/patches"; exit 2 ;;
	self) if [ "$n" = 0 ]; then exit 2; fi ;;
	stuck) exit 2 ;;
	fail) exit 7 ;;
	esac ;;
pkg_add)
	cat "$VT_STATE/packages"
	print -u2 'native package stderr'
	signal_updater pkg_add
	exit "${UP_PKG_RC:-0}" ;;
logger)
	signal_updater logger
	case ${UP_FAULT:-} in logger|delivery) exit 9 ;; esac
	/bin/cat "$4" >"$VT_STATE/syslog" ;;
cat)
	if [ "$1" = "$lock/output" ] && [ "${UP_FAULT:-}" = capture-read ]; then
		print 'partial capture read'
		exit 9
	fi
	if [ "$1" = "$lock/report" ]; then
		signal_updater stdout
		case ${UP_FAULT:-} in stdout|delivery) exit 9 ;; esac
	fi
	exec /bin/cat "$@" ;;
chmod|mv)
	signal_updater "$name"
	[ "${UP_FAULT:-}" != "$name" ] || exit 9
	if [ "$name" = mv ] && [ "${UP_SIGNAL_AT:-}" = mv-published ]; then
		# Only the derived fixture's count rename may precede the signal.
		[ "$#" -eq 3 ] && [ "$1" = -f ] &&
		    [ "${2%/*}" = "${VT_STATE%/state}/db" ] &&
		    [ "$3" = "${VT_STATE%/state}/db/updates" ] || exit 9
		case ${2##*/} in .updates.?*) ;; *) exit 9 ;; esac
		/bin/mv "$@" || exit $?
		signal_updater mv-published
		exit $?
	fi
	exec "/bin/$name" "$@" ;;
esac
EOF
	chmod +x "$T/native/stub"
	for name in id uname fw_update su syspatch pkg_add logger cat chmod mv; do
		ln -s stub "$T/native/$name" || fail "cannot install $name stub"
	done
	# Literal rewrites are a test boundary: reject drift before execution.
	root_source=$REPO/.local/share/openbsd/upgrade.sh
	eq 'PATH rewrite anchor' 1 "$(grep -Fxc 'export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C' "$root_source")"
	eq 'lock rewrite anchor' 1 "$(grep -Fxc 'lock=/var/run/vertrice-upgrade.lock' "$root_source")"
	eq 'db rewrite anchors' 2 "$(grep -Fc '/var/db/' "$root_source")"
	eq 'firmware rewrite anchors' 2 "$(grep -Fc '/usr/sbin/fw_update' "$root_source")"
	eq 'su rewrite anchor' 1 "$(grep -Fc '/usr/bin/su' "$root_source")"
	eq 'passwd rewrite anchor' 1 "$(grep -Fc '/etc/passwd' "$root_source")"
	derived .local/share/openbsd/upgrade.sh updater \
		"s|PATH=/usr/bin:/bin:/usr/sbin:/sbin|PATH=$T/native:/usr/bin:/bin:/usr/sbin:/sbin|; s|/var/run/vertrice-upgrade.lock|$T/lock|g; s|/var/db/|$T/db/|g; s|/usr/sbin/fw_update|$T/native/fw_update|g; s|/usr/bin/su|$T/native/su|g; s|/etc/passwd|$T/passwd|g" >/dev/null
	grep -Eq '/var/|/etc/passwd|/usr/sbin/fw_update|/usr/bin/su' "$T/updater" && fail "production paths remain in fixture"
	eq 'derived PATH' "export PATH=$T/native:/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C" "$(grep '^export PATH=' "$T/updater")"
	"$VT_KSH" -n "$T/updater" || fail "invalid derived updater"
	unset UP_UID UP_PATCH UP_CHECK_RC UP_PKG_RC UP_FAULT UP_PAUSE UP_RELEASE UP_FW_RC UP_SU_RC UP_SIGNAL UP_SIGNAL_AT
	export UP_UID UP_PATCH UP_CHECK_RC UP_PKG_RC UP_FAULT UP_PAUSE UP_RELEASE UP_FW_RC UP_SU_RC UP_SIGNAL UP_SIGNAL_AT
	printf 'root:*:0:0:root:/root:/bin/ksh\npuffy:*:1000:1000:Puffy:/home/puffy:/bin/ksh\naliasroot:*:0:0:root:/root:/bin/ksh\n' >"$T/passwd"
	printf 'old-count\n' >"$T/db/updates"
	printf '001_base\n' >"$VT_STATE/patches"
	printf 'other output\nAdding foo-1->foo-2\nAdding foo-1->foo-2\nAdding bar-1->bar-2\n' >"$VT_STATE/packages"
}
updates_run() { "$VT_KSH" "$T/updater" "$@" >"$T/out" 2>"$T/err"; }
updates_clean() {
	[ ! -d "$T/lock" ] || fail "lock leaked"
	[ -z "$(find "$T/db" -name '.updates.*')" ] || fail "candidate leaked"
}
updates_preserved() {
	eq "previous count preserved" old-count "$(cat "$T/db/updates")"
	updates_clean
}
updates_retained() {
	eq "previous count preserved" old-count "$(cat "$T/db/updates")"
	[ -s "$T/lock/report" ] || fail "diagnostics not retained"
	[ -s "$T/lock/pid" ] || fail "owned lock not retained"
	[ -z "$(find "$T/db" -name '.updates.*')" ] || fail "candidate leaked"
	grep -Fq "diagnostics retained in $T/lock" "$T/err" || fail "recovery path missing"
}
updates_refuses_retry() {
	for file in pid report output user-output packages; do
		[ ! -f "$T/lock/$file" ] || cp "$T/lock/$file" "$T/saved-$file"
	done
	UP_FAULT=
	updates_run --nightly puffy
	eq 'retained lock rerun status' 1 "$?"
	grep -q 'busy' "$T/err" || fail "retained lock not explicit"
	eq 'retained lock count untouched' old-count "$(cat "$T/db/updates")"
	for file in pid report output user-output packages; do
		[ ! -f "$T/saved-$file" ] ||
		    cmp -s "$T/saved-$file" "$T/lock/$file" || fail "retained $file overwritten"
	done
}
# The runner backgrounds cases, inheriting ignored INT. Reset dispositions
# only in this ordinary-user fixture launcher so all three traps are tested.
updates_signal_setup() {
	cat >"$T/signal-exec.c" <<'EOF'
#include <signal.h>
#include <unistd.h>

int
main(int argc, char **argv)
{
	if (argc < 2)
		return 2;
	if (signal(SIGHUP, SIG_DFL) == SIG_ERR ||
	    signal(SIGINT, SIG_DFL) == SIG_ERR ||
	    signal(SIGTERM, SIG_DFL) == SIG_ERR)
		return 3;
	execv(argv[1], argv + 1);
	return 127;
}
EOF
	/usr/bin/cc -Wall -Wextra -Werror -o "$T/signal-exec" "$T/signal-exec.c" || fail "signal launcher build failed"
}
updates_signal_run() {
	"$T/signal-exec" "$VT_KSH" "$T/updater" "$@" >"$T/out" 2>"$T/err"
}

t_updates_noop() {
	updates_setup
	UP_PATCH=noop
	updates_run || fail "syspatch no-op rejected"
	eq "successful update clears count" '' "$(cat "$T/db/updates")"
	eq "one patch attempt" 1 "$(cat "$VT_STATE/attempt")"
	grep -q '^syspatch -c$' "$VT_STATE/native.calls" || fail "no-op not verified"
	grep -q '^pkg_add -u -I$' "$VT_STATE/native.calls" || fail "packages skipped"
	cmp -s "$T/out" "$VT_STATE/syslog" || fail "syslog/stdout mismatch"
	eq "published count mode" 644 "$(/usr/bin/stat -f %Lp "$T/db/updates")"
	updates_clean
}

t_updates_self_retry() {
	updates_setup
	UP_PATCH=self
	updates_run || fail "self-update retry failed"
	eq "bounded retry" 2 "$(cat "$VT_STATE/attempt")"
	updates_clean
}

t_updates_pending_retry_fails() {
	updates_setup
	UP_PATCH=stuck
	updates_run && fail "pending patches accepted"
	eq "bounded retry" 2 "$(cat "$VT_STATE/attempt")"
	updates_preserved
}

t_updates_native_failures() {
	updates_setup
	UP_PATCH=fail
	updates_run && fail "native patch failure hidden"
	grep -q '^pkg_add -u -I$' "$VT_STATE/native.calls" || fail "packages skipped after patch failure"
	updates_preserved
	UP_PATCH=success UP_PKG_RC=6
	updates_run && fail "native package failure hidden"
	updates_preserved
}

t_updates_check() {
	updates_setup
	updates_run --check || fail "check failed"
	eq "sorted unique complete count" "$(printf '001_base\nAdding bar-1->bar-2\nAdding foo-1->foo-2')" "$(cat "$T/db/updates")"
	grep -q '^pkg_add -u -I -n -v$' "$VT_STATE/native.calls" || fail "not a dry run"
	[ ! -f "$VT_STATE/attempt" ] || fail "check applied patches"
	grep -q 'native package stderr' "$T/out" || fail "native stderr lost"
	cmp -s "$T/out" "$VT_STATE/syslog" || fail "check report mismatch"
	updates_clean
	: >"$VT_STATE/patches"; : >"$VT_STATE/packages"
	updates_run --check || fail "empty check failed"
	[ ! -s "$T/db/updates" ] || fail "empty check not published"
	updates_clean
}

t_updates_check_failures() {
	updates_setup
	UP_CHECK_RC=8
	updates_run --check && fail "base check failure hidden"
	updates_preserved
	UP_CHECK_RC=0 UP_PKG_RC=6
	updates_run --check && fail "package check failure hidden"
	updates_preserved
}

t_updates_publication_failures() {
	updates_setup
	for UP_FAULT in chmod mv; do
		updates_run --check && fail "$UP_FAULT failure hidden"
		updates_preserved
	done
}

t_updates_logger_failure() {
	updates_setup
	UP_FAULT=logger
	updates_run --nightly puffy
	eq 'logger failure status' 1 "$?"
	updates_preserved
	grep -q 'logger failed' "$T/err" || fail "logger failure not identified"
	grep -q '^mv ' "$VT_STATE/native.calls" && fail "published after logger failure"
	cp "$T/out" "$T/fallback"
	UP_FAULT=
	updates_run --nightly puffy || fail "next nightly blocked after logger failure"
	cmp -s "$T/fallback" "$T/out" || fail "stdout fallback was not the full combined transcript"
	cmp -s "$T/fallback" "$VT_STATE/syslog" || fail "next nightly log mismatch"
	[ ! -s "$T/db/updates" ] || fail "next nightly did not publish"
	updates_clean
}

t_updates_stdout_failure() {
	updates_setup
	UP_FAULT=stdout
	updates_run --nightly puffy
	eq 'stdout failure status' 1 "$?"
	updates_preserved
	grep -q '^mv ' "$VT_STATE/native.calls" && fail "published after stdout failure"
	cp "$VT_STATE/syslog" "$T/fallback"
	UP_FAULT=
	updates_run --nightly puffy || fail "next nightly blocked after stdout failure"
	cmp -s "$T/fallback" "$T/out" || fail "logger fallback was not the full combined transcript"
	cmp -s "$T/fallback" "$VT_STATE/syslog" || fail "next nightly log mismatch"
	[ ! -s "$T/db/updates" ] || fail "next nightly did not publish"
	updates_clean
}

t_updates_closed_stdout() {
	updates_setup
	"$VT_KSH" "$T/updater" --check >&- 2>"$T/err"
	eq 'closed stdout status' 1 "$?"
	updates_preserved
	cp "$VT_STATE/syslog" "$T/fallback"
	updates_run --check || fail "next check blocked after closed stdout"
	cmp -s "$T/fallback" "$T/out" || fail "closed stdout lost log"
	updates_clean
}

t_updates_delivery_failure() {
	updates_setup
	UP_FAULT=delivery
	updates_run --nightly puffy
	eq 'both sinks failed status' 1 "$?"
	updates_retained
	grep -q 'native patch advice' "$T/lock/report" || fail "undelivered system output lost"
	grep -q 'native user phase output' "$T/lock/report" || fail "undelivered user output lost"
	grep -q 'User phase exit: 0' "$T/lock/report" || fail "undelivered combined status lost"
	[ -s "$T/lock/output" ] && [ -s "$T/lock/user-output" ] || fail "undelivered raw evidence lost"
	updates_refuses_retry
}

t_updates_capture_io_failure() {
	updates_setup
	UP_FAULT=capture-read
	updates_run --nightly puffy
	eq 'capture I/O failure status' 1 "$?"
	updates_retained
	grep -q 'native patch advice' "$T/lock/output" || fail "unappended output overwritten"
	grep -q '^pkg_add' "$VT_STATE/native.calls" && fail "system continued after capture I/O failure"
	[ -s "$VT_STATE/su.args" ] || fail "independent user skipped after system capture I/O failure"
	grep -q 'native user phase output' "$T/lock/user-output" || fail "separate user output missing"
	grep -q 'System phase exit: 1' "$T/out" || fail "capture failure not aggregated"
	grep -q 'User phase exit: 0' "$T/out" || fail "independent user result lost"
	cmp -s "$T/out" "$T/lock/report" || fail "incomplete report not emitted to stdout"
	cmp -s "$VT_STATE/syslog" "$T/lock/report" || fail "incomplete report not emitted to logger"
	grep -q 'native patch advice' "$T/out" && fail "capture fault did not omit raw system output"
	# Both sinks accepted the report, but raw system bytes are still missing.
	# Successful user capture must not silently make that report complete.
	updates_refuses_retry
}

t_updates_report_write_failure() {
	updates_setup
	UP_FAULT=report-write
	updates_run --nightly puffy
	eq 'report append failure status' 1 "$?"
	updates_retained
	grep -q 'native patch advice' "$T/lock/output" || fail "raw diagnostics lost on report write failure"
	grep -Eq '^pkg_add|^su ' "$VT_STATE/native.calls" && fail "continued without writable capture report"
	cmp -s "$T/out" "$T/lock/report" || fail "readable partial report not emitted to stdout"
	cmp -s "$VT_STATE/syslog" "$T/lock/report" || fail "readable partial report not emitted to logger"
	updates_refuses_retry
}

t_updates_output_open_failure() {
	updates_setup
	UP_FAULT=output-open
	updates_run
	eq 'output open failure status' 1 "$?"
	updates_retained
	grep -Eq '^syspatch|^pkg_add' "$VT_STATE/native.calls" && fail "command ran without output capture"
	[ -d "$T/lock/output" ] || fail "non-file output recursively removed"
	updates_refuses_retry
}

t_updates_owned_cleanup() {
	updates_setup
	UP_FAULT=foreign UP_PATCH=fail
	updates_run && fail "failure hidden"
	eq 'unknown lock entry preserved' 'not owned by updater' "$(cat "$T/lock/foreign")"
	eq 'count preserved with unknown lock entry' old-count "$(cat "$T/db/updates")"
	[ ! -e "$T/lock/pid" ] && [ ! -e "$T/lock/report" ] && [ ! -e "$T/lock/output" ] || fail "owned files not cleaned"
	grep -Fq "lock cleanup failed at $T/lock" "$T/err" || fail "unknown-entry recovery path missing"
}

t_updates_post_publication_cleanup() {
	updates_setup
	UP_FAULT=foreign
	updates_run && fail "cleanup failure hidden"
	[ ! -s "$T/db/updates" ] || fail "completed count publication not visible"
	eq 'unknown entry after publication' 'not owned by updater' "$(cat "$T/lock/foreign")"
	grep -q 'failed after count publication' "$T/err" || fail "post-publication failure misreported"
	grep -q 'count not published' "$T/err" && fail "published count described as preserved"
	return 0
}

t_updates_signals() {
	updates_setup
	updates_signal_setup
	UP_SIGNAL_AT=pkg_add
	for UP_SIGNAL in HUP INT TERM; do
		: >"$VT_STATE/native.calls"
		updates_signal_run --nightly puffy
		eq "$UP_SIGNAL interrupted status" 1 "$?"
		updates_preserved
		grep -q 'native patch advice' "$T/out" || fail "$UP_SIGNAL lost accumulated report"
		grep -q 'native package stderr' "$T/out" || fail "$UP_SIGNAL lost in-progress capture"
		grep -q 'Capture incomplete' "$T/out" || fail "$UP_SIGNAL incomplete capture not identified"
		grep -q "interrupted ($UP_SIGNAL)" "$T/err" || fail "$UP_SIGNAL not handled"
		cmp -s "$T/out" "$VT_STATE/syslog" || fail "$UP_SIGNAL report mismatch"
		eq "$UP_SIGNAL finalized once" 1 "$(grep -c '^logger ' "$VT_STATE/native.calls")"
		[ ! -f "$VT_STATE/su.args" ] || fail "$UP_SIGNAL ran user phase after interruption"
	done
}

t_updates_signal_delivery_failure() {
	updates_setup
	updates_signal_setup
	UP_SIGNAL=TERM UP_SIGNAL_AT=pkg_add UP_FAULT=delivery
	updates_signal_run --nightly puffy
	eq 'interrupted and undeliverable status' 1 "$?"
	updates_retained
	grep -q 'native patch advice' "$T/lock/report" || fail "undeliverable accumulated output lost"
	grep -q 'native package stderr' "$T/lock/report" || fail "undeliverable in-progress output lost"
	grep -q 'native package stderr' "$T/lock/output" || fail "raw interrupted output lost"
	eq 'undeliverable finalized once' 1 "$(grep -c '^logger ' "$VT_STATE/native.calls")"
	updates_refuses_retry
}

t_updates_finalization_signals() {
	updates_setup
	updates_signal_setup
	UP_SIGNAL=TERM
	for UP_SIGNAL_AT in logger stdout chmod; do
		: >"$VT_STATE/native.calls"
		updates_signal_run --check
		eq "$UP_SIGNAL_AT interrupted finalization status" 1 "$?"
		updates_preserved
		cmp -s "$T/out" "$VT_STATE/syslog" || fail "$UP_SIGNAL_AT interrupted report mismatch"
		grep -q 'interrupted (TERM)' "$T/err" || fail "$UP_SIGNAL_AT finalization interruption missing"
		eq "$UP_SIGNAL_AT finalized once" 1 "$(grep -c '^logger ' "$VT_STATE/native.calls")"
		grep -q '^mv ' "$VT_STATE/native.calls" && fail "$UP_SIGNAL_AT signal did not veto publication"
	done
	return 0
}

t_updates_publication_signal() {
	updates_setup
	updates_signal_setup
	UP_SIGNAL=TERM UP_SIGNAL_AT=mv-published
	updates_signal_run --check
	eq 'post-rename TERM status' 1 "$?"
	eq 'new count published before TERM' "$(printf '001_base\nAdding bar-1->bar-2\nAdding foo-1->foo-2')" "$(cat "$T/db/updates")"
	eq 'published count mode after TERM' 644 "$(/usr/bin/stat -f %Lp "$T/db/updates")"
	cmp -s "$T/out" "$VT_STATE/syslog" || fail 'post-rename TERM report mismatch'
	grep -Fq 'native package stderr' "$T/out" || fail 'post-rename TERM lost native output'
	grep -Fqx 'Commands succeeded; publishing count after output/log checks.' "$T/out" || fail 'post-rename TERM lost complete report'
	grep -Fqx 'vertrice-upgrade: interrupted (TERM); inspect native update state' "$T/err" || fail 'post-rename TERM not handled'
	grep -Fqx 'vertrice-upgrade: failed after count publication (see diagnostics)' "$T/err" || fail 'post-rename TERM publication misreported'
	grep -Eq 'count not published|previous count preserved' "$T/out" "$T/err" "$VT_STATE/syslog" && fail 'post-rename TERM described old count as preserved'
	eq 'post-rename TERM finalized once' 1 "$(grep -c '^logger ' "$VT_STATE/native.calls")"
	eq 'post-rename TERM renamed once' 1 "$(grep -c '^mv ' "$VT_STATE/native.calls")"
	updates_clean
}

t_updates_lock_and_cli() {
	updates_setup
	updates_run --reboot && fail "invalid CLI accepted"
	updates_preserved
	UP_UID=1000
	updates_run && fail "nonroot accepted"
	updates_preserved
	UP_UID=0
	mkdir "$T/lock"; echo 'preserve evidence' >"$T/lock/report"
	updates_run --check && fail "busy lock accepted"
	eq "busy lock untouched" 'preserve evidence' "$(cat "$T/lock/report")"
	eq "busy count untouched" old-count "$(cat "$T/db/updates")"
	[ ! -f "$VT_STATE/attempt" ] || fail "busy run applied patches"
}

t_updates_concurrent_check() {
	updates_setup
	UP_PAUSE=1
	updates_run &
	worker=$!; track "$worker"
	waitfor 3 test -f "$VT_STATE/ready" || fail "updater never reached pause"
	updates_run --check && fail "concurrent check accepted"
	eq "count not published early" old-count "$(cat "$T/db/updates")"
	grep -q 'busy' "$T/err" || fail "contention not explicit"
	: >"$VT_STATE/release"
	wait "$worker" || fail "updater failed after release"
	[ ! -s "$T/db/updates" ] || fail "successful updater did not clear count"
	updates_clean
}

# Exact fields only: not native crontab acceptance or mail delivery.
t_updates_cron_fragments() {
	eq "nightly fragment" "$(printf '# vertrice-overnight-upgrade (root per-user table)\n30\t3\t*\t*\t*\t-s /usr/local/sbin/vertrice-upgrade --nightly @USER@ # vertrice-overnight-upgrade')" \
		"$(cat "$REPO/.local/share/openbsd/upgrade.cron")"
	eq "check fragment" "$(printf '# vertrice-update-count (root per-user table)\n~\t*/4\t*\t*\t*\t-ns /usr/local/sbin/vertrice-upgrade --check\n~\t2\t*\t*\t*\t-s /usr/local/bin/freshclam --config-file=/etc/freshclam.conf --foreground')" \
		"$(cat "$REPO/.local/share/openbsd/updates.cron")"
}

t_updates_sparse_assets() {
	# Sparse patterns have gitignore syntax with positive meaning selected.
	# Evaluate the existing pattern file; do not change a checkout/index.
	for path in .local/share/openbsd/upgrade.sh .local/share/openbsd/upgrade.cron \
	    .local/share/openbsd/updates.cron .local/bin/statusbar/sb-popupgrade; do
		git -C "$REPO" -c core.excludesFile="$REPO/.local/share/openbsd/sparse-checkout" \
		    check-ignore --no-index -q "$path" || fail "not selected: $path"
	done
}
