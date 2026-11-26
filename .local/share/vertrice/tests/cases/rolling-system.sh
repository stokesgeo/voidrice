# Root/system half of rolling updates. All privileged/native calls are stubs
# in a derived copy (updates_setup); never invoke real su or update commands.

t_rolling_system_nightly() {
	updates_setup
	updates_run --nightly puffy || fail "nightly failed"
	grep -q '^fw_update $' "$VT_STATE/native.calls" || fail "firmware skipped"
	eq "su login argv and constant dropped-user command" \
	    "$(printf '%s\n' -l -s /bin/ksh puffy -c 'exec "$HOME/.local/bin/openbsd/vertrice-update" --user')" \
	    "$(cat "$VT_STATE/su.args")"
	grep -q 'System phase exit: 0' "$T/out" || fail "system status missing"
	grep -q 'User phase exit: 0' "$T/out" || fail "user status missing"
	cmp -s "$T/out" "$VT_STATE/syslog" || fail "combined log mismatch"
	[ ! -s "$T/db/updates" ] || fail "success did not clear count"
	updates_clean
}

t_rolling_system_phase_failures() {
	updates_setup
	for channel in base packages firmware user; do
		UP_PATCH=success UP_PKG_RC=0 UP_FW_RC=0 UP_SU_RC=0
		case $channel in
		base) UP_PATCH=fail ;;
		packages) UP_PKG_RC=8 ;;
		firmware) UP_FW_RC=9 ;;
		user) UP_SU_RC=10 ;;
		esac
		rm -f "$VT_STATE/su.args"
		updates_run --nightly puffy && fail "$channel failure hidden"
		[ -s "$VT_STATE/su.args" ] || fail "user skipped after $channel failure"
		grep -q 'native firmware output' "$T/out" || fail "firmware skipped after $channel failure"
		grep -q 'User phase exit:' "$T/out" || fail "user status missing"
		updates_preserved
	done
	UP_PATCH=fail UP_SU_RC=11
	updates_run --nightly puffy && fail "combined failure hidden"
	grep -q 'System phase exit: 1' "$T/out" || fail "system failure status missing"
	grep -q 'User phase exit: 11' "$T/out" || fail "user failure status missing"
	updates_preserved
}

t_rolling_system_partial_firmware() {
	updates_setup
	# Native fetch/verify and add_firmware failure both emit this exact
	# archive-qualified status marker, continue, then may exit 0.
	for diagnostic in \
	    'fw_update: add iwx failed (iwx-firmware-20261022.tgz),uvideo; update none; keep intel' \
	    'fw_update: add none; update iwx failed (iwx-firmware-20261022.tgz),uvideo'; do
		printf '%s\n' "$diagnostic" >"$VT_STATE/firmware"
		UP_FW_RC=0
		rm -f "$VT_STATE/su.args"
		updates_run --nightly puffy && fail 'exit-0 partial firmware failure hidden'
		grep -Fq "$diagnostic" "$T/out" || fail 'native partial failure output lost'
		grep -q 'Firmware FAILED: native per-archive failure' "$T/out" || fail 'partial failure not identified'
		grep -q 'System phase exit: 1' "$T/out" || fail 'partial failure not cumulative'
		grep -q 'User phase exit: 0' "$T/out" || fail 'apps not attempted after partial firmware failure'
		[ -s "$VT_STATE/su.args" ] || fail 'apps skipped after partial firmware failure'
		cmp -s "$T/out" "$VT_STATE/syslog" || fail 'partial output not logged'
		updates_preserved
	done
	# Do not reinterpret generic/recovered diagnostics as archive failure.
	printf '%s\n' 'Checksum test for iwx-firmware-20261022.tgz failed.' \
	    'unrelated failed (iwx-firmware-20261022.tgz)' \
	    'fw_update: add iwx; update none; keep intel' >"$VT_STATE/firmware"
	updates_run --nightly puffy || fail 'generic/recovered warning treated as partial failure'
	updates_clean
}

t_rolling_system_current_boundary() {
	updates_setup
	for UP_RELEASE in 8.0-current 8.0-beta; do
		: >"$VT_STATE/native.calls"
		updates_run --nightly puffy && fail "snapshot base silently accepted"
		grep -q 'snapshot/current base updates are unsupported' "$T/out" || fail "snapshot boundary not reported"
		grep -q '^syspatch' "$VT_STATE/native.calls" && fail "syspatch run on snapshot"
		grep -q '^pkg_add -u -I$' "$VT_STATE/native.calls" || fail "packages skipped"
		[ -s "$VT_STATE/su.args" ] || fail "user skipped"
		updates_preserved
		updates_run --check && fail "snapshot check silently accepted"
		grep -q '^syspatch' "$VT_STATE/native.calls" && fail "snapshot check used syspatch"
		updates_preserved
	done
}

t_rolling_system_validation() {
	updates_setup
	for user in '' root aliasroot nobody-missing 1000 -l 'puffy;touch owned' 'puffy$(touch owned)' 'puffy/name' 'puffy name'; do
		updates_run --nightly "$user" && fail "invalid target accepted: $user"
		[ ! -f "$VT_STATE/attempt" ] || fail "native commands before target validation"
		[ ! -f "$VT_STATE/su.args" ] || fail "su before target validation"
		updates_preserved
	done
	[ ! -e owned ] || fail "target text executed"
	for args in '--nightly' '--check extra' '--nightly puffy extra' '--user' '--reboot'; do
		# Intentional splitting to exercise missing/excess CLI arguments.
		updates_run $args && fail "bad CLI accepted: $args"
		updates_preserved
	done
	UP_UID=1000
	updates_run --nightly puffy && fail "nonroot invoker accepted"
	[ ! -f "$VT_STATE/attempt" ] || fail "nonroot ran native updater"
	updates_preserved
}

t_rolling_system_only_and_check() {
	updates_setup
	updates_run || fail "system-only default failed"
	[ ! -f "$VT_STATE/su.args" ] || fail "system-only invoked user phase"
	grep -q '^fw_update $' "$VT_STATE/native.calls" || fail "default omitted firmware"
	: >"$VT_STATE/native.calls"
	updates_run --check || fail "check failed"
	grep -q '^fw_update\|^su' "$VT_STATE/native.calls" && fail "check ran a mutating phase"
	updates_clean
}

t_rolling_system_missing_firmware() {
	updates_setup
	rm "$T/native/fw_update"
	updates_run --nightly puffy && fail "unavailable firmware silently omitted"
	grep -q 'Firmware FAILED: native fw_update is unavailable' "$T/out" || fail "firmware gap not reported"
	[ -s "$VT_STATE/su.args" ] || fail "user skipped after missing firmware"
	updates_preserved
}

t_rolling_system_drop_home_expansion() {
	updates_setup
	# This stub is still ordinary-user execution, not proof of native uid drop.
	# It exercises the exact constant command with HOME supplied after the
	# simulated login, while the updater itself has a different HOME.
	rm "$T/native/su"
	cat >"$T/native/su" <<'EOF'
#!/bin/ksh
[ "$#" = 6 ] && [ "$1" = -l ] && [ "$2" = -s ] &&
    [ "$3" = /bin/ksh ] && [ "$4" = puffy ] && [ "$5" = -c ] || exit 20
export HOME="$VT_STATE/login-home"
exec /bin/ksh -c "$6"
EOF
	mkdir -p "$VT_STATE/login-home/.local/bin/openbsd"
	cat >"$VT_STATE/login-home/.local/bin/openbsd/vertrice-update" <<'EOF'
#!/bin/ksh
[ "$#" = 1 ] && [ "$1" = --user ] || exit 21
[ "$(/usr/bin/id -u)" != 0 ] || exit 22
printf '%s\n' "$HOME" >"$VT_STATE/dropped-home"
EOF
	chmod +x "$T/native/su" "$VT_STATE/login-home/.local/bin/openbsd/vertrice-update"
	updates_run --nightly puffy || fail "dropped HOME command failed"
	eq "HOME resolved in dropped shell" "$VT_STATE/login-home" "$(cat "$VT_STATE/dropped-home")"
	updates_clean
}

t_rolling_system_interrupted_user() {
	updates_setup
	updates_signal_setup
	UP_SIGNAL=TERM UP_SIGNAL_AT=su
	updates_signal_run --nightly puffy
	eq 'interrupted user capture status' 1 "$?"
	grep -q 'System phase exit: 0' "$T/out" || fail "completed system phase lost"
	grep -q 'native firmware output' "$T/out" || fail "accumulated firmware output lost"
	grep -q 'native user phase output' "$T/out" || fail "in-progress user output lost"
	grep -q 'User phase exit: 0' "$T/out" && fail "interrupted capture reported user success"
	cmp -s "$T/out" "$VT_STATE/syslog" || fail "interrupted nightly report mismatch"
	eq 'interrupted nightly finalized once' 1 "$(grep -c '^logger ' "$VT_STATE/native.calls")"
	updates_preserved
}

t_rolling_system_installer_username() {
	inst_setup
	for user in root '-root' 'puffy;touch injected' 'puffy/x' 'puffy&root' ''; do
		printf '%s\n' "$user" >"$VT_STATE/out.stat"
		inst && fail "unsafe installer owner accepted: $user"
		notlogged '^pkg_add'
		notlogged '^crontab /'
	done
	[ ! -e injected ] || fail "installer owner text executed"
}
