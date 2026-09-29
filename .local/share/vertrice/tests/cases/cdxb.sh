# cdxb, the Codex box. Off OpenBSD there is no unveil or pledge, so these
# cases test cdxb's own logic, not the kernel's walls: $T/src/codex-box is
# a mock that logs its arguments and runs the program after "--", and
# Codex is a script ($T/fakecodex). The walls themselves are checked as
# the lines cdxb would hand to codex-box (-n prints them).

# cdxb_setup: a home with the dotfiles' grants and deny list, a project
# with a git directory, and the mocks.
cdxb_setup() {
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
while [ $# -gt 0 ]; do
	case $1 in
	-p) echo $$ >"$2"; shift 2 ;;
	-u) shift 2 ;;
	--) shift; break ;;
	*) break ;;
	esac
done
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
	if script --version 2>/dev/null | grep -q util-linux; then
		( "$VT_REAL_SLEEP" 2; printf '%s\n' "$_in"; "$VT_REAL_SLEEP" 3 ) |
			script -qec "$VT_SH $T/.ttycmd" /dev/null >"$T/tty.out" 2>&1
	else
		( "$VT_REAL_SLEEP" 2; printf '%s\n' "$_in"; "$VT_REAL_SLEEP" 3 ) |
			script -c "$VT_SH $T/.ttycmd" /dev/null >"$T/tty.out" 2>&1
	fi
}

# snap: every file and directory under the home and the cache, with its
# mode, size and contents' checksum, to compare before and after.
snap() {
	find "$HOME" "$XDG_CACHE_HOME" -exec ls -ld {} + 2>/dev/null |
		awk '{ $6 = $7 = $8 = ""; print }' | sort
	find "$HOME" "$XDG_CACHE_HOME" -type f -exec cksum {} + 2>/dev/null | sort
}

t_cdxb_dry_run_changes_nothing() {
	cdxb_setup
	# The source is newer than the program, so a real run would build;
	# a proposal waits, so a real run would review it.
	"$VT_REAL_SLEEP" 1; : >"$T/src/codex-box.c"
	mkdir -p "$state/proposals"
	printf 'rw /\n' >"$state/proposals/grants"
	before=$(snap)
	cd "$HOME/src/proj" || fail "no project"
	out=$(cdxb -n -d 2>&1) || fail "cdxb -n failed: $out"
	eq "nothing changed" "$before" "$(snap)"
	notlogged '^make'
	notlogged '^codex-box'
	has "says it would build" "would build codex-box" "$out"
	has "says it would seed" "would copy $HOME/.local/share/openbsd/codex/config.toml" "$out"
	has "names the proposal" "would review the waiting proposal: grants" "$out"
	has "says it would start the relay" "would start the doas relay" "$out"
	has "prints the start dir wall" "rwxc:$HOME/src/proj" "$out"
	has "prints the command" "command: $T/fakecodex" "$out"
	[ -e "$HOME/.codex" ] && fail "made ~/.codex"
	return 0
}

t_cdxb_control_chars_refused() {
	cdxb_setup
	nl='
'
	bad="$HOME/x${nl}rwxc:"
	mkdir -p "$bad/" || fail "cannot make the test directory"
	out=$(cdxb -n "$bad" 2>&1) && fail "a newline in the dir was accepted: $out"
	has "says why" "control character" "$out"
	hasnt "no extra unveil line" "${nl}rwxc:${nl}" "$out"
	case $out in *"rwxc:/"*) fail "an injected wall was printed: $out" ;; esac
	out=$(cdxb -n -w "$bad" "$HOME/src/proj" 2>&1) && fail "-w with a newline was accepted"
	has "-w: says why" "control character" "$out"
	out=$(cdxb -n -r "$HOME/src$(printf '\033')x" "$HOME/src/proj" 2>&1) &&
		fail "-r with an escape was accepted"
	# add: refused before any session is looked up.
	out=$(cdxb add "$bad" 123 2>&1) && fail "add with a newline was accepted"
	has "add: says why" "control character" "$out"
	return 0
}

t_cdxb_walls() {
	cdxb_setup
	mkdir -p "$HOME/.codex" "$HOME/.config/git" "$HOME/.local/share/vertrice.git" "$HOME/.cache"
	cd "$HOME/src/proj" || fail "no project"
	out=$(cdxb -n 2>&1) || fail "cdxb -n failed: $out"
	has "git config read-only" "r:$HOME/src/proj/.git/config" "$out"
	has "git hooks read-only" "r:$HOME/src/proj/.git/hooks" "$out"
	has "git commondir cannot be made" "r:$HOME/src/proj/.git/commondir" "$out"
	has "credentials hidden" ":$HOME/.config/git/credentials" "$out"
	has "AGENTS.override.md read-only" "r:$HOME/.codex/AGENTS.override.md" "$out"
	has "rules read-only" "r:$HOME/.codex/rules" "$out"
	has "hooks.json read-only" "r:$HOME/.codex/hooks.json" "$out"
	hasnt "TMPDIR is not cdxb's" "TMPDIR" "$(env | grep TMPDIR)"
	# -H: the top of home cannot be changed; ~/.config and ~/.local are
	# read-only; the folders beside them may be changed.
	out=$(cdxb -n -H "$HOME" 2>&1) || fail "cdxb -n -H failed: $out"
	has "home is read and run" "	rx:$HOME
" "$out"
	hasnt "home is not rwxc" "rwxc:$HOME
" "$out"
	has "~/.config read-only" "r:$HOME/.config
" "$out"
	has "~/.local read-only" "r:$HOME/.local
" "$out"
	has "the dotfiles repo read-only" "r:$HOME/.local/share/vertrice.git" "$out"
	has "Documents may change" "rwxc:$HOME/Documents" "$out"
	has "cache may change" "rwxc:$HOME/.cache" "$out"
	# A write grant that holds a protected path is refused.
	out=$(cdxb -n -w "$HOME/.local" 2>&1) && fail "-w ~/.local was accepted: $out"
	has "says why" "holds protected files" "$out"
	out=$(cdxb -n "$HOME" 2>&1) && fail "home without -H was accepted"
	out=$(cdxb -n -H "${HOME%/*}" 2>&1) && fail "a dir holding home was accepted"
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
	cc -Wall -Wextra -Werror -DDOAS="\"$T/fakedoas\"" -o "$T/cb" \
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
echo "add notes" >"$o/grants.why"
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
	grep -q 'agents rejected: control characters' "$state/log" || fail "no log: $(cat "$state/log")"
	grep -q 'grants rejected: control characters' "$state/log" || fail "bidi override accepted"
	[ -e "$state/proposals/agents" ] && fail "the proposal was left in the outbox"
	return 0
}
