# vertrice-install: the system half, run as root on the machine. Here a copy
# of the installer sits beside a copy of its data (so doas-agent.conf can
# hold a rule), with /etc and /root rewritten to $R (see derived in lib.sh).
# pkg_add, pfctl, doas and crontab are mocks; rcctl logs.

inst_setup() {
	R=$T/sys
	mkdir -p "$T/x/bin" "$T/x/share" "$R/etc/hotplug" "$R/etc/login.conf.d" "$R/root"
	cp -R "$REPO/.local/share/openbsd" "$T/x/share/"
	echo 'permit nopass :wheel as root cmd /usr/sbin/rcctl args restart sndiod' \
		>>"$T/x/share/openbsd/doas-agent.conf"
	derived .local/bin/vertrice-install x/bin/vertrice-install \
		"s|/etc/|$R/etc/|g; s|/root/|$R/root/|g" >/dev/null
	ln -s "$VT_MOCKS/_log" "$T/bin/rcctl"
	printf '0\t*\t*\t*\t*\t/usr/bin/newsyslog\n' >"$VT_STATE/crontab.user"
	printf '/dev/ttyC0\t0600\t/dev/console\n' >"$R/etc/fbtab"
	data=$T/x/share/openbsd
	joined=$T/joined
	cat "$data/doas.conf" "$data/doas-agent.conf" >"$joined"
}
inst() { "$VT_SH" "$T/x/bin/vertrice-install" >"$T/out" 2>&1; }

t_install_system() {
	inst_setup; inst
	logged '^pkg_add -l pkglist$'
	cmp -s "$joined" "$R/etc/doas.conf" || fail "doas.conf is not doas.conf + doas-agent.conf"
	logged "^doas -C $R/etc/doas.new\$"
	[ -e "$R/etc/doas.new" ] && fail "doas.new left"
	cmp -s "$data/root.kshrc" "$R/root/.kshrc" || fail "no /root/.kshrc"
	cmp -s "$data/login.conf.d/staff" "$R/etc/login.conf.d/staff" || fail "no staff class"
	logged '^pfctl -nf pf.conf$'
	logged "^pfctl -f $R/etc/pf.conf\$"
	cmp -s "$data/pf.conf" "$R/etc/pf.conf" || fail "pf.conf not installed"
	cmp -s "$data/apm-suspend" "$R/etc/apm/suspend" || fail "no /etc/apm/suspend"
	eq "hibernate" suspend "$(readlink "$R/etc/apm/hibernate")"
	cmp -s "$data/hotplug-attach" "$R/etc/hotplug/attach" || fail "no /etc/hotplug/attach"
	eq "root's crontab: kept, plus the update count" "$(printf '0\t*\t*\t*\t*\t/usr/bin/newsyslog\n'; cat "$data/updates.cron")" \
		"$(cat "$VT_STATE/crontab.user")"
	logged '^rcctl enable apmd hotplugd messagebus obsdfreqd unwind$'
	logged '^rcctl set apmd flags -z 7$'
	logged '^rcctl set obsdfreqd flags -m 100,50 -r 50,90 -T 85,65$'
	cmp -s "$data/wsconsctl.conf" "$R/etc/wsconsctl.conf" || fail "wsconsctl.conf"
	[ -e "$R/etc/sysctl.conf" ] && fail "sysctl.conf written: recording is per call (rec)"
	eq "fbtab: kept, plus the camera" "$(printf '/dev/ttyC0\t0600\t/dev/console\n'; cat "$data/fbtab")" "$(cat "$R/etc/fbtab")"
}

t_install_twice() {
	# A second run keeps the agent doas rules and adds the cron line once.
	inst_setup; inst; inst
	cmp -s "$joined" "$R/etc/doas.conf" || fail "agent rules dropped: $(cat "$R/etc/doas.conf")"
	eq "one update job" 1 "$(grep -c '^~.*/var/db/updates' "$VT_STATE/crontab.user")"
	eq "one update comment" 1 "$(grep -c '^#.*/var/db/updates' "$VT_STATE/crontab.user")"
}

t_install_doas_rejected() {
	inst_setup
	echo 'permit persist :wheel' >"$R/etc/doas.conf"
	echo 1 >"$VT_STATE/rc.doas"
	inst
	eq "doas.conf unchanged" 'permit persist :wheel' "$(cat "$R/etc/doas.conf")"
}

t_install_pf_rejected() {
	inst_setup
	printf 'pass\n' >"$R/etc/pf.conf"
	echo 1 >"$VT_STATE/rc.pfctl"
	inst
	eq "pf.conf unchanged" pass "$(cat "$R/etc/pf.conf")"
	notlogged '^pfctl -f'
}

t_install_staff_class() {
	# One record: staff:\ first, :tc=default: last, every line between a
	# :cap:\ continuation; base staff's own caps kept (login.conf.d replaces
	# the whole record, login.conf(5)).
	f=$REPO/.local/share/openbsd/login.conf.d/staff
	rec=$(grep -v '^#' "$f")
	eq "first" 'staff:\' "$(printf '%s\n' "$rec" | sed -n 1p)"
	eq "last" '	:tc=default:' "$(printf '%s\n' "$rec" | sed -n '$p')"
	eq "continuations" "" "$(printf '%s\n' "$rec" | sed '1d;$d' | grep -v '^	:[^:]*:\\$')"
	for c in datasize-cur=4096M openfiles-cur=4096 maxproc-max=512 ignorenologin requirehome@; do
		grep -q ":$c:" "$f" || fail "no $c"
	done
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
