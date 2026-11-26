#!/bin/ksh
# Installed root:wheel 0755 as /usr/local/sbin/vertrice-upgrade.
# No reboot, service restart or release upgrade. See syspatch's own advice.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
unset ENV TMPDIR PKG_TMPDIR PKG_DBDIR PKG_PATH TRUSTED_PKG_PATH FETCH_CMD
unset PKG_CACHE DEBUG_PKG_CACHE DESTDIR
umask 077

mode=
nightly_user=
case $# in
0) mode=update ;;
1) [ "$1" = --check ] && mode=check ;;
2) [ "$1" = --nightly ] && { mode=nightly; nightly_user=$2; } ;;
esac
if [ -z "${mode:-}" ]; then
	print -u2 'usage: vertrice-upgrade [--check | --nightly USER]'
	exit 1
fi
[ "$(id -u)" = 0 ] || { print -u2 'vertrice-upgrade: need root'; exit 1; }
if [ "$mode" = nightly ]; then
	# Only a literal local passwd name, never a uid, option or shell text.
	case $nightly_user in
	''|[!a-zA-Z_]*|*[!a-zA-Z0-9_-]*)
		print -u2 'vertrice-upgrade: invalid nightly user'; exit 1 ;;
	esac
	if ! awk -F: -v user="$nightly_user" '
	    $1 == user && $3 ~ /^[0-9]+$/ && $3 + 0 != 0 { found++ }
	    END { exit found != 1 }
	' /etc/passwd; then
		print -u2 'vertrice-upgrade: nightly user must be a nonroot local passwd account'
		exit 1
	fi
fi
lock=/var/run/vertrice-upgrade.lock
updates=/var/db/updates

note()
{
	print -r -- "$*" >>"$lock/report" || { retain=1; return 1; }
}
# Return capture I/O status, not the command's status. Callers must check
# capture before reading native_status. Never overwrite unappended output.
capture()
{
	[ "$output_pending" -eq 0 ] || return 1
	note "== $* ==" || return 1
	# Open first: failure to redirect is not a native command exit status.
	exec 3>"$output" || { retain=1; return 1; }
	output_pending=1
	"$@" >&3 2>&1
	native_status=$?
	exec 3>&-
	cat "$output" >>"$lock/report" || { retain=1; return 1; }
	output_pending=0
	note "[exit $native_status]"
}
base_supported()
{
	release=$(uname -r) || { note 'Base FAILED: cannot identify the kernel release.'; return 1; }
	case $release in
	*-current|*-beta)
		note 'Base FAILED: snapshot/current base updates are unsupported here; syspatch is release-only. A separately tested sysupgrade transition is required.'
		return 1 ;;
	esac
}
update()
{
	failed=0
	if base_supported; then
		for attempt in 1 2; do
			capture syspatch || return 1
			case $native_status in
			0) break ;;
			2)
				# 2 means either no-op or syspatch replaced itself.
				capture syspatch -c || return 1
				if [ "$native_status" -ne 0 ]; then failed=1; break; fi
				[ -s "$lock/output" ] || break
				if [ "$attempt" -eq 2 ]; then
					note 'Patches still pending after bounded retry; run again.' || return 1
					failed=1
				fi ;;
			*) failed=1; break ;;
			esac
		done
	else
		failed=1
	fi
	# Still try the independent native channels after ordinary failures.
	capture pkg_add -u -I || return 1
	[ "$native_status" -eq 0 ] || failed=1
	if [ -x /usr/sbin/fw_update ]; then
		capture /usr/sbin/fw_update || return 1
		[ "$native_status" -eq 0 ] || failed=1
		# Native fw_update may continue after an individual fetch/verify/
		# install failure and exit 0. Match its archive-qualified status
		# diagnostic, not generic warnings (including recovered checksums).
		if grep -Eq '^fw_update:.* failed \([[:alnum:]_][[:alnum:]_.-]*-firmware-[[:alnum:]_.]+\.tgz\)' "$lock/output"; then
			note 'Firmware FAILED: native per-archive failure (see retained output).' || return 1
			failed=1
		fi
	else
		note 'Firmware FAILED: native fw_update is unavailable.' || return 1
		failed=1
	fi
	return "$failed"
}
check()
{
	failed=0
	if base_supported; then
		capture syspatch -c || return 1
		if [ "$native_status" -eq 0 ]; then
			cat "$lock/output" >"$pending" || return 1
		else
			failed=1
		fi
	else
		failed=1
	fi
	capture pkg_add -u -I -n -v || return 1
	if [ "$native_status" -eq 0 ]; then
		awk '/^Adding.*->/' "$lock/output" >"$lock/packages" || return 1
		sort -u "$lock/packages" >>"$pending" || return 1
	else
		failed=1
	fi
	return "$failed"
}

# A handled signal enters EXIT once. During finalization it only marks
# failure, so another signal cannot discard diagnostics or restart cleanup.
interrupt()
{
	interrupted=1
	rc=1
	print -u2 "vertrice-upgrade: interrupted ($1); inspect native update state"
	[ "$finishing" -eq 1 ] || exit 1
}
# shellcheck disable=SC2329 # Called by the EXIT trap.
finalize()
{
	finishing=1
	trap - EXIT
	[ "$1" -eq 0 ] || rc=1
	exec 3>&-
	if [ "$output_pending" -eq 1 ]; then
		cat "$output" >>"$lock/report" || { retain=1; rc=1; }
		note 'Capture incomplete; native work may be partial (see captured output).' || rc=1
	fi
	if [ "$interrupted" -eq 1 ]; then
		note 'Interrupted; inspect native update state before retrying.' || rc=1
	fi
	if [ "$rc" -eq 0 ]; then
		note 'Commands succeeded; publishing count after output/log checks.' || rc=1
	else
		note 'Commands failed; previous count preserved.' || rc=1
	fi
	# Either sink can carry the transcript; both must pass for publication.
	# Never clear retention from capture/report I/O failure just because a
	# sink successfully emitted what may be an incomplete report.
	# logger success is not a delivery/durability acknowledgement from syslogd.
	emitted=0
	if logger -t vertrice-upgrade -f "$lock/report"; then
		emitted=1
	else
		print -u2 'vertrice-upgrade: logger failed'
		rc=1
	fi
	if cat "$lock/report"; then emitted=1; else rc=1; fi
	[ "$emitted" -eq 1 ] || retain=1
	if [ "$rc" -eq 0 ]; then
		chmod 0644 "$pending" || rc=1
		# Recheck after chmod: a handled signal must veto publication too.
		if [ "$rc" -eq 0 ]; then
			if mv -f "$pending" "$updates"; then
				pending=
				published=1
			else
				rc=1
			fi
		fi
	fi
	[ -z "$pending" ] || rm -f "$pending" || { retain=1; rc=1; }
	if [ "$retain" -eq 1 ]; then
		print -u2 "vertrice-upgrade: diagnostics retained in $lock; inspect before retrying"
	else
		# Never recursively remove unknown entries or guess a stale lock.
		if ! { rm -f "$lock/pid" "$lock/report" "$lock/output" \
		    "$lock/user-output" "$lock/packages" && rmdir "$lock"; }; then
			print -u2 "vertrice-upgrade: lock cleanup failed at $lock; inspect before retrying"
			rc=1
		fi
	fi
	if [ "$rc" -ne 0 ]; then
		if [ "$published" -eq 1 ]; then
			print -u2 'vertrice-upgrade: failed after count publication (see diagnostics)'
		else
			print -u2 'vertrice-upgrade: failed; count not published (see diagnostics)'
		fi
	fi
	exit "$rc"
}

# Resources belong to this invocation only after mkdir succeeds.
if ! mkdir "$lock"; then
	print -u2 "vertrice-upgrade: busy or cannot create $lock; not removing it"
	exit 1
fi
pending=
output=$lock/output
output_pending=0
retain=0
interrupted=0
finishing=0
published=0
rc=0
trap 'finalize "$?"' EXIT
trap 'interrupt HUP' HUP
trap 'interrupt INT' INT
trap 'interrupt TERM' TERM
: >"$lock/report" || { retain=1; exit 1; }
print -r -- "$$" >"$lock/pid" || exit 1
# Same filesystem as updates: rename publishes all lines or none. Also use
# an empty candidate for successful update, so clearing is serialized too.
if [ -d "$updates" ]; then
	print -u2 "vertrice-upgrade: $updates is a directory"
	exit 1
fi
pending=$(mktemp /var/db/.updates.XXXXXXXXXX) || exit 1
note "vertrice-upgrade: $mode" || exit 1
case $mode in
update) update || rc=1 ;;
check) check || rc=1 ;;
nightly)
	update
	system_rc=$?
	note "System phase exit: $system_rc" || rc=1
	# Independent user capture must not overwrite unappended system output.
	# A failed system append already requires retaining that file and lock.
	output=$lock/user-output
	output_pending=0
	# su sets uid/gids and login HOME before the shell reads user files.
	# This command is constant: HOME is expanded only by the dropped shell.
	# shellcheck disable=SC2016 # Expansion belongs to the dropped shell.
	if capture /usr/bin/su -l -s /bin/ksh "$nightly_user" -c \
	    'exec "$HOME/.local/bin/openbsd/vertrice-update" --user'; then
		user_rc=$native_status
	else
		user_rc=1
	fi
	note "User phase exit: $user_rc" || rc=1
	[ "$system_rc" -eq 0 ] && [ "$user_rc" -eq 0 ] || rc=1 ;;
esac
exit "$rc"
