# lib.sh: helpers for the test cases. The runner sources this, then the case
# files. Each case runs in its own subshell with its own scratch directory
# $T, so a case may set variables and exit freely.
#
# Inside a case:
#	$T		scratch directory, also the working directory
#	$VT_STATE	where the mocks read their fixtures and write their log
#	$REPO		the repository root (scripts are run from here)
#	fx NAME		write stdin to the fixture file $VT_STATE/NAME
#	setsysctl N V	make the sysctl mock answer V for N ("<missing>":
#			as if the node did not exist)
#	answers ...	one dmenu answer per argument, in order
#	eq DESC WANT GOT	fail unless GOT is WANT
#	has DESC NEEDLE TEXT	fail unless TEXT contains NEEDLE
#	hasnt DESC NEEDLE TEXT	fail if TEXT contains NEEDLE
#	logged PATTERN	fail unless a line of the mock log matches (grep -E)
#	notlogged PATTERN	fail if one does
#	fail MSG / skip MSG	end the case
#	xfail BUG	the case is expected to fail because of BUG
#	waitfor SECS CMD...	retry CMD every 0.1 s until it succeeds
#	track PID	stop this background process when the case ends
#	with_tty CMD...	run CMD with a terminal on stdin (mounter, unmounter)
#	pty CMDLINE	run the shell command line CMDLINE in a pseudo-terminal
#	derived SRC NAME SED	run a script with root-owned paths rewritten

fail() { printf 'FAIL: %s\n' "$*"; exit 1; }
skip() { printf '%s\n' "$*" >"$T/.skip"; exit 77; }
xfail() { printf '%s\n' "$*" >"$T/.xfail"; }

eq() {
	[ "$3" = "$2" ] && return 0
	printf 'FAIL: %s\n  want: [%s]\n  got:  [%s]\n' "$1" "$2" "$3"
	exit 1
}
has() {
	case $3 in *"$2"*) return 0 ;; esac
	printf 'FAIL: %s\n  wanted to find: [%s]\n  in: [%s]\n' "$1" "$2" "$3"
	exit 1
}
hasnt() {
	case $3 in *"$2"*)
		printf 'FAIL: %s\n  did not want: [%s]\n  in: [%s]\n' "$1" "$2" "$3"
		exit 1 ;;
	esac
	return 0
}
logged() {
	grep -Eq -- "$1" "$VT_STATE/log" 2>/dev/null && return 0
	printf 'FAIL: expected a call matching /%s/\n  log:\n' "$1"
	sed 's/^/    /' "$VT_STATE/log" 2>/dev/null
	exit 1
}
notlogged() {
	grep -Eq -- "$1" "$VT_STATE/log" 2>/dev/null || return 0
	printf 'FAIL: unexpected call matching /%s/\n  log:\n' "$1"
	sed 's/^/    /' "$VT_STATE/log"
	exit 1
}
# nlogged PATTERN: how many log lines match.
nlogged() { grep -Ec -- "$1" "$VT_STATE/log" 2>/dev/null; }

fx() { cat >"$VT_STATE/$1"; }
answers() { : >"$VT_STATE/answers"; for a; do printf '%s\n' "$a" >>"$VT_STATE/answers"; done; }
setsysctl() {
	f=$VT_STATE/sysctl
	[ -f "$f" ] && grep -v "^$1=" "$f" >"$f.new" && mv "$f.new" "$f"
	printf '%s=%s\n' "$1" "$2" >>"$f"
}

# waitfor SECS CMD...: poll, so a test waits only as long as it must.
waitfor() {
	_n=$(($1 * 10)); shift
	while [ "$_n" -gt 0 ]; do
		"$@" && return 0
		"$VT_REAL_SLEEP" 0.1
		_n=$((_n - 1))
	done
	return 1
}

# pty CMDLINE: run the shell command line CMDLINE under script(1), in a
# pseudo-terminal, stdin and stdout passed through. util-linux script wants
# -q and -e; OpenBSD's script has -c only (assumed: OpenBSD script(1) -c,
# not yet run on the machine); the Mac's takes the command after the file,
# and types ^D into the terminal when its stdin ends.
pty() {
	if script --version 2>/dev/null | grep -q util-linux; then
		script -qec "$1" /dev/null
	elif [ "$VT_HOST" = Darwin ]; then
		script -q /dev/null /bin/sh -c "$1"
	else
		script -c "$1" /dev/null
	fi
}

# with_tty CMD...: mounter and unmounter reopen themselves in a terminal
# when stdin is not one. The command's output goes to $T/tty.out; its exit
# status is not relied on.
with_tty() {
	command -v script >/dev/null 2>&1 || skip "no script(1) to provide a terminal"
	for _a; do printf "'%s' " "$(printf '%s' "$_a" | sed "s/'/'\\\\''/g")"; done >"$T/.ttycmd"
	pty "$VT_SH $T/.ttycmd" </dev/null >"$T/tty.out" 2>&1
}

# derived SRC NAME SEDSCRIPT: a few scripts write to paths only root may use
# (/var/run) or to real terminals (/dev/ttyp*). Running them as they are
# would touch the machine. This writes $T/NAME from the repository file,
# fresh on every run, with those paths rewritten, and prints its path.
# Only paths change; the logic under test is the repository's.
derived() {
	sed "$3" "$REPO/$1" >"$T/$2" || fail "cannot derive $2 from $1"
	chmod +x "$T/$2"
	printf '%s\n' "$T/$2"
}

# interp FILE: the interpreter FILE asks for, as this host provides it.
interp() {
	case $(sed -n 1p "$1") in
	'#!/bin/ksh'*) printf '%s\n' "$VT_KSH" ;;
	*) printf '%s\n' "$VT_SH" ;;
	esac
}

# track PID: a background process to stop when the case ends, even if it
# fails half way (sbar loops do not name $T on their command line).
track() { echo "$1" >>"$T/.pids"; }

# killstate: stop the tracked processes and every process whose command
# line names this case's scratch directory (entr watchers). The runner
# calls it after each case.
killstate() {
	for _p in $(cat "$T/.pids" 2>/dev/null) $("$VT_REAL_PGREP" -f "$T/" 2>/dev/null); do
		kill "$_p" 2>/dev/null
	done
}
