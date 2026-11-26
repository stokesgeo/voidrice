# Shared core; no live personal home, harness, network or credential access.
t_agents_core() {
	node "$REPO/.local/share/vertrice/tests/agents-core.mjs" "$REPO"
}
t_agents_generated() {
	node "$REPO/.local/share/vertrice/tests/agents-generated.mjs" "$REPO"
}
t_agents_pi() {
	node "$REPO/.local/share/vertrice/tests/agents-pi.mjs" "$REPO"
}
