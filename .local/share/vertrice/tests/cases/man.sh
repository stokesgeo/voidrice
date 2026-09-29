# vertrice(7): the page parses, and the profile's MANPATH finds it.

t_man_lint() {
	command -v mandoc >/dev/null 2>&1 || skip "no mandoc"
	# Which other pages exist depends on the host (packages, a Linux box),
	# so a missing .Xr target and the host's mandoc.db are not the page's fault.
	out=$(mandoc -Tlint -Wstyle "$REPO/.local/share/man/man7/vertrice.7" 2>&1 |
		grep -v -e 'referenced manual not found' -e 'mandoc\.db')
	eq "mandoc -Tlint -Wstyle" "" "$out"
}

t_man_path() {
	line=$(grep '^export MANPATH=' "$REPO/.config/shell/profile")
	eq "profile appends XDG_DATA_HOME/man" 'export MANPATH=":$XDG_DATA_HOME/man"' "${line%%	*}"
	[ -f "$REPO/.local/share/man/man7/vertrice.7" ] || fail "no man7/vertrice.7"
}
