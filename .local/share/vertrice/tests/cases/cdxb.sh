# cdxb, the Codex box. Off OpenBSD there is no unveil or pledge, so these
# cases test cdxb's own logic, not the kernel's walls: $T/src/codex-box is
# a mock that logs its arguments, writes each -u wall to $VT_STATE/walls
# and runs the program after "--"; Codex is a script ($T/fakecodex).

# cdxb_setup: a home with the dotfiles' grants and deny list, a project
# with a git directory, and the mocks.
cdxb_setup() {
	unset PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR PI_PACKAGE_DIR
	mkdir -p "$HOME/.config/cdxb" "$HOME/.config/shell" "$HOME/.local/bin" \
		"$HOME/.local/share/openbsd/codex" "$HOME/src/proj/.git/hooks" \
		"$HOME/Documents" "$T/src"
	cp "$REPO/.config/cdxb/deny" "$REPO/.config/cdxb/grants" "$HOME/.config/cdxb/"
	cp "$REPO/.local/share/openbsd/codex/config.toml" \
		"$REPO/.local/share/openbsd/codex/AGENTS.md" "$HOME/.local/share/openbsd/codex/"
	cp "$REPO/.local/share/openbsd/doas.conf" \
		"$REPO/.local/share/openbsd/doas-agent.conf" "$HOME/.local/share/openbsd/"
	: >"$HOME/.config/shell/profile"
	ln -s .config/shell/profile "$HOME/.profile"
	: >"$HOME/src/proj/.git/config"
	cat >"$T/src/codex-box" <<'EOF'
#!/bin/sh
echo "codex-box $*" >>"$VT_STATE/log"
case $1 in -C|-D) exit 0 ;; esac
: >"$VT_STATE/walls"
while [ $# -gt 0 ]; do
	case $1 in
	-u) printf '%s\n' "$2" >>"$VT_STATE/walls"; shift 2 ;;
	--) shift; break ;;
	*) break ;;
	esac
done
[ ! -f "$VT_STATE/cdxb.helper.rc" ] || exit "$(cat "$VT_STATE/cdxb.helper.rc")"
exec "$@"
EOF
	printf '#!/bin/sh\nexit 0\n' >"$T/fakecodex"
	printf '#!/bin/sh\necho "make $*" >>"$VT_STATE/log"\n' >"$T/bin/make"
	chmod +x "$T/src/codex-box" "$T/fakecodex" "$T/bin/make"
	export CDXB_SRC="$T/src" CDXB_CODEX="$T/fakecodex"
	state=$XDG_CACHE_HOME/cdxb
}

# tty_in INPUT CMD...: run CMD in a pseudo-terminal and type INPUT (one
# line) two seconds in, as an answer to cdxb's review prompt. Output goes
# to $T/tty.out. See with_tty in lib.sh.
tty_in() {
	command -v script >/dev/null 2>&1 || skip "no script(1) to provide a terminal"
	_in=$1; shift
	for _a; do printf "'%s' " "$(printf '%s' "$_a" | sed "s/'/'\\\\''/g")"; done >"$T/.ttycmd"
	( "$VT_REAL_SLEEP" 2; printf '%s\n' "$_in"; "$VT_REAL_SLEEP" 3 ) |
		pty "$VT_SH $T/.ttycmd" >"$T/tty.out" 2>&1
}

# wall DESC LINE / nowall DESC LINE: the last box had (not) this wall.
wall() {
	grep -qFx -- "$2" "$VT_STATE/walls" && return 0
	fail "$1: no wall [$2] in: $(cat "$VT_STATE/walls")"
}
nowall() {
	grep -qFx -- "$2" "$VT_STATE/walls" || return 0
	fail "$1: unwanted wall [$2]"
}

# Pi is the general assistant, outside this deprecated box. Never expose its
# agent state or let Codex plant code for Pi's next start. Fixtures only:
# the helper logs policy; these cases do not assert kernel enforcement.
cdxb_pi_setup() {
	cdxb_setup
	mkdir -p "$HOME/.pi/agent/extensions" "$HOME/.pi/agent/sessions" \
		"$HOME/.local/share/vertrice-pi/node_modules"
	for f in auth.json settings.json AGENTS.md; do : >"$HOME/.pi/agent/$f"; done
	: >"$HOME/.pi/agent/sessions/fixture.jsonl"
	ln -s .pi "$HOME/pi-link"
	cd "$HOME/src/proj" || fail "no project"
}

t_cdxb_pi_home_walls() {
	cdxb_pi_setup
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	wall "Pi state hidden" ":$HOME/.pi"
	nowall "Pi not writable" "rwxc:$HOME/.pi"
	wall "Pi application read/run" "rx:$HOME/.local/share/vertrice-pi"
	wall "runtime ancestor read-only" "r:$HOME/.local"
	wall "unrelated projects writable" "rwxc:$HOME/src"
	wall "Codex runtime unchanged" "r:$HOME/.codex/config.toml"
}

t_cdxb_pi_write_and_cwd_refused() {
	cdxb_pi_setup
	for p in "$HOME/.pi" "$HOME/.pi/agent" "$HOME/.pi/agent/extensions" \
	    "$HOME/.pi/agent/settings.json" "$HOME/pi-link/agent" \
	    "$HOME/.local/share/vertrice-pi" "$HOME/.local/share"; do
		out=$(cdxb -w "$p" 2>&1 </dev/null) && fail "Pi write accepted: $p"
		if [ -d "$p" ]; then
			out=$(cdxb "$p" 2>&1 </dev/null) && fail "Pi cwd accepted: $p"
		fi
	done
	notlogged '^codex-box -u'
	return 0
}

t_cdxb_pi_private_read_refused() {
	cdxb_pi_setup
	for p in "$HOME/.pi" "$HOME/.pi/agent/auth.json" \
	    "$HOME/.pi/agent/sessions" "$HOME/.pi/agent/sessions/fixture.jsonl" \
	    "$HOME/pi-link/agent/auth.json"; do
		out=$(cdxb -r "$p" 2>&1 </dev/null) && fail "Pi private read accepted: $p"
		has "private path refused" 'deny list' "$out"
	done
	notlogged '^codex-box -u'
	return 0
}

t_cdxb_pi_grants_filtered() {
	cdxb_pi_setup
	printf 'rw ~/.pi\nr ~/.pi/agent/auth.json\nr ~/.pi/agent/sessions\nrw ~/pi-link\nrw ~/.local/share/vertrice-pi\n' >>"$HOME/.config/cdxb/grants"
	cdxb -r "$HOME/.local/share/vertrice-pi" </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	wall "Pi agent hidden without -H" ":$HOME/.pi"
	wall "application read/run without -H" "rx:$HOME/.local/share/vertrice-pi"
	nowall "no r then rx permission widening" "r:$HOME/.local/share/vertrice-pi"
	nowall "private grant not reopened" "r:$HOME/.pi/agent/auth.json"
	nowall "session grant not reopened" "r:$HOME/.pi/agent/sessions"
	nowall "link grant not writable" "rwxc:$HOME/.pi"
	nowall "application not writable" "rwxc:$HOME/.local/share/vertrice-pi"
	wall "ordinary project unchanged" "rwxc:$HOME/src/proj"
}

t_cdxb_pi_add_refused() {
	cdxb_pi_setup
	cat >"$T/fakecodex" <<'EOF'
#!/bin/sh
case $* in *resume*) exit 0 ;; esac
for p in "$HOME/.pi" "$HOME/pi-link/agent/extensions" "$HOME/.local/share/vertrice-pi" "$HOME/.local/share"; do
	cdxb add "$p" 2>>"$VT_STATE/add.err" && echo "added Pi write" >>"$VT_STATE/log"
done
cdxb add -r "$HOME/.pi/agent/auth.json" 2>>"$VT_STATE/add.err" && echo "added Pi read" >>"$VT_STATE/log"
exit 0
EOF
	cdxb </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	notlogged '^added Pi'
	grep -q 'deny list' "$VT_STATE/add.err" || fail "missing private refusal"
	grep -q 'protected' "$VT_STATE/add.err" || fail "missing runtime refusal"
	eq "no restart after refused adds" 1 "$(nlogged '^codex-box -u')"
}

t_cdxb_pi_symlink_and_missing_state() {
	cdxb_pi_setup
	mv "$HOME/.pi" "$HOME/private-pi"
	ln -s private-pi "$HOME/.pi"
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	wall "resolved state hidden" ":$HOME/private-pi"
	nowall "resolved state not writable" "rwxc:$HOME/private-pi"
	out=$(cdxb -w "$HOME/private-pi" 2>&1 </dev/null) && fail "resolved write accepted"
	rm "$HOME/.pi"
	# No ~/.pi yet: home must not become writable so it can be planted later.
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "missing state failed"
	wall "missing Pi name hidden" ":$HOME/.pi"
	nowall "home not replaceable" "rwxc:$HOME"
	return 0
}

t_cdxb_pi_alternate_agent_dir() {
	cdxb_pi_setup
	mkdir -p "$HOME/alternate/state/agent/sessions" "$HOME/alternate/project"
	: >"$HOME/alternate/state/agent/auth.json"
	export PI_CODING_AGENT_DIR="$HOME/alternate/state/agent"
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "alternate failed"
	wall "alternate state hidden" ":$PI_CODING_AGENT_DIR"
	wall "alternate ancestor read-only" "r:$HOME/alternate"
	for p in "$HOME/alternate" "$HOME/alternate/state" "$PI_CODING_AGENT_DIR"; do
		out=$(cdxb -w "$p" 2>&1 </dev/null) && fail "alternate writable: $p"
	done
	out=$(cdxb -r "$PI_CODING_AGENT_DIR/auth.json" 2>&1 </dev/null) && fail "alternate auth readable"
	cdxb "$HOME/alternate/project" </dev/null >/dev/null 2>&1 || fail "unrelated sibling refused"
	wall "sibling project writable" "rwxc:$HOME/alternate/project"
	return 0
}

t_cdxb_pi_alternate_locations() {
	cdxb_pi_setup
	mkdir -p "$HOME/alternate/agent" "$HOME/session-store" "$HOME/app-parent/pi"
	: >"$HOME/alternate/agent/auth.json"
	: >"$HOME/session-store/fixture.jsonl"
	ln -s app-parent/pi "$HOME/app-link"
	export PI_CODING_AGENT_DIR=\~/alternate/agent \
		PI_CODING_AGENT_SESSION_DIR='../../session-store' PI_PACKAGE_DIR="$HOME/app-link"
	# Resolve relative overrides against the launcher's cwd, not the project arg.
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "alternate locations failed"
	wall "tilde agent dir hidden" ":$HOME/alternate/agent"
	wall "relative sessions hidden" ":$HOME/session-store"
	wall "direct child state ancestor read-only" "r:$HOME/alternate"
	nowall "direct child ancestor not writable" "rwxc:$HOME/alternate"
	wall "symlink package resolved read/run" "rx:$HOME/app-parent/pi"
	wall "package ancestor read-only" "r:$HOME/app-parent"
	for p in "$HOME/app-parent" "$HOME/app-parent/pi" "$HOME/app-link"; do
		out=$(cdxb -w "$p" 2>&1 </dev/null) && fail "alternate application writable: $p"
	done
	out=$(cdxb -r "$HOME/session-store/fixture.jsonl" 2>&1 </dev/null) && fail "alternate session readable"
	return 0
}

t_cdxb_pi_denied_runtime_stays_hidden() {
	cdxb_pi_setup
	printf '%s\n' \~/.local/share/vertrice-pi >>"$HOME/.config/cdxb/deny"
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	wall "owner deny hides Pi runtime" ":$HOME/.local/share/vertrice-pi"
	nowall "read/run does not reopen deny" "rx:$HOME/.local/share/vertrice-pi"
	# The Pi state deny is mandatory even with an older/empty owner list.
	: >"$HOME/.config/cdxb/deny"
	out=$(cdxb -r "$HOME/.pi/agent/auth.json" 2>&1 </dev/null) && fail "empty deny exposed Pi"
	return 0
}

t_cdxb_pi_missing_alternate_parent_refused() {
	cdxb_pi_setup
	export PI_CODING_AGENT_DIR="$HOME/not-created/agent"
	out=$(cdxb 2>&1 </dev/null) && fail "unresolvable alternate accepted"
	has "explain missing ancestor" 'Pi directory parent does not exist' "$out"
	notlogged '^codex-box -u'
	return 0
}

t_cdxb_pi_trailing_blank_locations() {
	cdxb_pi_setup
	mkdir -p "$HOME/pi-state " "$HOME/pi-app "
	: >"$HOME/pi-state /auth.json"
	export PI_CODING_AGENT_DIR="$HOME/pi-state " PI_PACKAGE_DIR="$HOME/pi-app "
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "blank paths failed"
	wall "private path retains blank" ":$HOME/pi-state "
	wall "runtime path retains blank" "rx:$HOME/pi-app "
	nowall "no writable private path" "rwxc:$HOME/pi-state "
	out=$(cdxb -r "$HOME/pi-state /auth.json" 2>&1 </dev/null) && fail "blank path auth exposed"
	out=$(cdxb -w "$HOME/pi-app " 2>&1 </dev/null) && fail "blank path runtime writable"
	return 0
}

t_cdxb_pi_linked_agent_and_application() {
	cdxb_pi_setup
	mv "$HOME/.pi/agent" "$HOME/agent-state"
	ln -s ../agent-state "$HOME/.pi/agent"
	mv "$HOME/.local/share/vertrice-pi" "$HOME/pi-application"
	ln -s ../../pi-application "$HOME/.local/share/vertrice-pi"
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "linked locations failed"
	wall "linked agent hidden" ":$HOME/agent-state"
	wall "linked application read/run" "rx:$HOME/pi-application"
	nowall "linked application not writable" "rwxc:$HOME/pi-application"
	out=$(cdxb -r "$HOME/agent-state/auth.json" 2>&1 </dev/null) && fail "linked auth exposed"
	out=$(cdxb -w "$HOME/pi-application" 2>&1 </dev/null) && fail "linked application writable"
	return 0
}

t_cdxb_pi_dangling_links_refused() {
	cdxb_setup
	cd "$HOME/src/proj" || fail "no project"
	ln -s missing-agent "$HOME/.pi"
	out=$(cdxb 2>&1 </dev/null) && fail "dangling Pi root accepted"
	has "fail closed" 'Pi path is a dangling symlink' "$out"
	rm "$HOME/.pi"
	mkdir "$HOME/.pi"
	ln -s ../missing-agent "$HOME/.pi/agent"
	out=$(cdxb 2>&1 </dev/null) && fail "dangling agent accepted"
	rm "$HOME/.pi/agent"
	ln -s ../../missing-app "$HOME/.local/share/vertrice-pi"
	out=$(cdxb 2>&1 </dev/null) && fail "dangling application accepted"
	notlogged '^codex-box -u'
	return 0
}

t_cdxb_pi_target_lexical_paths() {
	cdxb_pi_setup
	mkdir -p "$HOME/alias-parent" "$HOME/elsewhere/child" "$HOME/elsewhere/agent" \
		"$HOME/alias-parent/agent" "$HOME/alias-parent/sessions" "$HOME/alias-parent/application"
	ln -s ../elsewhere/child "$HOME/alias-parent/link"
	export PI_CODING_AGENT_DIR="$HOME/alias-parent/link/../agent" \
		PI_CODING_AGENT_SESSION_DIR="$HOME/alias-parent/link/../sessions" \
		PI_PACKAGE_DIR="$HOME/alias-parent/link/../application"
	cdxb -H "$HOME" </dev/null >/dev/null 2>&1 || fail "lexical paths failed"
	wall "Node-normalized agent hidden" ":$HOME/alias-parent/agent"
	wall "Node-normalized sessions hidden" ":$HOME/alias-parent/sessions"
	wall "Node-normalized package protected" "rx:$HOME/alias-parent/application"
	wall "raw directory scan also hidden" ":$HOME/elsewhere/agent"
	out=$(cdxb -w "$HOME/alias-parent/agent" 2>&1 </dev/null) && fail "real agent writable"
	out=$(cdxb -r "$HOME/alias-parent/sessions" 2>&1 </dev/null) && fail "real sessions readable"
	# Tilde expansion in normalizePath uses Node join(), with the same lexical rule.
	PI_CODING_AGENT_DIR=\~/alias-parent/link/../agent
	cdxb </dev/null >/dev/null 2>&1 || fail "tilde lexical paths failed"
	wall "tilde lexical agent hidden" ":$HOME/alias-parent/agent"
	unset PI_CODING_AGENT_SESSION_DIR PI_PACKAGE_DIR
	PI_CODING_AGENT_DIR=../agent
	cd "$HOME/alias-parent/link" || fail "symlink cwd unavailable"
	cdxb </dev/null >/dev/null 2>&1 || fail "relative physical cwd failed"
	wall "relative base is physical launch cwd" ":$HOME/elsewhere/agent"
	return 0
}

t_cdxb_pi_target_file_urls_refused() {
	cdxb_pi_setup
	mkdir -p "$HOME/url-state"
	# A misleading relative spelling must not hide the fact Pi uses a file URL.
	mkdir -p "file://$HOME/url-state"
	for name in PI_CODING_AGENT_DIR PI_CODING_AGENT_SESSION_DIR PI_PACKAGE_DIR; do
		out=$(env "$name=file://$HOME/url-state" cdxb -w "$HOME/url-state" "$HOME/Documents" 2>&1 </dev/null) &&
			fail "URL override accepted: $name"
		has "clear fail-closed URL limit" 'Pi file URL overrides are not supported' "$out"
	done
	notlogged '^codex-box -u'
	return 0
}

t_cdxb_child_status_survives_review_cleanup() {
	cdxb_setup
	cat >"$T/fakecodex" <<'EOF'
#!/bin/sh
echo 'child ran' >>"$VT_STATE/log"
printf 'r ~/Documents\n' >"$CDXB_OUTBOX/grants"
exit "$(cat "$VT_STATE/cdxb.child.rc")"
EOF
	cd "$HOME/src/proj" || fail "no project"
	for want in 0 7 42; do
		rm -f "$state/proposals/grants"
		printf '%s\n' "$want" >"$VT_STATE/cdxb.child.rc"
		out=$(cdxb 2>&1 </dev/null); got=$?
		eq "child status after review and exit trap" "$want" "$got"
		has "post-session review still runs" 'a proposal waits: run cdxb review in a terminal' "$out"
		[ -f "$state/proposals/grants" ] || fail "proposal lost"
		[ -z "$(ls -d "$state"/[0-9]* 2>/dev/null)" ] || fail "exit trap left session directory"
	done
	eq "all children ran" 3 "$(nlogged '^child ran$')"
}

t_cdxb_helper_status_survives_cleanup() {
	cdxb_setup
	printf '#!/bin/sh\necho "unexpected child" >>"$VT_STATE/log"\n' >"$T/fakecodex"
	cd "$HOME/src/proj" || fail "no project"
	for want in 0 73 126; do
		printf '%s\n' "$want" >"$VT_STATE/cdxb.helper.rc"
		out=$(cdxb 2>&1 </dev/null); got=$?
		eq "helper status after review and exit trap" "$want" "$got"
		[ -z "$(ls -d "$state"/[0-9]* 2>/dev/null)" ] || fail "exit trap left session directory"
	done
	eq "all helpers ran" 3 "$(nlogged '^codex-box -u')"
	notlogged '^unexpected child$'
}

t_cdxb_denied_automatic_ancestors() {
	cdxb_setup
	mkdir -p "$HOME/.config/git" "$HOME/.config/private" "$HOME/.codex"
	printf 'fixture-token\n' >"$HOME/.config/cdxb/github-token"
	echo '~/.config' >>"$HOME/.config/cdxb/deny"
	cd "$HOME/src/proj" || fail "no project"
	for flags in '' -H; do
		out=$(cdxb $flags "$HOME/src/proj" 2>&1 </dev/null) || fail "cdxb failed: $out"
		wall "denied ancestor hidden" ":$HOME/.config"
		if grep -E '^[a-z]+:' "$VT_STATE/walls" | grep -F ":$HOME/.config"; then
			fail "automatic config grant reopened denied ancestor"
		fi
		wall "unrelated runtime works" "r:$HOME/.codex/config.toml"
		has "token helper disabled" 'github-token is on the deny list' "$out"
	done
}

t_cdxb_denied_runtime_refused() {
	cdxb_setup
	cd "$HOME/src/proj" || fail "no project"
	cp "$HOME/.config/cdxb/deny" "$T/deny.original"
	for p in "$XDG_CACHE_HOME" "$HOME/.codex" "$CDXB_SRC" /usr /etc /dev; do
		cp "$T/deny.original" "$HOME/.config/cdxb/deny"
		printf '%s\n' "$p" >>"$HOME/.config/cdxb/deny"
		out=$(cdxb -d 2>&1 </dev/null) && fail "denied runtime accepted: $p"
		has "clear conflict" 'required runtime path' "$out"
		has "deny explanation" 'beneath a deny entry' "$out"
	done
	notlogged '^codex-box'
	[ ! -e "$HOME/.codex/config.toml" ] || fail "settings seeded despite denial"
}

t_cdxb_denied_automatic_symlink() {
	cdxb_setup
	mkdir -p "$HOME/private" "$HOME/.codex"
	ln -s "$HOME/private" "$HOME/.config/git"
	echo '~/private' >>"$HOME/.config/cdxb/deny"
	cd "$HOME/src/proj" || fail "no project"
	cdxb </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	nowall "resolved denied automatic grant skipped" "r:$HOME/private"
	nowall "link spelling not granted either" "r:$HOME/.config/git"
}

t_cdxb_denied_missing_child_beneath_symlink() {
	cdxb_setup
	mv "$HOME/.config" "$HOME/private"
	ln -s private "$HOME/.config"
	echo '~/private' >>"$HOME/.config/cdxb/deny"
	cd "$HOME/src/proj" || fail "no project"
	cdxb </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	# ksh and x11 do not exist: unveil can still grant their names through
	# the existing symlinked parent. Neither spelling may reopen the deny.
	for p in "$HOME/.config/ksh" "$HOME/.config/x11" "$HOME/private/ksh" "$HOME/private/x11"; do
		nowall "missing child under denied parent" "r:$p"
	done
}

t_cdxb_control_chars_refused() {
	cdxb_setup
	nl='
'
	bad="$HOME/x${nl}rwxc:"
	mkdir -p "$bad/" || fail "cannot make the test directory"
	out=$(cdxb "$bad" 2>&1) && fail "a newline in the dir was accepted: $out"
	has "says why" "control character" "$out"
	out=$(cdxb -w "$bad" "$HOME/src/proj" 2>&1) && fail "-w with a newline was accepted"
	has "-w: says why" "control character" "$out"
	out=$(cdxb -r "$HOME/src$(printf '\033')x" "$HOME/src/proj" 2>&1) &&
		fail "-r with an escape was accepted"
	# add: refused before any session is looked up.
	out=$(cdxb add "$bad" 123 2>&1) && fail "add with a newline was accepted"
	has "add: says why" "control character" "$out"
	notlogged '^codex-box'
	# A grants line with an escape is skipped; the session still starts.
	mkdir -p "$HOME/Documents$(printf '\033')x"
	printf 'rw ~/Documents\033x\n' >>"$HOME/.config/cdxb/grants"
	cd "$HOME/src/proj" || fail "no project"
	out=$(cdxb 2>&1 </dev/null) || fail "cdxb failed: $out"
	has "grants: says why" "control character" "$out"
	grep -q "$(printf '\033')" "$VT_STATE/walls" && fail "an escape reached the walls"
	eq "one box started" 1 "$(nlogged '^codex-box -u')"
	return 0
}

t_cdxb_walls() {
	cdxb_setup
	mkdir -p "$HOME/.codex" "$HOME/.config/git" "$HOME/.local/share/vertrice.git" \
		"$HOME/.cache" "$HOME/.ssh"
	cd "$HOME/src/proj" || fail "no project"
	out=$(cdxb 2>&1 </dev/null) || fail "cdxb failed: $out"
	wall "start dir" "rwxc:$HOME/src/proj"
	nowall "git is Codex's job: its .git may change" "r:$HOME/src/proj/.git/hooks"
	wall "credentials hidden" ":$HOME/.config/git/credentials"
	wall "deny list hides" ":$HOME/.ssh"
	wall "a grant" "rwxc:$HOME/Documents"
	wall "config.toml read-only" "r:$HOME/.codex/config.toml"
	wall "AGENTS.override.md read-only" "r:$HOME/.codex/AGENTS.override.md"
	wall "rules read-only" "r:$HOME/.codex/rules"
	wall "hooks.json read-only" "r:$HOME/.codex/hooks.json"
	wall "grants read-only" "r:$HOME/.config/cdxb"
	wall "cdxb's state hidden" ":$state"
	# -H: the top of home cannot be changed; ~/.cache, ~/.config and
	# ~/.local are read-only; the folders beside them may be changed.
	out=$(cdxb -H "$HOME" 2>&1 </dev/null) || fail "cdxb -H failed: $out"
	wall "home is read and run" "rx:$HOME"
	nowall "home is not rwxc" "rwxc:$HOME"
	wall "~/.config read-only" "r:$HOME/.config"
	wall "~/.local read-only" "r:$HOME/.local"
	wall "the dotfiles repo read-only" "r:$HOME/.local/share/vertrice.git"
	wall "Documents may change" "rwxc:$HOME/Documents"
	wall "~/.cache read-only: cron and mpv run what is in it" "r:$HOME/.cache"
	nowall "~/.cache not rwxc" "rwxc:$HOME/.cache"
	wall "cdxb's own state still hidden" ":$state"
	wall "-H: the deny list still hides" ":$HOME/.ssh"
	# A write grant that holds a protected path, or a denied one, is refused.
	out=$(cdxb -w "$HOME/.local" 2>&1) && fail "-w ~/.local was accepted: $out"
	has "says why" "holds protected files" "$out"
	out=$(cdxb -w "$HOME/.codex/config.toml" 2>&1) && fail "-w config.toml was accepted"
	has "says why" "is protected" "$out"
	out=$(cdxb -r "$HOME/.ssh" 2>&1) && fail "-r ~/.ssh was accepted"
	has "says why" "deny list" "$out"
	out=$(cdxb "$HOME" 2>&1) && fail "home without -H was accepted"
	out=$(cdxb -H "${HOME%/*}" 2>&1) && fail "a dir holding home was accepted"
	# Grants that are denied or hold protected paths are skipped.
	printf 'rw ~/.ssh\nrw ~/.local\n' >>"$HOME/.config/cdxb/grants"
	out=$(cdxb 2>&1 </dev/null) || fail "cdxb failed: $out"
	nowall "denied grant skipped" "rwxc:$HOME/.ssh"
	nowall "protected grant skipped" "rwxc:$HOME/.local"
	return 0
}

# / holds every protected path: a write grant of it is refused, whether
# from -w, the grants file or add.
t_cdxb_root_refused() {
	cdxb_setup
	cd "$HOME/src/proj" || fail "no project"
	out=$(cdxb -w / 2>&1 </dev/null) && fail "-w / was accepted"
	has "says why" "holds protected files" "$out"
	notlogged '^codex-box -u'
	echo 'rw /' >>"$HOME/.config/cdxb/grants"
	out=$(cdxb 2>&1 </dev/null) || fail "cdxb failed: $out"
	nowall "a grants line rw / is skipped" "rwxc:/"
	cat >"$T/fakecodex" <<'EOF'
#!/bin/sh
cdxb add / 2>>"$VT_STATE/add.err" && echo "added root" >>"$VT_STATE/log"
exit 0
EOF
	cdxb </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	notlogged '^added root'
	grep -q 'holds protected files' "$VT_STATE/add.err" || fail "add: $(cat "$VT_STATE/add.err")"
	return 0
}

# A path ending in a blank is walled as checked, blank and all.
t_cdxb_trailing_blank() {
	cdxb_setup
	mkdir -p "$HOME/work " "$HOME/work"
	cd "$HOME/src/proj" || fail "no project"
	out=$(cdxb -w "$HOME/work " 2>&1 </dev/null) || fail "cdxb failed: $out"
	wall "the path as given" "rwxc:$HOME/work "
	nowall "not the path without the blank" "rwxc:$HOME/work"
	return 0
}

# ~/.config, ~/.cache and the dotfiles repository run outside the box:
# never writable, with or without -H. Without -H they are not walled
# read-only either, so the box sees only what is granted in them.
t_cdxb_dotfiles_protected() {
	cdxb_setup
	mkdir -p "$HOME/.config/nvim" "$HOME/.cache/foo" "$HOME/.local/share/vertrice.git"
	cd "$HOME/src/proj" || fail "no project"
	for p in "$HOME/.config/nvim" "$HOME/.cache" "$HOME/.local/share/vertrice.git"; do
		out=$(cdxb -w "$p" 2>&1 </dev/null) && fail "-w $p was accepted"
		has "-w $p: says why" "is protected" "$out"
	done
	out=$(cdxb "$HOME/.cache/foo" 2>&1 </dev/null) && fail "a dir in ~/.cache was accepted"
	notlogged '^codex-box -u'
	printf 'rw ~/.config/nvim\n' >>"$HOME/.config/cdxb/grants"
	out=$(cdxb -r "$HOME/.config/nvim" 2>&1 </dev/null) || fail "-r ~/.config/nvim refused: $out"
	wall "read grant kept" "r:$HOME/.config/nvim"
	nowall "rw grant skipped" "rwxc:$HOME/.config/nvim"
	nowall "~/.config not widened without -H" "r:$HOME/.config"
	nowall "~/.cache not widened without -H" "r:$HOME/.cache"
	return 0
}

# /etc is read-only in the box, but /etc/hostname.* hold wireless keys
# (dmenuwifi writes them; mode 640, group wheel, which the user is in).
# Here /etc/hostname.* is $T/etc/hostname.* (see derived in lib.sh).
t_cdxb_hostname_hidden() {
	cdxb_setup
	mkdir -p "$T/etc"
	echo 'join home wpakey secret' >"$T/etc/hostname.iwn0"
	: >"$T/etc/hostname.em0"
	cb=$(derived .local/bin/cdxb cdxb "s|/etc/hostname\\.|$T/etc/hostname.|g")
	cd "$HOME/src/proj" || fail "no project"
	out=$("$VT_KSH" "$cb" 2>&1 </dev/null) || fail "cdxb failed: $out"
	wall "wireless keys hidden" ":$T/etc/hostname.iwn0"
	wall "every hostname file hidden" ":$T/etc/hostname.em0"
	rm "$T/etc/hostname.iwn0" "$T/etc/hostname.em0"
	out=$("$VT_KSH" "$cb" 2>&1 </dev/null) || fail "cdxb failed: $out"
	hasnt "no wall for an unmatched pattern" "hostname.*" "$(cat "$VT_STATE/walls")"
	return 0
}

# What the box inherits: its own TMPDIR, no display, the outbox; cdxb
# keeps its own TMPDIR. -a marks the project untrusted.
t_cdxb_box_env() {
	cdxb_setup
	printf '#!/bin/sh\necho "codex $* TMPDIR=$TMPDIR DISPLAY=$DISPLAY OUTBOX=$CDXB_OUTBOX" >>"$VT_STATE/log"\n' >"$T/fakecodex"
	cd "$HOME/src/proj" || fail "no project"
	DISPLAY=:0 cdxb -a . -m x </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	logged "^codex -c projects=\\{\"$HOME/src/proj\"=\\{trust_level=\"untrusted\"\\}\\} -m x TMPDIR=$state/[0-9]+/tmp DISPLAY= OUTBOX=$state/proposals\$"
	[ -e "$HOME/.codex/config.toml" ] || fail "config.toml not seeded"
	hasnt "TMPDIR is not cdxb's" "TMPDIR" "$(env | grep TMPDIR)"
	[ -z "$(ls -d "$state"/[0-9]* 2>/dev/null)" ] || fail "session directory left"
	return 0
}

# add: a running session gets the path, starts again and resumes; a
# denied path is refused.
t_cdxb_add_restarts() {
	cdxb_setup
	cat >"$T/fakecodex" <<'EOF'
#!/bin/sh
echo "codex $*" >>"$VT_STATE/log"
case $* in *resume*) exit 0 ;; esac
cdxb add "$HOME/.ssh" 2>>"$VT_STATE/add.err" && echo "added ssh" >>"$VT_STATE/log"
cdxb add -r "$HOME/notes"
EOF
	mkdir -p "$HOME/notes" "$HOME/.ssh"
	cd "$HOME/src/proj" || fail "no project"
	cdxb . -m x </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	notlogged '^added ssh'
	grep -q 'deny list' "$VT_STATE/add.err" || fail "no reason: $(cat "$VT_STATE/add.err")"
	# The restart keeps your own Codex arguments.
	logged '^codex -c [^ ]* resume --last -m x$'
	wall "the added path, read-only" "r:$HOME/notes"
	return 0
}

t_cdxb_doas_touches_no_state() {
	cdxb_setup
	export XDG_CACHE_HOME="$T/nocache" CDXB_DOAS="$T/doas.sock"
	cdxb doas /usr/sbin/rcctl restart sndiod || fail "cdxb doas failed"
	logged "^codex-box -C $T/doas.sock -- /usr/sbin/rcctl restart sndiod\$"
	[ -e "$T/nocache" ] && fail "cdxb doas made its state directory"
	unset CDXB_DOAS
	cdxb doas true 2>/dev/null && fail "ran without a relay"
	return 0
}

# The real client and relay, built from codex-box.c with a fake doas.
t_cdxb_doas_client_relay() {
	command -v cc >/dev/null 2>&1 || skip "no cc"
	printf '#!/bin/sh\necho "doas $*"\necho oops >&2\nexit 3\n' >"$T/fakedoas"
	chmod +x "$T/fakedoas"
	# The Mac has neither accept4 nor SOCK_CLOEXEC; OpenBSD and Linux do.
	mac=
	[ "$VT_HOST" = Darwin ] && mac="-DSOCK_CLOEXEC=0 -Daccept4(a,b,c,d)=accept(a,b,c)"
	sandbox=
	[ "$VT_HOST" = OpenBSD ] || sandbox="-Dpledge(a,b)=0 -Dunveil(a,b)=0"
	# shellcheck disable=SC2086
	cc -Wall -Wextra -Werror -D_GNU_SOURCE $sandbox $mac \
		-DDOAS="\"$T/fakedoas\"" -o "$T/cb" \
		"$REPO/.local/src/codex-box/codex-box.c" 2>"$T/cc.out" ||
		fail "codex-box.c does not build: $(cat "$T/cc.out")"
	"$T/cb" -D "$T/s" & track $!
	waitfor 5 test -S "$T/s" || fail "the relay did not start"
	out=$("$T/cb" -C "$T/s" -- /usr/sbin/rcctl -f restart sndiod 2>&1); rc=$?
	eq "exit status passed on" 3 "$rc"
	eq "output, without the status line" "doas -n -- /usr/sbin/rcctl -f restart sndiod
oops" "$out"
	out=$("$T/cb" -C "$T/s" -- "two words" 2>&1) && fail "a word with a blank was sent"
	has "says why" "blank" "$out"
	# shellcheck disable=SC2046
	out=$("$T/cb" -C "$T/s" -- $(seq 40) 2>&1) && fail "40 words were run"
	has "too many words" "more than 32 words" "$out"
	return 0
}

# A proposal changed after it is shown must not be what is applied: the
# fake Codex keeps the proposal open and, while the prompt waits,
# rewrites it through that descriptor, every file in its TMPDIR, and the
# outbox. With answer y, exactly the shown grants must land.
t_cdxb_review_applies_what_was_shown() {
	cdxb_setup
	cat >"$T/fakecodex" <<'EOF'
#!/bin/sh
o=$CDXB_OUTBOX
printf 'rw ~/src\nrw ~/notes\n' >"$o/grants"
exec 3>>"$o/grants"
(
	"$VT_REAL_SLEEP" 1
	printf 'rw /\n' >&3
	for f in "$TMPDIR"/* "$TMPDIR"/*/* "$o"/*; do
		[ -f "$f" ] && printf 'rw /\n' >"$f"
	done
	printf 'rw /\n' >"$o/grants"
) </dev/null >/dev/null 2>&1 &
exit 0
EOF
	cd "$HOME/src/proj" || fail "no project"
	tty_in y cdxb
	grep -q '^ rw ~/notes' "$T/tty.out" || fail "the diff was not shown: $(cat "$T/tty.out")"
	eq "applied exactly what was shown" "rw ~/src
rw ~/notes" "$(grep -v '^#' "$HOME/.config/cdxb/grants" | grep .)"
	[ -z "$(ls -d "$state"/review.* 2>/dev/null)" ] || fail "private directory left"
	return 0
}

t_cdxb_review_rejects_escapes() {
	cdxb_setup
	mkdir -p "$state/proposals" "$HOME/.codex"
	cp "$HOME/.local/share/openbsd/codex/AGENTS.md" "$HOME/.codex/"
	before=$(cksum <"$HOME/.codex/AGENTS.md")
	printf 'fine\n\033[2Ahidden\n' >"$state/proposals/agents"
	printf 'bidi \342\200\256 override\n' >"$state/proposals/grants"
	tty_in y cdxb review
	eq "AGENTS.md unchanged" "$before" "$(cksum <"$HOME/.codex/AGENTS.md")"
	grep -q 'agents refused: not printable ASCII' "$T/tty.out" || fail "agents: $(cat "$T/tty.out")"
	grep -q 'grants refused: not printable ASCII' "$T/tty.out" || fail "bidi override accepted"
	[ -e "$state/proposals/agents" ] && fail "the proposal was left in the outbox"
	return 0
}

# A link is moved, never followed: a link to a secret is refused unread,
# and a FIFO does not make cdxb wait.
t_cdxb_review_rejects_links() {
	cdxb_setup
	mkdir -p "$state/proposals"
	printf 'SECRET\n' >"$T/secret"
	ln -s "$T/secret" "$state/proposals/deny"
	mkfifo "$state/proposals/codex" || skip "no mkfifo"
	before=$(cksum <"$HOME/.config/cdxb/deny")
	tty_in y cdxb review
	hasnt "the secret was not shown" "SECRET" "$(cat "$T/tty.out")"
	grep -q 'deny refused: not a plain file' "$T/tty.out" || fail "link: $(cat "$T/tty.out")"
	grep -q 'codex refused: not a plain file' "$T/tty.out" || fail "fifo: $(cat "$T/tty.out")"
	eq "deny unchanged" "$before" "$(cksum <"$HOME/.config/cdxb/deny")"
	return 0
}

# doas-agent.conf is written only once /etc/doas.conf holds it.
t_cdxb_review_doas() {
	cdxb_setup
	mkdir -p "$state/proposals"
	rules='permit nopass :wheel as root cmd /usr/sbin/zzz args'
	printf '%s\n' "$rules" >"$state/proposals/doas"
	echo 1 >"$VT_STATE/rc.doas"
	tty_in y cdxb review
	hasnt "not written when doas failed" "$rules" "$(cat "$HOME/.local/share/openbsd/doas-agent.conf")"
	rm "$VT_STATE/rc.doas"
	printf '%s\n' "$rules" >"$state/proposals/doas"
	tty_in y cdxb review
	logged '^doas -C .*/doas\.conf$'
	logged '^doas install -o root -g wheel -m 0640 .* /etc/doas\.conf$'
	eq "written once installed" "$rules" "$(cat "$HOME/.local/share/openbsd/doas-agent.conf")"
	return 0
}

# The GitHub token: git's credential helper is set in the box only when
# ~/.config/cdxb/github-token exists and is not denied; the file is inside
# a read-only wall and never hidden.
t_cdxb_github_token() {
	cdxb_setup
	unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
	tok=$HOME/.config/cdxb/github-token
	cat >"$T/fakecodex" <<'EOF'
#!/bin/sh
echo "codex count=$GIT_CONFIG_COUNT key=$GIT_CONFIG_KEY_0" >>"$VT_STATE/log"
command -v git >/dev/null 2>&1 &&
	printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null |
	sed -n 's/^password=/git password=/p' >>"$VT_STATE/log"
exit 0
EOF
	cd "$HOME/src/proj" || fail "no project"
	cdxb </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	logged '^codex count= key=$'
	notlogged '^git password='
	printf 'github_pat_example\n' >"$tok"; chmod 600 "$tok"
	: >"$VT_STATE/log"
	cdxb </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	logged '^codex count=1 key=credential\.https://github\.com\.helper$'
	if command -v git >/dev/null 2>&1; then logged '^git password=github_pat_example$'; fi
	wall "the token's folder is read-only" "r:$HOME/.config/cdxb"
	nowall "not writable" "rwxc:$HOME/.config/cdxb"
	nowall "not writable" "rwxc:$tok"
	nowall "not hidden" ":$tok"
	# On the deny list: hidden, and git is not pointed at it.
	echo '~/.config/cdxb/github-token' >>"$HOME/.config/cdxb/deny"
	: >"$VT_STATE/log"
	out=$(cdxb 2>&1 </dev/null) || fail "cdxb failed: $out"
	has "says why" "github-token is on the deny list" "$out"
	logged '^codex count= key=$'
	wall "denied: hidden" ":$tok"
	# The dotfiles never take the token: git add of the folder skips it.
	command -v git >/dev/null 2>&1 || return 0
	mkdir "$T/repo" && cd "$T/repo" && git init -q . || fail "no git repository"
	mkdir -p .config/cdxb
	cp "$REPO/.config/cdxb/.gitignore" "$REPO/.config/cdxb/deny" .config/cdxb/
	: >.config/cdxb/github-token
	git add .config/cdxb || fail "git add failed"
	hasnt "token not added" "github-token" "$(git ls-files)"
	return 0
}
