#!/bin/sh

# Standalone, deterministic OpenBSD memory-accounting regression. No desktop
# processes or caches are touched. Optional argument tests an installed copy.
set -eu
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
module=${1:-$here/../../../bin/statusbar/sb-memory}
t=$(mktemp -d "${TMPDIR:-/tmp}/sb-memory-test.XXXXXXXXXX")
trap 'rm -rf "$t"' EXIT
trap 'exit 1' HUP INT TERM
mkdir "$t/bin"
cat >"$t/bin/uname" <<'EOF'
#!/bin/sh
printf 'OpenBSD\n'
EOF
cat >"$t/bin/sysctl" <<'EOF'
#!/bin/sh
[ "$*" = '-n hw.physmem' ] || exit 1
printf '%s\n' "$PHYS"
EOF
cat >"$t/bin/vmstat" <<'EOF'
#!/bin/sh
[ "$*" = '-s' ] || exit 1
[ "$LC_ALL" = C ] || exit 1
cat "$COUNTERS"
EOF
cat >"$t/bin/swapctl" <<'EOF'
#!/bin/sh
[ "$*" = '-s' ] || exit 1
[ "$SWAP" != none ] || exit 1
printf 'total: 12582912 512-blocks allocated, %s used, 0 available\n' "$SWAP"
EOF
cat >"$t/bin/top" <<'EOF'
#!/bin/sh
exit 99
EOF
chmod +x "$t/bin/"*
PATH=$t/bin:$PATH
PHYS=8589934592 SWAP=4194304 COUNTERS=$t/counters
export PATH PHYS SWAP COUNTERS
unset BLOCK_BUTTON
check() {
	actual=$(sh "$module")
	[ "$actual" = "$2" ] || {
		printf 'FAIL %s: expected <%s>, got <%s>\n' "$1" "$2" "$actual" >&2
		exit 1
	}
	printf 'PASS %s\n' "$1"
}
reject() {
	if actual=$(sh "$module"); then
		printf 'FAIL %s: invalid counters accepted\n' "$1" >&2
		exit 1
	fi
	[ -z "$actual" ] || exit 1
	printf 'PASS %s\n' "$1"
}
cat >"$COUNTERS" <<'EOF'
       4096 bytes per page
    2000000 pages managed
     524288 pages free
     100000 pages active
     200000 pages inactive
      12345 pages wired
EOF
check 'physical minus free, not active or managed' '🧠6.00GiB/8.00GiB 🐌 2.00/6.00GiB'
SWAP=2097152
check 'swap does not change RAM used' '🧠6.00GiB/8.00GiB 🐌 1.00/6.00GiB'
SWAP=none
check 'unavailable swap leaves RAM visible' '🧠6.00GiB/8.00GiB'
printf '8192 bytes per page\n262144 pages free\n' >"$COUNTERS"
check 'native page size, not hardcoded 4096' '🧠6.00GiB/8.00GiB'
printf '4096 bytes per page\n0 pages free\n' >"$COUNTERS"
check 'zero free is valid' '🧠8.00GiB/8.00GiB'
printf '4096 bytes per page\n2097152 pages free\n' >"$COUNTERS"
check 'all physical RAM free' '🧠0.00GiB/8.00GiB'
printf '4096 bytes per page\n' >"$COUNTERS"
reject 'missing free counter'
printf '1 pages free\n' >"$COUNTERS"
reject 'missing page size'
printf '4096 bytes per page\n2097153 pages free\n' >"$COUNTERS"
reject 'free exceeds physical RAM'
printf '4096 bytes per page\n1 pages free\n' >"$COUNTERS"
PHYS=0
reject 'invalid physical total'
