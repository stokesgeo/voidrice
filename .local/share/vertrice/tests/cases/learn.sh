# manpick, learn and the learn templates.

# manpick reads `apropos .` (mock: $VT_STATE/out.apropos) and opens the
# pick with man in $TERMINAL (xterm here, a mock that logs its arguments).
mp_setup() {
	fx out.apropos <<'EOF'
cat(1) - concatenate and print files
ksh, rksh(1) - public domain Korn shell
apm(4/amd64) - advanced power management
sysctl(2) - get or set (some) - values
EOF
}

t_manpick_names_and_section() {
	mp_setup
	answers "ksh, rksh(1) - public domain Korn shell"
	manpick || fail "manpick failed"
	logged '^apropos \.$'
	eq "the menu is apropos's list" "$(cat "$VT_STATE/out.apropos")" "$(cat "$VT_STATE/menu.1")"
	logged '^xterm -e man -s 1 ksh$'
}

t_manpick_machine_page() {
	mp_setup
	answers "apm(4/amd64) - advanced power management"
	manpick
	logged '^xterm -e man -s 4 -S amd64 apm$'
}

t_manpick_description_with_brackets() {
	mp_setup
	answers "sysctl(2) - get or set (some) - values"
	manpick
	logged '^xterm -e man -s 2 sysctl$'
}

t_manpick_typed() {
	mp_setup
	answers "ksh(1)"
	manpick
	logged '^xterm -e man -s 1 ksh$'
	answers "" "ls"
	manpick
	logged '^xterm -e man ls$'
}

t_manpick_escape_and_options() {
	mp_setup
	answers		# no answer for the first menu: Escape
	manpick; eq "Escape: exit 0" 0 "$?"
	answers "" "-k"
	manpick 2>/dev/null; eq "a name like an option: exit 1" 1 "$?"
	notlogged '^xterm'
}

# learn writes into $HOME/src/learn; HOME is this case's scratch home.
# The generated scripts start with #!/bin/ksh; to run them here that line
# names the ksh under test instead (the rest is what learn wrote).
L=
ln_setup() { L=$HOME/src/learn; }
to_vt_ksh() { for f; do sed "1s|^#!/bin/ksh|#!$VT_KSH|" "$f" >"$f.x" && mv "$f.x" "$f" && chmod +x "$f"; done; }

t_learn_ksh() {
	ln_setup
	learn new hello >"$T/out" || fail "learn new hello failed"
	d=$L/hello
	for f in hello tests/run; do [ -x "$d/$f" ] || fail "$f: not executable"; done
	[ -f "$d/tests/cases" ] || fail "no tests/cases"
	eq "placeholders filled" "" "$(grep -rl '@[A-Z]*@' "$d")"
	has "usage names the program" 'usage: ${0##*/}' "$(cat "$d/hello")"
	for f in hello tests/run tests/cases; do
		"$VT_KSH" -n "$d/$f" 2>"$T/err" || fail "$f does not parse: $(cat "$T/err")"
	done
	to_vt_ksh "$d/hello" "$d/tests/run"
	out=$("$d/tests/run" 2>&1) || fail "the fresh project's tests fail: $out"
	eq "tests of a fresh project" "PASS t_usage
== 1 cases: 1 passed, 0 failed" "$out"
	# A failing case shows as FAIL, and the run exits 1.
	printf 't_wrong() {\n\teq "sum" 2 3 || return 1\n}\n' >>"$d/tests/cases"
	out=$(cd / && "$d/tests/run" 2>&1); eq "a failure: exit 1" 1 "$?"
	has "FAIL line" "FAIL t_wrong" "$out"
	has "why" "want: [2]" "$out"
	has "total" "2 cases: 1 passed, 1 failed" "$out"
}

t_learn_c() {
	ln_setup
	VT_EPOCH=1788591600 learn new cat2 c >/dev/null || fail "learn new cat2 c failed"
	d=$L/cat2
	eq "files" "Makefile cat2.1 main.c" "$(cd "$d" && echo *)"
	eq "placeholders filled" "" "$(grep -rl '@[A-Z]*@' "$d")"
	has "PROG" "PROG=	cat2" "$(cat "$d/Makefile")"
	has "MAN" "MAN=	cat2.1" "$(cat "$d/Makefile")"
	has "bsd.prog.mk" ".include <bsd.prog.mk>" "$(cat "$d/Makefile")"
	has "title in capitals" ".Dt CAT2 1" "$(cat "$d/cat2.1")"
	has "date, no leading zero" '.Dd $Mdocdate: September 5 2026 $' "$(cat "$d/cat2.1")"
	has "pledge" 'pledge("stdio", NULL)' "$(cat "$d/main.c")"
	command -v cc >/dev/null 2>&1 || skip "no cc on this host"
	out=$(cc -fsyntax-only -Wall -Wextra -Werror "$d/main.c" 2>&1) ||
		fail "main.c: $out"
	command -v mandoc >/dev/null 2>&1 || return 0
	# -W warning: style(9), which the page cites, exists only on OpenBSD.
	out=$(mandoc -Tlint -W warning "$d/cat2.1" 2>&1) || fail "mandoc -Tlint: $out"
}

t_learn_refuses() {
	ln_setup
	mkdir -p "$L/old" && echo mine >"$L/old/notes"
	learn new old 2>/dev/null; eq "existing directory: exit 1" 1 "$?"
	eq "left alone" "notes" "$(cd "$L/old" && echo *)"
	for n in 1st a/b -x 'a b' 'a$b'; do
		learn new "$n" 2>/dev/null && fail "accepted the name [$n]"
	done
	learn new ok perl 2>/dev/null && fail "accepted the kind perl"
	learn 2>/dev/null && fail "no arguments: exit 0"
	eq "nothing made" "old" "$(cd "$L" && echo *)"
}
