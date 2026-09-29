# The update notice: vertrice-updates (root, from cron) counts base errata
# and package updates into one file; sb-updates shows it; sb-popupgrade
# updates in a terminal; vertrice-install's system stage installs the
# counter and root's crontab line. mock/syspatch, mock/pkg_add and
# mock/crontab stand in for the base tools.

up_setup() {
	cat >"$T/bin/id" <<'EOF'
#!/bin/sh
[ "$1" = -u ] && { echo 0; exit 0; }
exec /usr/bin/id "$@"
EOF
	chmod +x "$T/bin/id"
	export VERTRICE_UPDATES=$T/updates
	counter=$REPO/.local/share/openbsd/vertrice-updates
}
release() { setsysctl kern.version 'OpenBSD 7.8 (GENERIC.MP) #1: Mon Oct 13 2025'; }
snapshot() { setsysctl kern.version 'OpenBSD 7.8-current (GENERIC.MP) #42: Sun Sep 27 2026'; }
# pkg_add -u -n -v output, as read in pkg_add's source: an update set is
# named old->new, and may show more than once (with a step in brackets).
pkgout() {
	fx out.pkg_add <<'EOF'
quirks-7.140 signed on 2026-09-28T10:00:00Z
Adding quirks-7.140->7.141 (pretending)
Adding mpv-0.40.0->0.40.1 (pretending)
mpv-0.40.0->0.40.1 (extracting)
Adding ffmpeg-7.1p2->7.1p3 (pretending)
EOF
}

t_updates_release_counts() {
	up_setup; release; pkgout
	printf '001_net\n002_kern\n' | fx out.syspatch
	"$VT_KSH" "$counter" || fail "counter failed"
	logged '^syspatch -c$'
	logged '^pkg_add -u -n -v$'
	eq "base" "base=2" "$(grep '^base=' "$T/updates")"
	eq "packages" "packages=3" "$(grep '^packages=' "$T/updates")"
	grep -q '^checked=[0-9-]* [0-9:]*$' "$T/updates" || fail "no checked time"
	eq "world-readable" "-rw-r--r--" "$(ls -l "$T/updates" | cut -c1-10)"
	eq "no temporary file left" "" "$(ls "$T" | grep '^updates\.')"
	eq "bar" "📦3 🩹2" "$(sb-updates)"
}

t_updates_snapshot() {
	up_setup; snapshot; pkgout
	"$VT_KSH" "$counter" || fail "counter failed"
	notlogged '^syspatch'
	eq "base" "base=snapshot" "$(grep '^base=' "$T/updates")"
	eq "bar: packages only" "📦3" "$(sb-updates)"
}

t_updates_nothing_or_failed() {
	up_setup; release
	"$VT_KSH" "$counter" || fail "counter failed"
	eq "nothing waiting" "base=0
packages=0" "$(grep -v '^checked=' "$T/updates")"
	eq "bar empty" "" "$(sb-updates)"
	echo 1 >"$VT_STATE/rc.pkg_add"; echo 1 >"$VT_STATE/rc.syspatch"
	"$VT_KSH" "$counter" || fail "counter failed"
	eq "failed checks" "base=?
packages=?" "$(grep -v '^checked=' "$T/updates")"
	eq "bar shows the unknown" "📦? 🩹?" "$(sb-updates)"
	rm -f "$T/updates"
	eq "no file: nothing" "" "$(sb-updates)"
}

t_updates_needs_root() {
	[ "$(id -u)" = 0 ] && skip "the suite itself runs as root"
	export VERTRICE_UPDATES=$T/updates
	"$VT_KSH" "$REPO/.local/share/openbsd/vertrice-updates" 2>/dev/null &&
		fail "ran without root"
	[ -e "$T/updates" ] && fail "wrote the file"
	return 0
}

t_updates_click_opens_terminal() {
	up_setup
	BLOCK_BUTTON=1 sb-updates >/dev/null
	logged '^detach xterm -e sb-popupgrade$'
}

# sb-popupgrade in a terminal: one "y", then Enter to close.
popup() {
	script --version 2>/dev/null | grep -q util-linux || skip "needs util-linux script(1) to feed a terminal"
	printf 'y\n\n' | script -qec "$VT_SH $REPO/.local/bin/statusbar/sb-popupgrade" /dev/null >"$T/tty.out" 2>&1
}

t_popupgrade_release() {
	up_setup; release; popup
	logged '^doas /usr/sbin/syspatch$'
	logged '^doas /usr/sbin/pkg_add -u$'
	logged '^doas /usr/local/sbin/vertrice-updates$'
}

t_popupgrade_snapshot() {
	up_setup; snapshot; popup
	notlogged 'syspatch'
	notlogged 'sysupgrade'	# it reboots: said, not run
	logged '^doas /usr/sbin/pkg_add -u$'
	grep -q 'snapshot: sysupgrade -s' "$T/tty.out" || fail "no word about sysupgrade: $(cat "$T/tty.out")"
}

t_popupgrade_no_terminal() {
	sb-popupgrade </dev/null
	logged '^xterm -e .*sb-popupgrade$'
	notlogged '^doas'
}

# The system stage: install the counter, add root's crontab line, once.
sys_setup() {
	up_setup
	cat >"$T/bin/install" <<'EOF'
#!/bin/sh
args=
while getopts o:g:m:d o; do
	case $o in m) args="$args -m $OPTARG" ;; d) args="$args -d" ;; esac
done
shift $((OPTIND - 1))
exec /usr/bin/install $args "$@"
EOF
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/pkg_info"
	chmod +x "$T/bin/install" "$T/bin/pkg_info"
	mkdir -p "$T/root/etc" "$T/root/root"
	echo 'wheel:*:0:root,geo' >"$T/root/etc/group"
	echo 'geo:*:1000:1000:staff:0:0:Geo:/home/geo:/bin/ksh' >"$T/root/etc/master.passwd"
	printf 'staff:\\\n\t:tc=default:\n' >"$T/root/etc/login.conf"
	printf '0\t*\t*\t*\t*\t/usr/bin/newsyslog\n' >"$VT_STATE/crontab.root"
	export ROOT=$T/root VERTRICE_USER=geo
}

t_install_updates() {
	sys_setup
	out=$(vertrice-install system)
	has "plan: counter" "would   install /usr/local/sbin/vertrice-updates" "$out"
	has "plan: cron" "would   add vertrice-updates to root's crontab" "$out"
	[ -e "$ROOT/usr/local/sbin/vertrice-updates" ] && fail "dry run installed the counter"
	notlogged '^crontab -u root -$'
	vertrice-install -y system >"$T/out" 2>&1	# other steps fail here: no rcctl
	cmp -s "$counter" "$ROOT/usr/local/sbin/vertrice-updates" || fail "counter not installed"
	eq "mode" "-rwxr-xr-x" "$(ls -l "$ROOT/usr/local/sbin/vertrice-updates" | cut -c1-10)"
	eq "root's crontab: kept, plus the line" "0	*	*	*	*	/usr/bin/newsyslog
~	*/4	*	*	*	-ns /usr/local/sbin/vertrice-updates" "$(cat "$VT_STATE/crontab.root")"
	out=$(vertrice-install -y system 2>&1)
	has "second run: counter" "ok      /usr/local/sbin/vertrice-updates is vertrice's" "$out"
	has "second run: cron" "ok      root's crontab runs vertrice-updates" "$out"
	eq "line added once" 1 "$(grep -c vertrice-updates "$VT_STATE/crontab.root")"
}
