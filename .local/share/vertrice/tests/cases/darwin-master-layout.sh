# Run the helper safety fixtures against the shipped defaults.
t_darwin_master_layout() {
	command -v python3 >/dev/null 2>&1 || skip "no Python 3"
	[ -x "$REPO/.config/aerospace/master-layout" ] || fail "master-layout not executable"
	python3 "$REPO/.local/share/vertrice/tests/master-layout.py" || fail "master-layout safety fixtures failed"
}
