# cdxb, the Codex box. Off OpenBSD there is no unveil or pledge, so these
# cases test cdxb's own logic, not the kernel's walls: $T/src/codex-box is
# a mock that logs its arguments, writes each -u wall to $VT_STATE/walls
# and runs the program after "--"; Codex is a script ($T/fakecodex).

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
: >"$VT_STATE/walls"
while [ $# -gt 0 ]; do
	case $1 in
	-u) printf '%s\n' "$2" >>"$VT_STATE/walls"; shift 2 ;;
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

# wall DESC LINE / nowall DESC LINE: the last box had (not) this wall.
wall() {
	grep -qFx -- "$2" "$VT_STATE/walls" && return 0
	fail "$1: no wall [$2] in: $(cat "$VT_STATE/walls")"
}
nowall() {
	grep -qFx -- "$2" "$VT_STATE/walls" || return 0
	fail "$1: unwanted wall [$2]"
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
	wall "git config read-only" "r:$HOME/src/proj/.git/config"
	wall "git hooks read-only" "r:$HOME/src/proj/.git/hooks"
	wall "git commondir cannot be made" "r:$HOME/src/proj/.git/commondir"
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
	cdxb </dev/null >/dev/null 2>&1 || fail "cdxb failed"
	notlogged '^added ssh'
	grep -q 'deny list' "$VT_STATE/add.err" || fail "no reason: $(cat "$VT_STATE/add.err")"
	logged '^codex .* resume --last$'
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
	cc -Wall -Wextra -Werror -D_GNU_SOURCE -D'pledge(a,b)=0' -D'unveil(a,b)=0' \
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
