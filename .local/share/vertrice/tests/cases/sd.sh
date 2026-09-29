# sd, a terminal in the focused window's directory. Off OpenBSD there is
# no kern.proc_cwd, so proc-cwd is a mock ($T/src/proc-cwd), as are xprop,
# ps and the terminal ($T/bin): they read $VT_STATE/procs, one process per
# line: pid ppid pgid cwd comm args... The window's pid is 100.

# sd_setup: the mocks, a built proc-cwd, and the directories the cases use.
sd_setup() {
	mkdir -p "$T/src" "$T/proj/sub" "$T/other" "$T/repo/sub" "$HOME"
	cat >"$T/bin/xprop" <<'EOF'
#!/bin/sh
case $1 in
-root) echo '_NET_ACTIVE_WINDOW(WINDOW): window id # 0x1400006' ;;
-id) [ "$2" = 0x1400006 ] && [ ! -e "$VT_STATE/nopid" ] &&
	echo '_NET_WM_PID(CARDINAL) = 100' ;;
esac
exit 0
EOF
	cat >"$T/bin/ps" <<'EOF'
#!/bin/sh
echo "ps $*" >>"$VT_STATE/log"
f=$VT_STATE/procs
case $* in
'-ax -o pid=,ppid=') awk '{ printf "%5d %5d\n", $1, $2 }' "$f" ;;
'-o args= -p '*) awk -v p="$4" '$1 == p { $1 = $2 = $3 = $4 = $5 = ""; sub(/^ +/, ""); print }' "$f" ;;
'-o comm= -p '*) awk -v p="$4" '$1 == p { print $5 }' "$f" ;;
'-o pgid= -p '*) awk -v p="$4" '$1 == p { printf "%5d\n", $3 }' "$f" ;;
*) echo "ps mock: unexpected $*" >&2; exit 1 ;;
esac
EOF
	cat >"$T/src/proc-cwd" <<'EOF'
#!/bin/sh
echo "proc-cwd $*" >>"$VT_STATE/log"
awk -v p="$1" '$1 == p && $4 != "-" { print $4; found = 1 } END { exit !found }' "$VT_STATE/procs"
EOF
	printf '#!/bin/sh\necho "xterm in $PWD" >>"$VT_STATE/log"\n' >"$T/bin/xterm"
	chmod +x "$T/bin/xprop" "$T/bin/ps" "$T/bin/xterm" "$T/src/proc-cwd"
	export SD_SRC="$T/src" SHELL=/bin/ksh
}

# opened DESC DIR: sd opened one terminal, in DIR.
opened() {
	eq "$1: terminals" 1 "$(nlogged '^xterm in ')"
	logged "^xterm in $2\$"
}

t_sd_shell() {
	sd_setup
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/proj ksh ksh
EOF
	sd || fail "sd failed"
	opened "the shell's directory" "$T/proj"
}

t_sd_deepest_first() {
	sd_setup
	# pstree -n order is 100 101 102 104 103; reversed, 103 comes first.
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/proj ksh ksh
103 101 103 $T/proj/sub vi vi notes
102 101 102 $T/other vi vi other
104 102 102 $T/repo less less
EOF
	sd || fail "sd failed"
	opened "the last, deepest process" "$T/proj/sub"
}

t_sd_lf_server_skipped() {
	sd_setup
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/proj ksh ksh
102 101 102 $T/other lf lf
103 102 103 $T/repo lf lf -server
EOF
	sd || fail "sd failed"
	opened "lf, not its server" "$T/other"
}

t_sd_git_skipped() {
	sd_setup
	# git and its pager show the repository's root; the shell is in sub.
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/repo/sub ksh ksh
102 101 102 $T/repo git git log
103 102 102 $T/repo less less
EOF
	sd || fail "sd failed"
	opened "git and its pager skipped" "$T/repo/sub"
}

t_sd_home_and_root_skipped() {
	sd_setup
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/proj ksh ksh
102 101 102 $HOME mpv mpv song.opus
103 101 103 / cmus cmus
EOF
	sd || fail "sd failed"
	opened "~ and / skipped" "$T/proj"
}

t_sd_shell_in_home_kept() {
	sd_setup
	# A shell stops the walk even at ~ ("zsh and lf won't be ignored").
	fx procs <<EOF
100 1 100 $T/other xterm xterm
101 100 101 $HOME ksh ksh
EOF
	sd || fail "sd failed"
	opened "the shell at home" "$HOME"
}

t_sd_other_users_process() {
	sd_setup
	# proc-cwd fails (EPERM): the process is skipped, not used.
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/proj ksh ksh
102 101 102 - doas doas vi /etc/pf.conf
EOF
	sd || fail "sd failed"
	opened "the unreadable process skipped" "$T/proj"
}

t_sd_no_window_pid() {
	sd_setup
	: >"$VT_STATE/nopid"
	fx procs <<EOF
100 1 100 $T/proj ksh ksh
EOF
	sd || fail "sd failed"
	opened "a plain terminal" "$T"
	notlogged '^proc-cwd'
}

t_sd_builds_helper() {
	sd_setup
	rm "$T/src/proc-cwd"
	: >"$T/src/proc-cwd.c"
	# make "builds" proc-cwd from the mock kept aside.
	cat >"$T/bin/make" <<EOF
#!/bin/sh
echo "make in \$PWD" >>"\$VT_STATE/log"
printf '#!/bin/sh\necho "proc-cwd \$*" >>"\$VT_STATE/log"\necho $T/proj\n' >proc-cwd
chmod +x proc-cwd
EOF
	chmod +x "$T/bin/make"
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/proj ksh ksh
EOF
	sd || fail "sd failed"
	logged "^make in $T/src\$"
	opened "built, then used" "$T/proj"
	# Built and newer than the source: not built again.
	: >"$VT_STATE/log"
	touch -t 200001010000 "$T/src/proc-cwd.c"
	sd || fail "sd failed the second time"
	notlogged '^make'
}

t_sd_build_fails() {
	sd_setup
	rm "$T/src/proc-cwd"
	: >"$T/src/proc-cwd.c"
	printf '#!/bin/sh\necho "make in $PWD" >>"$VT_STATE/log"\nexit 1\n' >"$T/bin/make"
	chmod +x "$T/bin/make"
	fx procs <<EOF
100 1 100 $HOME xterm xterm
101 100 101 $T/proj ksh ksh
EOF
	sd 2>/dev/null || fail "sd failed"
	logged '^make in '
	opened "a plain terminal" "$T"
	notlogged '^ps '
}

# proc-cwd itself: on OpenBSD, built and run against this shell. Elsewhere
# compiled with stand-ins for pledge, unveil, strtonum and sysctl, which
# check the mib and answer a fixed path: the kernel is not tested.
t_sd_proc_cwd_compiles() {
	c=$REPO/.local/src/sd/proc-cwd.c
	if [ "$(uname -s)" = OpenBSD ]; then
		cp "$c" "$REPO/.local/src/sd/Makefile" "$T/" || fail "cannot copy"
		make -C "$T" >/dev/null || fail "make failed"
		eq "its own cwd" "$T" "$("$T/proc-cwd" $$)"
		return
	fi
	command -v cc >/dev/null 2>&1 || skip "no C compiler"
	mkdir -p "$T/inc/sys"
	cat >"$T/inc/sys/sysctl.h" <<'EOF'
#define CTL_KERN	1
#define KERN_PROC_CWD	78
int sysctl(const int *, unsigned int, void *, size_t *, void *, size_t);
EOF
	cat >"$T/stub.h" <<'EOF'
#include <stddef.h>
int pledge(const char *, const char *);
int unveil(const char *, const char *);
long long strtonum(const char *, long long, long long, const char **);
EOF
	cat >"$T/stub.c" <<'EOF'
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int pledge(const char *p, const char *e)
{ fprintf(stderr, "pledge %s %s\n", p, e ? e : "NULL"); return 0; }
int unveil(const char *p, const char *m)
{ fprintf(stderr, "unveil %s %s\n", p ? p : "NULL", m ? m : "NULL"); return 0; }
long long strtonum(const char *s, long long lo, long long hi, const char **es)
{ char *end; long long n = strtoll(s, &end, 10);
  *es = (*s == '\0' || *end != '\0') ? "invalid" : n < lo ? "too small" : n > hi ? "too large" : NULL;
  return *es ? 0 : n; }
int sysctl(const int *mib, unsigned int n, void *old, size_t *len, void *new, size_t nl)
{ (void)nl; if (n != 3 || mib[0] != 1 || mib[1] != 78 || new) { errno = EINVAL; return -1; }
  if (mib[2] != 42) { errno = ESRCH; return -1; }
  snprintf(old, *len, "/home/you/proj"); *len = strlen(old) + 1; return 0; }
EOF
	cc -Wall -Wextra -Werror -I"$T/inc" -include "$T/stub.h" -o "$T/proc-cwd" \
		"$c" "$T/stub.c" 2>"$T/cc.err" || fail "does not compile: $(cat "$T/cc.err")"
	out=$("$T/proc-cwd" 42 2>"$T/err") || fail "pid 42 failed: $(cat "$T/err")"
	eq "the path" /home/you/proj "$out"
	eq "unveil, then pledge" "unveil NULL NULL
pledge stdio ps NULL" "$(cat "$T/err")"
	"$T/proc-cwd" 7 2>/dev/null && fail "no such process, yet exit 0"
	"$T/proc-cwd" 0 2>/dev/null && fail "pid 0 accepted"
	"$T/proc-cwd" 12x 2>/dev/null && fail "12x accepted"
	"$T/proc-cwd" 2>/dev/null && fail "no pid accepted"
	return 0
}
