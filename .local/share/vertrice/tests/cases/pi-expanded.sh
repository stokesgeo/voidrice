# Experimental C policy tests. Native Pi/provider tests are a separate fixture.
t_pi_expanded_child_policy() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for expanded Pi policy'
	node "$REPO/.local/share/vertrice/tests/pi-expanded-policy.mjs" "$REPO" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
}

t_pi_expanded_native_cancellation() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for owned-child cancellation'
	node "$REPO/.local/share/vertrice/tests/pi-expanded-cancel.mjs" "$REPO" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
}

t_pi_work_plaintext_and_context() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for plaintext work checks'
	node "$REPO/.local/share/openbsd/pi/context-index.mjs" "$REPO/.pi/agent" --check >"$T/out" 2>&1 || fail "$(cat "$T/out")"
	node "$REPO/.local/share/vertrice/tests/pi-work.mjs" "$REPO" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
}

t_pi_self_modification() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for self-modification checks'
	node "$REPO/.local/share/vertrice/tests/pi-self.mjs" "$REPO" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
}

t_pi_conversation_labels() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for conversation checks'
	node "$REPO/.local/share/vertrice/tests/action-summary-test.mjs" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
	node "$REPO/.local/share/vertrice/tests/pi-conversation.mjs" "$REPO" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
}

t_pi_subagent_renderer() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for renderer checks'
	node "$REPO/.local/share/vertrice/tests/pi-render.mjs" "$REPO" >"$T/out" 2>&1 || fail "$(cat "$T/out")"
}
