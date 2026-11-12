# Keep historical qualification out of installed guidance and startup context.
t_packaging_user_guidance() {
	for file in README.md .local/share/man/man7/vertrice.7 \
	    .local/share/vertrice/OPENBSD.md .local/share/vertrice/PI_CAPABILITIES.md \
	    .local/share/vertrice/POST-INSTALL.md; do
		if grep -En 'QEMU|rehearsal VM|arm64 VM|fixture reader|Current C coverage|C extensions|earlier B configuration|tests/check|/Users/[^/]+/' "$REPO/$file"; then
			fail "development context in user guidance: $file"
		fi
	done
}

t_packaging_pi_context() {
	if grep -REn 'QEMU|rehearsal VM|arm64 VM|fixture reader|Experimental C|/Users/[^/]+/|\.agents/corp-search/' \
	    "$REPO/.pi/agent/AGENTS.md" "$REPO/.pi/agent/context" "$REPO/.pi/agent/skills"; then
		fail 'development context in installed Pi instructions'
	fi
}

t_packaging_pi_seed() {
	command -v node >/dev/null 2>&1 || skip 'no node'
	node -e '
		const assert = require("node:assert/strict");
		const seed = require(process.argv[1]);
		assert.equal(seed.shellPath, "/bin/ksh");
		for (const key of ["provider", "model", "providers", "models", "mcpServers", "apiKey", "baseUrl"])
			assert.equal(Object.hasOwn(seed, key), false, "unexpected runtime default: " + key);
	' "$REPO/.local/share/openbsd/pi/settings.json" || fail 'Pi seed contains environment/account defaults'
}
