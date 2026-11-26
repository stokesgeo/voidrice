# No npm/network or privilege calls: every installer dependency is mocked.
pi_setup() {
	for m in id node npm; do ln -s "$VT_MOCKS/_log" "$T/bin/$m"; done
	echo 1000 >"$VT_STATE/out.id"
	app=$HOME/.local/share/vertrice-pi
	mkdir -p "$HOME/.local/share/openbsd/pi/acquire"
	: >"$HOME/.local/share/openbsd/pi/acquire/prepare.mjs"
	mkdir -p "$HOME/.local/bin/openbsd"
	ln -s "$VT_MOCKS/_log" "$HOME/.local/bin/openbsd/vertrice-update"
}

t_pi_setup_refuses_root() {
	pi_setup
	echo 0 >"$VT_STATE/out.id"
	"$VT_SH" "$REPO/.local/bin/openbsd/vertrice-pi-setup" >"$T/out" 2>&1
	eq 'root refused' 1 "$?"
	notlogged '^npm '
}

t_pi_setup_repeat_skips_npm() {
	pi_setup
	mkdir -p "$app/node_modules"
	echo retained >"$app/node_modules/sentinel"
	"$VT_SH" "$REPO/.local/bin/openbsd/vertrice-pi-setup" >"$T/out" 2>&1 || fail 'setup repeat'
	notlogged '^npm |^vertrice-update '
	[ ! -e "$HOME/.pi" ] || fail 'existing profile unexpectedly initialized'
	eq 'existing installation preserved' retained "$(cat "$app/node_modules/sentinel")"
}

t_pi_setup_package_failure_stops() {
	pi_setup
	echo 17 >"$VT_STATE/rc.vertrice-update"
	"$VT_SH" "$REPO/.local/bin/openbsd/vertrice-pi-setup" >"$T/out" 2>&1
	eq 'updater failure preserved' 17 "$?"
	logged '^vertrice-update --pi --install-first --version 1.6.0$'
	notlogged '^npm ci '
	hasnt 'no false success' 'installed' "$(cat "$T/out")"
}

t_pi_setup_acquisition_failure_stops() {
	pi_setup
	echo 19 >"$VT_STATE/rc.node"
	"$VT_SH" "$REPO/.local/bin/openbsd/vertrice-pi-setup" >"$T/out" 2>&1
	eq 'acquisition failure preserved' 19 "$?"
	logged '^node .*pi/acquire/prepare.mjs .*vertrice-pi/build-inputs$'
	notlogged '^vertrice-update '
	[ ! -e "$app/profile" ] && [ ! -e "$app/current" ] || fail 'acquisition failure published runtime'
}

t_pi_setup_first_install_uses_shared_updater() {
	pi_setup
	"$VT_SH" "$REPO/.local/bin/openbsd/vertrice-pi-setup" >"$T/out" 2>&1 || fail 'first-install delegation'
	logged '^node .*pi/acquire/prepare.mjs .*vertrice-pi/build-inputs$'
	logged '^vertrice-update --pi --install-first --version 1.6.0$'
	notlogged '^npm ci '
	[ ! -e "$app/current" ] || fail 'setup published an unverified selector'
}

t_pi_launch_missing_does_not_install() {
	pi_setup
	"$VT_SH" "$REPO/.local/bin/openbsd/pi" >"$T/out" 2>&1
	eq 'missing user install' 1 "$?"
	notlogged '^npm '
}

t_pi_setup_broken_selector_preserved() {
	pi_setup
	mkdir -p "$app"
	ln -s missing "$app/current"
	"$VT_SH" "$REPO/.local/bin/openbsd/vertrice-pi-setup" >"$T/out" 2>&1 || fail 'broken selector preservation'
	eq 'broken selector retained' missing "$(readlink "$app/current")"
	notlogged '^vertrice-update |^npm ci '
}

t_pi_portable_updates() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for portable updater checks'
	node "$REPO/.local/share/vertrice/tests/portable-user-updates.cjs" || fail 'portable updater lifecycle'
}

t_pi_native_seed_preserves_owner_state() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for native seed check'
	node --input-type=module - "$REPO/.local/share/openbsd/pi/seed-settings.mjs" \
	    "$REPO/.local/share/openbsd/pi/settings.json" "$HOME/.pi/agent/settings.json" <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const [module, source, destination] = process.argv.slice(2);
const { seedSettings } = await import(pathToFileURL(module));
const original = fs.readFileSync(source);
assert.equal(seedSettings(source, destination), 'seeded');
assert(fs.readFileSync(destination).equals(original));
assert.equal(fs.statSync(dirname(destination)).mode & 0o777, 0o700);
const owner = '{"defaultModel":"owner-choice","lastChangelogVersion":"owner-state"}';
fs.writeFileSync(destination, owner);
assert.equal(seedSettings(source, destination), 'preserved');
assert.equal(fs.readFileSync(destination, 'utf8'), owner);
const empty = destination + '.empty';
fs.writeFileSync(empty, '');
assert.equal(seedSettings(source, empty), 'preserved');
assert.equal(fs.readFileSync(empty, 'utf8'), '');
const link = destination + '.link';
fs.symlinkSync(destination, link);
assert.equal(seedSettings(source, link), 'preserved');
assert(fs.lstatSync(link).isSymbolicLink());
assert.equal(fs.readFileSync(destination, 'utf8'), owner);
assert(fs.readFileSync(source).equals(original));
console.log('PASS native seed preserves owner state, empty file, symlink and public seed; new directories private');
JS
	[ $? -eq 0 ] || fail 'native seed preservation'
}

t_pi_terminal_theme_uses_live_palette() {
	command -v node >/dev/null 2>&1 || skip 'Node unavailable for theme check'
	node - "$REPO/.pi/agent/themes/vertrice.json" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const theme = JSON.parse(fs.readFileSync(process.argv[2]));
assert.equal(theme.name, 'vertrice');
assert.equal(theme.colors.toolSuccessBg, '');
assert.equal(theme.colors.userMessageBg, 7);
assert.equal(theme.colors.userMessageText, 0);
for (const role of ['muted', 'dim', 'thinkingText', 'toolOutput', 'borderMuted']) assert.equal(theme.colors[role], 8);
assert(Object.values(theme.colors).every(c => c === '' || (Number.isInteger(c) && c >= 0 && c < 16)));
JS
	[ $? -eq 0 ] || fail 'theme caches RGB instead of live terminal colors'
}

t_pi_launch_native_general_user() {
	pi_setup
	mkdir -p "$app/node_modules/.bin"
	ln -s "$VT_MOCKS/_log" "$app/node_modules/.bin/pi"
	"$VT_SH" "$REPO/.local/bin/openbsd/pi" --continue >"$T/out" 2>&1 || fail 'native launch'
	logged '^pi --continue$'
	notlogged '^npm |^doas |^codex-box '
}
