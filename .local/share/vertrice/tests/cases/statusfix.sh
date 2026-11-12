# Bounded status/theme regressions. No live fetchers, root paths or X server.

statusfix_upgrade() {
	# Only the terminal guard and root count path change in this copy.
	popup=$(derived .local/bin/statusbar/sb-popupgrade popup \
		"/\[ -t 0 \]/d; s|/var/db/updates|$T/updates|g")
	cat >"$T/bin/doas" <<'EOF'
#!/bin/sh
echo "doas $*" >>"$VT_STATE/log"
case $1 in
syspatch) exit "${FAIL_BASE:-0}" ;;
pkg_add) exit "${FAIL_PACKAGES:-0}" ;;
rm) [ "$*" = "rm -f $T/updates" ] || exit 99
	[ "${FAIL_CLEAR:-0}" = 0 ] || exit 1
	exec "$VT_REAL_RM" -f "$T/updates" ;;
*) exit 99 ;;
esac
EOF
	ln -s "$VT_MOCKS/_log" "$T/bin/sb-refresh"
	chmod +x "$T/bin/doas"
	echo pending >"$T/updates"
	printf '\n' | "$VT_SH" "$popup" >"$T/output" 2>&1
	result=$?
}

t_statusfix_upgrade_success() {
	statusfix_upgrade
	eq "success status" 0 "$result"
	[ ! -e "$T/updates" ] || fail "count not cleared"
	eq "upgrade, clear, refresh order" "doas syspatch|doas pkg_add -u|doas rm -f $T/updates|sb-refresh " \
		"$(paste -sd '|' "$VT_STATE/log")"
	has "success notice" 'Upgrade complete.' "$(cat "$T/output")"
}

t_statusfix_upgrade_base_failure() {
	export FAIL_BASE=1
	statusfix_upgrade
	eq "failure status" 1 "$result"
	eq "count retained" pending "$(cat "$T/updates")"
	notlogged '^doas pkg_add|^doas rm|^sb-refresh'
	has "failure notice" 'Upgrade failed.' "$(cat "$T/output")"
	hasnt "no success notice" 'Upgrade complete.' "$(cat "$T/output")"
}

t_statusfix_upgrade_package_failure() {
	export FAIL_PACKAGES=1
	statusfix_upgrade
	eq "failure status" 1 "$result"
	eq "count retained" pending "$(cat "$T/updates")"
	logged '^doas syspatch$'; logged '^doas pkg_add -u$'
	notlogged '^doas rm|^sb-refresh'
	hasnt "no success notice" 'Upgrade complete.' "$(cat "$T/output")"
}

t_statusfix_upgrade_clear_failure() {
	export FAIL_CLEAR=1
	statusfix_upgrade
	eq "clear failure status" 1 "$result"
	eq "count retained" pending "$(cat "$T/updates")"
	notlogged '^sb-refresh'
	hasnt "no success notice" 'Upgrade complete.' "$(cat "$T/output")"
}

# Exercise each worker's unchanged lock/retry/trap body synchronously in a
# child sh. Only its lock path changes; fetch/check functions are fixtures.
# Self-signalling inside the fetch stand-in tests exit-through-cleanup,
# without waiting on a network client or signalling unrelated processes.
statusfix_worker() {
	command -v python3 >/dev/null 2>&1 || skip "no python3 to reset inherited signal dispositions"
	name=$1
	cat >"$T/worker" <<'EOF'
fetch() {
	echo fetch >>"$VT_STATE/log"
	[ -z "$TEST_SIGNAL" ] || kill -"$TEST_SIGNAL" $$
	return 0
}
getforecast() { fetch; }
getip() { fetch; }
getmoon() { fetch; }
updateprice() { fetch; }
checkforecast() { return 0; }
checkip() { return 0; }
checkmoon() { return 0; }
checkprice() { return 0; }
EOF
	sed -n '/exec >\/dev\/null 2>&1; lock=/,/sb-refresh/p' \
		"$REPO/.local/bin/statusbar/$name" |
		sed "1s/.*lock=/lock=/; s|/tmp/|$T/|g" >>"$T/worker"
	grep -q 'mkdir "\$lock"' "$T/worker" || fail "no worker extracted"
	ln -s "$VT_MOCKS/_log" "$T/bin/sb-refresh"
	lock="$T/$name-$(id -u).lock"
	TEST_SIGNAL= "$VT_SH" "$T/worker" || fail "normal worker failed"
	[ ! -d "$lock" ] || fail "normal exit left lock"
	logged '^fetch$'; logged '^sb-refresh'
	: >"$VT_STATE/log"
	mkdir "$lock"
	TEST_SIGNAL= "$VT_SH" "$T/worker" >/dev/null 2>&1
	[ -d "$lock" ] || fail "contender removed another lock"
	notlogged '^fetch|^sb-refresh'
	rmdir "$lock"
	for pair in HUP:129 INT:130 TERM:143; do
		: >"$VT_STATE/log"
		# The suite backgrounds each case, so sh inherits SIGINT ignored.
		# Reset it before exec: a shell cannot trap a signal ignored on entry.
		TEST_SIGNAL=${pair%:*} python3 - "$VT_SH" "$T/worker" <<'EOF'
import os, signal, sys
for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, signal.SIG_DFL)
os.execv(sys.argv[1], sys.argv[1:])
EOF
		rc=$?
		eq "$name ${pair%:*} status" "${pair#*:}" "$rc"
		[ ! -d "$lock" ] || fail "$name ${pair%:*} left lock"
		eq "signal exits without retry/refresh" fetch "$(cat "$VT_STATE/log")"
	done
}

t_statusfix_forecast_lock() { statusfix_worker sb-forecast; }
t_statusfix_iplocate_lock() { statusfix_worker sb-iplocate; }
t_statusfix_moonphase_lock() { statusfix_worker sb-moonphase; }
t_statusfix_price_lock() { statusfix_worker sb-price; }

t_statusfix_xresources_order() {
	# Source the whole profile, with every external action replaced. A marker
	# at base-load completion must already exist when setbg starts its merge.
	cat >"$T/profile-test" <<'EOF'
xrandr() { :; }
xrdb() {
	"$VT_REAL_SLEEP" .1
	echo base >"$T/resources"
	: >"$T/base-done"
}
setbg() {
	[ -f "$T/base-done" ] || echo bad-order >"$T/bad-order"
	echo wal >>"$T/resources"
}
pgrep() { return 0; }
remaps() { :; }
hotplug-watch() { :; }
dump() { return 1; }
rm() { :; }
theme() { echo "theme $*" >>"$VT_STATE/log"; }
. "$REPO/.config/x11/xprofile"
wait
EOF
	PALETTE=wal "$VT_SH" "$T/profile-test" || fail "wal profile failed"
	[ ! -e "$T/bad-order" ] || fail "setbg ran before base load completed"
	eq "base before palette merge" 'base|wal' "$(paste -sd '|' "$T/resources")"
	notlogged '^theme auto$'; logged '^theme clock$'
	: >"$VT_STATE/log"
	PALETTE=auto "$VT_SH" "$T/profile-test" || fail "auto profile failed"
	logged '^theme auto$'; logged '^theme clock$'
}
