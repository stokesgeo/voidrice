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
	logged '^xterm -e man 1 ksh$'
}

t_manpick_machine_page() {
	mp_setup
	answers "apm(4/amd64) - advanced power management"
	manpick
	logged '^xterm -e man 4 apm$'
}

t_manpick_description_with_brackets() {
	mp_setup
	answers "sysctl(2) - get or set (some) - values"
	manpick
	logged '^xterm -e man 2 sysctl$'
}

t_manpick_typed() {
	mp_setup
	answers "ksh(1)"
	manpick
	logged '^xterm -e man 1 ksh$'
	answers "" "ls"
	manpick
	logged '^xterm -e man ls$'
}

t_manpick_escape() {
	mp_setup
	answers		# no answer: Escape
	manpick
	notlogged '^xterm'
}
