# vertrice-install: the system half, run as root on the machine. Here a copy
# of the installer sits beside a copy of its data (so doas-agent.conf can
# hold a rule), with /etc and /root rewritten to $R (see derived in lib.sh).
# pkg_add, pfctl, doas and crontab are mocks; rcctl and newaliases log;
# stat names the checkout's owner, "puffy".

inst_setup() {
	R=$T/sys
	mkdir -p "$T/x/bin" "$T/x/share" "$R/etc/hotplug" "$R/etc/login.conf.d" "$R/root" "$R/var/db" "$R/usr/local/sbin" "$R/usr/local/bin"
	cp -R "$REPO/.local/share/openbsd" "$T/x/share/"
	echo 'permit nopass :wheel as root cmd /usr/sbin/rcctl args restart sndiod' \
		>>"$T/x/share/openbsd/doas-agent.conf"
	derived .local/bin/vertrice-install x/bin/vertrice-install \
		"s|/etc/|$R/etc/|g; s|/root/|$R/root/|g; s|/var/db/hotplug-disk|$R/var/db/hotplug-disk|g; s|/var/db/clamav|$R/var/db/clamav|g; s|/usr/local/share/examples/clamav/certs/clamav.crt|$T/clamav.crt|g; s|/usr/local/bin/|$R/usr/local/bin/|g; s|upgrade.sh /usr/local/sbin/vertrice-upgrade|upgrade.sh $R/usr/local/sbin/vertrice-upgrade|" >/dev/null
	# Verify the future root:wheel argv without changing fixture ownership.
	cat >"$T/bin/install" <<'EOF'
#!/bin/sh
printf 'install %s\n' "$*" >>"$VT_STATE/log"
if [ "$1" = -d ]; then
	shift
	if [ "$1" = -o ]; then shift 4; fi
	exec /usr/bin/install -d "$@"
fi
if [ "$1" = -o ]; then shift 4; fi
exec /usr/bin/install "$@"
EOF
	chmod +x "$T/bin/install"
	printf 'package CA fixture\n' >"$T/clamav.crt"
	ln -s "$VT_MOCKS/_log" "$R/usr/local/bin/freshclam"
	for m in rcctl stat newaliases; do ln -s "$VT_MOCKS/_log" "$T/bin/$m"; done
	printf '#!/bin/sh\necho user\n' >"$T/bin/id"; chmod +x "$T/bin/id"
	echo puffy >"$VT_STATE/out.stat"	# stat -f %Su: the checkout's owner
	printf '0\t*\t*\t*\t*\t/usr/bin/newsyslog\n' >"$VT_STATE/crontab.user"
	printf '0\t9\t*\t*\t1\tlogger monday\n' >"$VT_STATE/crontab.puffy"
	mkdir -p "$R/etc/mail"
	printf 'daemon:\troot\n# Well-known aliases -- these should be filled in!\n# root:\n' >"$R/etc/mail/aliases"
	printf '/dev/ttyC0\t0600\t/dev/console\n' >"$R/etc/fbtab"
	data=$T/x/share/openbsd
	joined=$T/joined
	cat "$data/doas.conf" "$data/doas-agent.conf" >"$joined"
}
inst_run() { "$VT_SH" "$T/x/bin/vertrice-install" >"$T/out" 2>&1; }
inst() { printf 'yes\n' | inst_run; }
inst_fragments() {
	cat "$data/updates.cron"
	sed 's/@USER@/puffy/g' "$data/upgrade.cron"
}

t_install_consent() {
	inst_setup
	inst || fail "explicit consent rejected: $(cat "$T/out")"
	has "overwrite warning" 'overwrites system configuration and firewall rules' "$(cat "$T/out")"
	has "reset warning" 'resets service settings and power tuning' "$(cat "$T/out")"
	has "explicit prompt" 'Type yes to continue:' "$(cat "$T/out")"
	logged '^pkg_add -l pkglist$'
}

inst_cancelled() {
	has "clean cancellation" 'cancelled; no changes made' "$(cat "$T/out")"
	[ ! -s "$VT_STATE/log" ] || fail "commands ran before consent: $(cat "$VT_STATE/log")"
	diff -r "$T/sys.before" "$R" || fail "system files changed without consent"
	cmp -s "$T/cron.before" "$VT_STATE/crontab.user" || fail "crontab changed without consent"
}

inst_cancel_setup() {
	inst_setup
	# A refusal must not even run the exit trap's cleanup.
	echo 'existing staging file' >"$R/etc/doas.new"
	cp -R "$R" "$T/sys.before"
	cp "$VT_STATE/crontab.user" "$T/cron.before"
}

t_install_decline() {
	inst_cancel_setup
	for reply in no '' y YES 'yes please'; do
		printf '%s\n' "$reply" | inst_run && fail "accepted refusal: $reply"
		inst_cancelled
	done
}

t_install_eof() {
	inst_cancel_setup
	inst_run </dev/null && fail "accepted EOF"
	inst_cancelled
	printf yes | inst_run && fail "accepted incomplete input at EOF"
	inst_cancelled
}

t_install_system() {
	inst_setup; inst
	logged '^pkg_add -l pkglist$'
	cmp -s "$T/clamav.crt" "$R/etc/clamav-certs/clamav.crt" || fail "CA not installed"
	cmp -s "$data/freshclam.conf" "$R/etc/freshclam.conf" || fail "refresh config not installed"
	logged "^freshclam --config-file=$R/etc/freshclam.conf --foreground\$"
	[ -d "$R/var/db/clamav" ] || fail "database directory not installed"
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
	cmp -s "$data/hotplug-detach" "$R/etc/hotplug/detach" || fail "no /etc/hotplug/detach"
	cmp -s "$data/usbctl" "$R/usr/local/bin/usbctl" || fail "no usbctl"
	[ -f "$R/var/db/hotplug-disk" ] && [ ! -s "$R/var/db/hotplug-disk" ] ||
		fail "no empty /var/db/hotplug-disk for hotplug-watch"
	cmp -s "$data/upgrade.sh" "$R/usr/local/sbin/vertrice-upgrade" || fail "updater not installed"
	[ -n "$(find "$R/usr/local/sbin/vertrice-upgrade" -perm 0755)" ] || fail "updater mode is not 0755"
	logged "^install -o root -g wheel -m 755 upgrade.sh $R/usr/local/sbin/vertrice-upgrade\$"
	eq "root's crontab: kept, plus both updater jobs" "$(printf '0\t*\t*\t*\t*\t/usr/bin/newsyslog\n'; inst_fragments)" \
		"$(cat "$VT_STATE/crontab.user")"
	logged '^rcctl enable apmd hotplugd unwind$'
	logged '^rcctl enable messagebus obsdfreqd$'
	logged '^rcctl set apmd flags -L -z 17$'
	logged '^rcctl set obsdfreqd flags -m 100,75 -r 20,90 -T 85,60$'
	cmp -s "$data/wsconsctl.conf" "$R/etc/wsconsctl.conf" || fail "wsconsctl.conf"
	[ -e "$R/etc/sysctl.conf" ] && fail "sysctl.conf written: recording is per call (rec)"
	eq "fbtab: kept, plus the camera" "$(printf '/dev/ttyC0\t0600\t/dev/console\n'; cat "$data/fbtab")" "$(cat "$R/etc/fbtab")"
	logged "^stat -f %Su $T/x/bin/vertrice-install\$"
	eq "the owner's crontab: left alone, no calendar job" "$(printf '0\t9\t*\t*\t1\tlogger monday\n')" \
		"$(cat "$VT_STATE/crontab.puffy")"
	eq "root's mail to the owner" "root: puffy" "$(grep '^root:' "$R/etc/mail/aliases")"
	logged '^newaliases $'
}

t_install_mail_kept() {
	# A root alias already set is left alone.
	inst_setup
	echo 'root: someone@example.org' >>"$R/etc/mail/aliases"
	inst
	eq "root alias kept" 'root: someone@example.org' "$(grep '^root:' "$R/etc/mail/aliases")"
	logged '^newaliases $'
}

t_install_twice() {
	# A second run keeps the agent doas rules and adds the cron line once.
	inst_setup; inst; inst
	cmp -s "$joined" "$R/etc/doas.conf" || fail "agent rules dropped: $(cat "$R/etc/doas.conf")"
	eq "one check job" 1 "$(grep -c '^~.*/usr/local/sbin/vertrice-upgrade --check$' "$VT_STATE/crontab.user")"
	eq "one update job" 1 "$(grep -c '^30.*/usr/local/sbin/vertrice-upgrade --nightly puffy # vertrice-overnight-upgrade$' "$VT_STATE/crontab.user")"
	grep -q '@USER@' "$VT_STATE/crontab.user" && fail "nightly placeholder was deployed"
	eq "one owned check marker" 1 "$(grep -c '^# vertrice-update-count (root per-user table)$' "$VT_STATE/crontab.user")"
	eq "one owned update marker" 1 "$(grep -c '^# vertrice-overnight-upgrade (root per-user table)$' "$VT_STATE/crontab.user")"
	eq "no calendar job" 0 "$(grep -c calendar "$VT_STATE/crontab.puffy")"
	eq "the owner's own job kept" 1 "$(grep -c 'logger monday' "$VT_STATE/crontab.puffy")"
	eq "one root alias" 1 "$(grep -c '^root:' "$R/etc/mail/aliases")"
	echo sd1 >"$R/var/db/hotplug-disk"; inst
	eq "the last disk's name kept" sd1 "$(cat "$R/var/db/hotplug-disk")"
}

t_install_doas_rejected() {
	inst_setup
	echo 'permit persist :wheel' >"$R/etc/doas.conf"
	echo 1 >"$VT_STATE/rc.doas"
	inst
	eq "doas.conf unchanged" 'permit persist :wheel' "$(cat "$R/etc/doas.conf")"
}

# Failure injection is local to this fixture, not the shared command mocks.
inst_cron_mock() {
	cat >"$T/bin/crontab" <<'EOF'
#!/bin/sh
if [ "$1" = -l ] && [ -e "$VT_STATE/cron.read.rc" ]; then
	echo 'crontab -l' >>"$VT_STATE/log"
	cat "$VT_STATE/cron.read.out" 2>/dev/null
	cat "$VT_STATE/cron.read.err" >&2
	exit "$(cat "$VT_STATE/cron.read.rc")"
fi
if [ "$1" != -l ] && [ -e "$VT_STATE/cron.write.fail" ]; then
	echo 'crontab write rejected' >>"$VT_STATE/log"
	exit 1
fi
exec "$VT_MOCKS/crontab" "$@"
EOF
	chmod +x "$T/bin/crontab"
}

t_install_cron_absent() {
	inst_setup
	rm "$VT_STATE/crontab.user"
	inst || fail "absent table rejected: $(cat "$T/out")"
	eq "new table" "$(inst_fragments)" "$(cat "$VT_STATE/crontab.user")"
	inst || fail "repeat failed"
	eq "repeat unchanged" "$(inst_fragments)" "$(cat "$VT_STATE/crontab.user")"
}

t_install_cron_read_failure() {
	inst_setup; inst_cron_mock
	cp "$VT_STATE/crontab.user" "$T/cron.original"
	printf 'crontab: /var/cron/tabs/root: Permission denied\n' >"$VT_STATE/cron.read.err"
	echo 1 >"$VT_STATE/cron.read.rc"
	inst && fail "read failure accepted"
	cmp -s "$T/cron.original" "$VT_STATE/crontab.user" || fail "table replaced"
	has "clear read error" 'cannot read crontab; not replacing it' "$(cat "$T/out")"
	notlogged '^crontab /'
	notlogged '^rcctl'
}

t_install_cron_partial_read_refused() {
	inst_setup; inst_cron_mock
	cp "$VT_STATE/crontab.user" "$T/cron.original"
	echo 'crontab: no crontab for user' >"$VT_STATE/cron.read.err"
	echo 'partial table' >"$VT_STATE/cron.read.out"
	echo 1 >"$VT_STATE/cron.read.rc"
	inst && fail "partial failed read accepted as absent"
	cmp -s "$T/cron.original" "$VT_STATE/crontab.user" || fail "table replaced"
}

t_install_cron_wrong_absent_status() {
	inst_setup; inst_cron_mock
	echo 'crontab: no crontab for user' >"$VT_STATE/cron.read.err"
	echo 2 >"$VT_STATE/cron.read.rc"
	inst && fail "wrong absent status accepted"
	notlogged '^crontab /'
}

t_install_cron_absent_diagnostic_must_be_exact() {
	inst_setup; inst_cron_mock
	echo 1 >"$VT_STATE/cron.read.rc"
	for message in 'crontab: no crontab for someone-else' 'crontab: no crontab for user (read error)' ''; do
		printf '%s\n' "$message" >"$VT_STATE/cron.read.err"
		inst && fail "nonexact absent diagnostic accepted: $message"
	done
	notlogged '^crontab /'
}

t_install_cron_unrelated_and_legacy() {
	inst_setup
	printf '0 1 * * * cp /var/db/updates /tmp/update-history\n# monitor /var/db/updates\n' >>"$VT_STATE/crontab.user"
	cat >>"$VT_STATE/crontab.user" <<'EOF'
MAILTO=operator
SHELL=/bin/ksh

30 3 * * * /usr/local/sbin/vertrice-upgrade --custom
~	*/4	*	*	*	-ns (syspatch -c; pkg_add -u -n -v | grep "^Adding.*->" | sort -u) >/var/db/updates.custom
# vertrice-update-count (root per-user table) extra
0 2 * * * logger unrelated # vertrice-update-count extra
EOF
	cp "$VT_STATE/crontab.user" "$T/cron.unrelated"
	# Exact historical rows, suffix markers, and repeated current blocks.
	cat >>"$VT_STATE/crontab.user" <<'EOF'
# /var/db/updates: what syspatch and pkg_add -u would install, one a line; sb-updates counts them.
~	*/4	*	*	*	-ns (syspatch -c; pkg_add -u -n -v | grep "^Adding.*->" | sort -u) >/var/db/updates
30	3	*	*	* /usr/local/sbin/vertrice-upgrade
30	3	*	*	*	-s /usr/local/sbin/vertrice-upgrade
0 2 * * * logger old-job # vertrice-update-count
30 3 * * * /usr/local/sbin/vertrice-upgrade # vertrice-overnight-upgrade
EOF
	# An orphan standalone marker must not swallow the unrelated following job.
	printf '# vertrice-update-count (root per-user table)\n0 6 * * * logger preserve-me\n' >>"$VT_STATE/crontab.user"
	printf '0 6 * * * logger preserve-me\n' >>"$T/cron.unrelated"
	cat "$data/updates.cron" "$data/upgrade.cron" "$data/updates.cron" "$data/upgrade.cron" >>"$VT_STATE/crontab.user"
	inst || fail "migration failed"
	{ cat "$T/cron.unrelated"; inst_fragments; } >"$T/cron.expected"
	cmp -s "$T/cron.expected" "$VT_STATE/crontab.user" || fail "unrelated entries lost or legacy retained"
	inst || fail "repeat migration failed"
	cmp -s "$T/cron.expected" "$VT_STATE/crontab.user" || fail "repeat changed table"
}

t_install_cron_generation_failure() {
	inst_setup
	cp "$VT_STATE/crontab.user" "$T/cron.original"
	for fragment in updates.cron upgrade.cron; do
		mv "$data/$fragment" "$T/$fragment.saved"
		inst && fail "missing $fragment accepted"
		cmp -s "$T/cron.original" "$VT_STATE/crontab.user" || fail "table replaced on generation failure"
		mv "$T/$fragment.saved" "$data/$fragment"
	done
	notlogged '^crontab /'
}

t_install_cron_filter_failure() {
	inst_setup
	printf '#!/bin/sh\nexit 1\n' >"$T/bin/awk"; chmod +x "$T/bin/awk"
	inst && fail "filter failure accepted"
	notlogged '^crontab /'
}

t_install_cron_install_failure() {
	inst_setup; inst_cron_mock
	cp "$VT_STATE/crontab.user" "$T/cron.original"
	: >"$VT_STATE/cron.write.fail"
	inst && fail "crontab install failure accepted"
	cmp -s "$T/cron.original" "$VT_STATE/crontab.user" || fail "table replaced despite rejection"
	notlogged '^rcctl'
}

t_install_pf_rejected() {
	inst_setup
	printf 'pass\n' >"$R/etc/pf.conf"
	echo 1 >"$VT_STATE/rc.pfctl"
	inst
	eq "pf.conf unchanged" pass "$(cat "$R/etc/pf.conf")"
	notlogged '^pfctl -f'
}

t_install_package_failure_stops() {
	inst_setup
	echo 1 >"$VT_STATE/rc.pkg_add"
	if inst; then fail "package failure reported success"; fi
	notlogged '^doas -C'
	[ ! -e "$R/etc/pf.conf" ] || fail "configuration changed after package failure"
}

t_install_signature_failure_stops() {
	inst_setup
	printf 'existing policy\n' >"$R/etc/doas.conf"
	cp "$VT_STATE/crontab.user" "$T/cron.original"
	echo 54 >"$VT_STATE/rc.freshclam"
	inst && fail "signature acquisition failure accepted"
	logged "^freshclam --config-file=$R/etc/freshclam.conf --foreground\$"
	notlogged '^doas -C'
	notlogged '^rcctl'
	notlogged '^crontab'
	eq "policy preserved after refresh failure" 'existing policy' "$(cat "$R/etc/doas.conf")"
	cmp -s "$T/cron.original" "$VT_STATE/crontab.user" || fail "cron replaced after refresh failure"
	[ -f "$R/etc/freshclam.conf" ] || fail "completed nontransactional setup missing"
}

t_install_certificate_failure_stops() {
	inst_setup
	rm "$T/clamav.crt"
	inst && fail "missing package CA accepted"
	notlogged '^freshclam'
	notlogged '^doas -C'
}

t_install_doas_failure_stops() {
	inst_setup
	echo 1 >"$VT_STATE/rc.doas"
	if inst; then fail "doas validation failure reported success"; fi
	notlogged '^pfctl'
}

t_install_pf_failure_stops() {
	inst_setup
	echo 1 >"$VT_STATE/rc.pfctl"
	if inst; then fail "pf validation failure reported success"; fi
	notlogged '^rcctl'
}

t_install_appends_once() {
	inst_setup; inst
	cp "$R/etc/wsconsctl.conf" "$T/wsconsctl.first"
	cp "$R/etc/fbtab" "$T/fbtab.first"
	inst
	cmp -s "$T/wsconsctl.first" "$R/etc/wsconsctl.conf" || fail "wsconsctl.conf duplicated on rerun"
	cmp -s "$T/fbtab.first" "$R/etc/fbtab" || fail "fbtab duplicated on rerun"
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
	# neighbour discovery, and OpenBSD's _pbuild block stays.
	eq "active rules" "set skip on lo
block in
pass out
pass in inet6 proto icmp6 icmp6-type { neighbrsol neighbradv routeradv }
block return out log proto {tcp udp} user _pbuild" \
		"$(sed 's/[[:space:]]*#.*//' "$REPO/.local/share/openbsd/pf.conf" | grep .)"
}

# /etc/apm/suspend: a fake xidle in $T records the signal it gets. SIGUSR1
# is what makes the real one start xlock; anything else would kill it.
t_apm_suspend_locks() {
	command -v cc >/dev/null 2>&1 || skip "no C compiler for the named xidle fixture"
	# A real executable has the process name that pkill -x matches.
	cat >"$T/xidle.c" <<'EOF'
#include <signal.h>
#include <stdio.h>
#include <unistd.h>

static volatile sig_atomic_t received;
static void caught(int sig) { received = sig; }
int main(void) {
    FILE *f;
    sigset_t blocked, previous;
    sigemptyset(&blocked);
    sigaddset(&blocked, SIGUSR1);
    sigaddset(&blocked, SIGTERM);
    sigprocmask(SIG_BLOCK, &blocked, &previous);
    signal(SIGUSR1, caught);
    signal(SIGTERM, caught);
    f = fopen("xidle.ready", "w");
    if (!f) return 1;
    fclose(f);
    while (!received) sigsuspend(&previous);
    f = fopen("xidle.got", "w");
    if (!f) return 1;
    fputs(received == SIGUSR1 ? "USR1\n" : "TERM\n", f);
    return fclose(f) != 0;
}
EOF
	cc -o "$T/xidle" "$T/xidle.c" || fail "cannot build xidle fixture"
	"$T/xidle" &
	track $!
	waitfor 2 test -e "$T/xidle.ready" || fail "fake xidle never installed its handlers"
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
