#!/bin/sh
# Standalone, hardware-free regression: sh .local/share/vertrice/tests/brightness.sh
set -eu
REPO=$(CDPATH='' cd -- "$(dirname "$0")/../../../.." && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/brightness-test.XXXXXXXX")
trap 'rm -rf "$T"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$T/bin"
export T
PATH="$T/bin:$PATH"
export PATH
cp "$REPO/.local/bin/statusbar/sb-brightness" "$T/bin/"
cp "$REPO/.local/bin/statusbar/sb-battery" "$T/bin/"
cat >"$T/bin/xbacklight" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$T/calls"
case $1 in
-get)
	[ "${FAIL_GET:-0}" = 0 ] || exit 1
	if [ -f "$T/set" ] && [ "${FAIL_READBACK:-0}" = 1 ]; then exit 1; fi
	cat "$T/level" ;;
-set)
	[ "${FAIL_SET:-0}" = 0 ] || exit 1
	[ "$3" = -time ] && [ "$4" = 0 ] || exit 2
	if [ "${QUANTIZED:-0}" = 1 ]; then
		# A 0..15 panel truncating requests: 25% reads back as 20%.
		awk -v level="$2" 'BEGIN { printf "%.6f\n", int(level * 15 / 100 + 0.000001) * 100 / 15 }' >"$T/level"
	else
		printf '%s\n' "$2" >"$T/level"
	fi
	: >"$T/set" ;;
*) exit 2 ;;
esac
EOF
cat >"$T/bin/apm" <<'EOF'
#!/bin/sh
case $1 in -l) echo 80 ;; -a) echo 1 ;; -b) echo 0 ;; *) exit 1 ;; esac
EOF
cat >"$T/bin/uname" <<'EOF'
#!/bin/sh
echo OpenBSD
EOF
cat >"$T/bin/wsconsctl" <<'EOF'
#!/bin/sh
echo 'FAIL: privileged backend invoked' >&2
exit 99
EOF
chmod +x "$T/bin/"*
fail() { echo "FAIL: $*" >&2; exit 1; }
eq() { [ "$1" = "$2" ] || fail "$3: expected <$1>, got <$2>"; }
reset() { printf '%s\n' "$1" >"$T/level"; : >"$T/calls"; rm -f "$T/set"; }
reject() {
	if "$@" >"$T/out" 2>"$T/err"; then fail "unexpected success: $*"; fi
	[ ! -s "$T/out" ] || fail 'error printed a success level'
}
unset BLOCK_BUTTON
reset 66.666667
eq '💡66%' "$(sb-brightness)" 'read decimal'
eq '-get' "$(cat "$T/calls")" 'read does not set'
reset 60
eq '💡50%' "$(sb-brightness down)" decrease
eq 50 "$(cat "$T/level")" 'decrease backend'
eq '💡60%' "$(sb-brightness up)" increase
reset 25
eq '💡25%' "$(sb-brightness down)" floor
[ ! -f "$T/set" ] || fail 'floor down caused a write'
reset 20
eq '💡20%' "$(sb-brightness down)" 'below-floor down unchanged'
[ ! -f "$T/set" ] || fail 'below-floor down caused a write'
reset 40
eq '💡26%' "$(QUANTIZED=1 sb-brightness down)" 'quantized decrease'
eq '💡20%' "$(QUANTIZED=1 sb-brightness down)" 'quantized requested floor'
grep -q '^-set 25 -time 0$' "$T/calls" || fail 'missing requested floor'
rm -f "$T/set"
eq '💡20%' "$(QUANTIZED=1 sb-brightness down)" 'quantized floor stable'
[ ! -f "$T/set" ] || fail 'quantized below-floor down caused a write'
eq '💡26%' "$(QUANTIZED=1 sb-brightness up)" 'quantized recovery'
reset 0
eq '💡25%' "$(sb-brightness up)" 'recover from below floor'
reset 99
eq '💡100%' "$(sb-brightness up)" ceiling
reset 50
eq '💡60%' "$(BLOCK_BUTTON=4 sb-brightness)" 'brightness scroll up'
eq '💡50%' "$(BLOCK_BUTTON=5 sb-brightness)" 'brightness scroll down'
reset 60
eq '🛑80%' "$(BLOCK_BUTTON=5 sb-battery)" 'battery display/decrease'
eq 50 "$(cat "$T/level")" 'battery decrease backend'
eq '🛑80%' "$(BLOCK_BUTTON=4 sb-battery)" 'battery increase'
eq 60 "$(cat "$T/level")" 'battery increase backend'
for value in '' bogus -1 101 '1 2' '10%' '50
60'; do
	reset "$value"
	reject sb-brightness down
	[ ! -f "$T/set" ] || fail 'invalid read caused a write'
done
reset 50
reject sb-brightness sideways
reject sb-brightness up extra
eq '' "$(cat "$T/calls")" 'bad arguments must not access backend'
reject env FAIL_GET=1 sb-brightness down
[ ! -f "$T/set" ] || fail 'failed get caused a write'
reject env FAIL_SET=1 sb-brightness up
eq 50 "$(cat "$T/level")" 'failed set unchanged'
reject env FAIL_READBACK=1 sb-brightness down
reset 50
reject env BLOCK_BUTTON=4 FAIL_SET=1 sb-battery
conf=$REPO/.config/cwm/cwmrc
grep -Eq '^bind-key 4-End[[:space:]]+"sb-brightness down"$' "$conf" || fail 'missing decrease binding'
grep -Eq '^bind-key 4-Home[[:space:]]+"sb-brightness up"$' "$conf" || fail 'missing increase binding'
# Interrupt a copy just after trap setup, before any backend can run.
# The marker must never be reached; EXIT must still remove its mock directory.
for signal in HUP INT TERM; do
	case $signal in HUP) expected=129 ;; INT) expected=130 ;; TERM) expected=143 ;; esac
	awk -v signal="$signal" -v record="$T/signal-dir" -v marker="$T/fell-through" '
	    { print }
	    /^trap .*143.* TERM$/ {
	        print "printf \047%s\\n\047 \042$T\042 >\042" record "\042"
	        print "kill -" signal " $$"
	        print "echo unsafe >\042" marker "\042"
	        print "exit 99"
	    }' "$0" >"$T/signal.sh"
	status=0
	sh "$T/signal.sh" || status=$?
	eq "$expected" "$status" "$signal exit"
	[ ! -e "$(cat "$T/signal-dir")" ] || fail "$signal did not clean up"
	[ ! -e "$T/fell-through" ] || fail "$signal fell through"
done
echo 'PASS: brightness read/change/request clamps, quantized recovery, below-floor down, signal exit/cleanup, scroll entrypoints, invalid reads/arguments, backend failures, cwm commands'
