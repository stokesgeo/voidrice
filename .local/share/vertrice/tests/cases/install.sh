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
	# The active rules, comments stripped: nothing opens inbound but IPv6
	# neighbour discovery, and OpenBSD's X11 and _pbuild blocks stay.
	eq "active rules" "set skip on lo
block in
pass out
pass in inet6 proto icmp6 icmp6-type { neighbrsol neighbradv routeradv }
antispoof quick for lo0
block return in quick on ! lo0 proto tcp to port 6000:6010
block return out log proto {tcp udp} user _pbuild" \
		"$(sed 's/[[:space:]]*#.*//' "$REPO/.local/share/openbsd/pf.conf" | grep .)"
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
	VT_SLEEP=0 sh "$REPO/.local/share/openbsd/apm-suspend"
	logged '^pkill -USR1 -x xidle$'
	waitfor 2 test -e "$T/xidle.got" || fail "xidle got no signal"
	eq "signal xidle got" USR1 "$(cat "$T/xidle.got")"
}

t_apm_suspend_no_x() {
	# No X session: nothing to lock. apmd ignores the exit status
	# (apmd.c, do_etc_file), so suspend goes ahead either way.
	sh "$REPO/.local/share/openbsd/apm-suspend"
	logged '^pkill -USR1 -x xidle$'
}

# vertrice-install system keeps the agent doas rules: /etc/doas.conf is
# doas.conf followed by doas-agent.conf. The case runs a copy of the
# installer beside a copy of its data, so doas-agent.conf can hold a rule;
# root is faked as in pf_setup, and the package, rc and user commands are
# logging mocks.
doas_setup() {
	pf_setup
	mkdir -p "$T/x/bin" "$T/x/share" "$ROOT/etc" "$ROOT/root"
	cp "$REPO/.local/bin/vertrice-install" "$T/x/bin/"
	cp -R "$REPO/.local/share/openbsd" "$T/x/share/"
	echo 'permit nopass :wheel as root cmd /usr/sbin/rcctl args restart sndiod' \
		>>"$T/x/share/openbsd/doas-agent.conf"
	echo 'wheel:*:0:root,user' >"$ROOT/etc/group"
	echo 'user:*:1000:1000:staff:0:0:User:/home/user:/bin/ksh' >"$ROOT/etc/master.passwd"
	for c in pkg_add pkg_info rcctl usermod cap_mkdb; do ln -s "$VT_MOCKS/_log" "$T/bin/$c"; done
	export VERTRICE_USER=user
	joined=$T/joined
	cat "$T/x/share/openbsd/doas.conf" "$T/x/share/openbsd/doas-agent.conf" >"$joined"
}

t_install_doas_keeps_agent_rules() {
	doas_setup
	cp "$joined" "$ROOT/etc/doas.conf"
	out=$("$VT_KSH" "$T/x/bin/vertrice-install" system 2>&1)
	has "plan: already vertrice's" "ok      /etc/doas.conf is vertrice's" "$out"
	"$VT_KSH" "$T/x/bin/vertrice-install" -y system >"$T/out" 2>&1
	cmp -s "$joined" "$ROOT/etc/doas.conf" ||
		fail "the agent rules were dropped: $(cat "$ROOT/etc/doas.conf")"
	notlogged '^doas -C'
	# An /etc/doas.conf without the agent rules gets them, after doas -C.
	cp "$T/x/share/openbsd/doas.conf" "$ROOT/etc/doas.conf"
	"$VT_KSH" "$T/x/bin/vertrice-install" -y system >"$T/out" 2>&1
	cmp -s "$joined" "$ROOT/etc/doas.conf" || fail "not installed joined: $(cat "$T/out")"
	logged "^doas -C $ROOT/etc/doas.conf.vertrice\$"
	[ -e "$ROOT/etc/doas.conf.vertrice" ] && fail "temporary file left"
	return 0
}
