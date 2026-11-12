# Real isolated Neovim, synthetic files and private backup state only.
t_pi_ipe_live_editor() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for IPE IPC test'
	[ -n "$VT_REAL_NVIM" ] || skip 'Neovim unavailable for IPE IPC test'
	PATH="$(dirname "$VT_REAL_NVIM"):$PATH" node "$REPO/.local/share/vertrice/tests/pi-ipe.mjs" "$REPO" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
}
