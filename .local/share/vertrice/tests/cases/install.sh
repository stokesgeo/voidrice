# vertrice-install pf: the optional laptop pf.conf. It runs as root on the
# machine; here ROOT puts /etc under the scratch directory, $T/bin/id says
# uid 0, and $T/bin/install drops -o and -g (only root may give files to
# root). pfctl is the logging mock: rc.pfctl makes it reject the file.

pf_setup() {
	mkdir -p "$T/root/etc"
	printf 'set skip on lo\nblock return\npass\n' >"$T/root/etc/pf.conf"
	cp "$T/root/etc/pf.conf" "$T/default.pf"
	cat >"$T/bin/id" <<'EOF'
#!/bin/sh
[ "$1" = -u ] && { echo 0; exit 0; }
exec /usr/bin/id "$@"
EOF
	cat >"$T/bin/install" <<'EOF'
#!/bin/sh
args=
while getopts o:g:m:d o; do
	case $o in m) args="$args -m $OPTARG" ;; d) args="$args -d" ;; esac
done
shift $((OPTIND - 1))
exec /usr/bin/install $args "$@"
EOF
	chmod +x "$T/bin/id" "$T/bin/install"
	export ROOT=$T/root
	sample=$REPO/.local/share/openbsd/pf.conf
}

t_install_pf_plan() {
	pf_setup
	out=$(vertrice-install pf) || fail "plan failed: $out"
	has "plan says what it would do" "would   install /etc/pf.conf" "$out"
	has "plan parses the sample" "ok      pfctl -nf accepts" "$out"
	has "dry run" "Dry run: nothing changed." "$out"
	cmp -s "$T/default.pf" "$ROOT/etc/pf.conf" || fail "plan changed /etc/pf.conf"
	notlogged '^pfctl -f'
}

t_install_pf_apply() {
	pf_setup
	out=$(vertrice-install -y pf) || fail "apply failed: $out"
	cmp -s "$sample" "$ROOT/etc/pf.conf" || fail "/etc/pf.conf is not the sample"
	cmp -s "$T/default.pf" "$ROOT/etc/pf.conf.orig" || fail "no pf.conf.orig of the old file"
	logged "^pfctl -nf $ROOT/etc/pf.conf.vertrice\$"
	logged "^pfctl -f $ROOT/etc/pf.conf\$"
	[ -e "$ROOT/etc/pf.conf.vertrice" ] && fail "temporary file left"
	: >"$VT_STATE/log"
	out=$(vertrice-install -y pf) || fail "second run failed: $out"
	has "second run: already done" "ok      /etc/pf.conf is vertrice's" "$out"
	notlogged '^pfctl'
}

t_install_pf_rejected() {
	pf_setup
	echo 1 >"$VT_STATE/rc.pfctl"
	vertrice-install -y pf >"$T/out" 2>&1 && fail "exit 0 although pfctl rejected the file"
	cmp -s "$T/default.pf" "$ROOT/etc/pf.conf" || fail "/etc/pf.conf changed"
	[ -e "$ROOT/etc/pf.conf.vertrice" ] && fail "temporary file left"
	notlogged '^pfctl -f'
}

t_install_pf_needs_root() {
	[ "$(id -u)" = 0 ] && skip "the suite itself runs as root"
	mkdir -p "$T/root/etc"
	ROOT=$T/root vertrice-install -y pf >"$T/out" 2>&1 && fail "ran without root"
	[ -e "$T/root/etc/pf.conf" ] && fail "wrote pf.conf"
	grep -q 'must run as root' "$T/out" || fail "no reason given: $(cat "$T/out")"
}

t_install_pf_sample() {
	# The sample opens nothing inbound: every "pass in" is commented out
	# except IPv6 neighbour discovery.
	sample=$REPO/.local/share/openbsd/pf.conf
	got=$(grep -E '^[[:space:]]*pass[[:space:]]+in' "$sample")
	eq "the only active pass in" \
		"pass in inet6 proto icmp6 icmp6-type { neighbrsol neighbradv routeradv }" "$got"
	grep -qx 'block in' "$sample" || fail "no default block in"
	grep -qx 'pass out' "$sample" || fail "no pass out"
	grep -qx 'block return in quick on ! lo0 proto tcp to port 6000:6010' "$sample" ||
		fail "the default X11 block is gone"
}

# /etc/apm/suspend: a fake xidle in $T records the signal it gets. SIGUSR1
# is what makes the real one start xlock; anything else would kill it.
t_apm_suspend_locks() {
	cat >"$T/xidle" <<'EOF'
#!/bin/sh
trap 'echo USR1 >"$0.got"; exit 0' USR1
trap 'echo TERM >"$0.got"; exit 0' TERM
while :; do sleep 0.1; done
EOF
	chmod +x "$T/xidle"
	"$T/xidle" &
	track $!
	waitfor 2 "$VT_REAL_PGREP" -x xidle || fail "fake xidle never started"
	VT_SLEEP=0 sh "$REPO/.local/share/openbsd/apm-suspend" || fail "exit status not 0"
	logged '^pkill -USR1 -x xidle$'
	waitfor 2 test -e "$T/xidle.got" || fail "xidle got no signal"
	eq "signal xidle got" USR1 "$(cat "$T/xidle.got")"
}

t_apm_suspend_no_x() {
	# No X session: nothing to lock, and suspend must still go ahead.
	sh "$REPO/.local/share/openbsd/apm-suspend" || fail "exit status not 0 without xidle"
	logged '^pkill -USR1 -x xidle$'
}
