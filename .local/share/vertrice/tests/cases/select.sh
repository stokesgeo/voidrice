# Selection: each machine takes only its own files. The lists are
# .local/share/openbsd/sparse-checkout (the X220),
# .local/share/darwin/sparse-checkout (the Mac) and
# .local/share/vertrice/repo-only (neither). git applies each one, as the
# home half of vertrice-install does, to a scratch index holding every
# tracked path (empty files), and ls-files -t says which it checks out.

# takes LIST: the tracked files LIST checks out, one a line.
takes() {
	git sparse-checkout set --no-cone --stdin <"$REPO/$1" ||
		fail "git sparse-checkout refuses $1"
	git ls-files -t | sed -n 's/^H //p' | sort
}

# sel: $T/all, every tracked file; $T/x220, $T/mac and $T/repo, what each
# list takes.
sel() {
	command -v git >/dev/null 2>&1 || skip "no git"
	git -C "$REPO" ls-files 2>/dev/null | sort >"$T/all"
	[ -s "$T/all" ] || skip "not run in a clone of the repository"
	git init -q "$T/r" 2>/dev/null && cd "$T/r" || fail "git init"
	e=$(git hash-object -w --stdin </dev/null)
	sed "s/^/100644 $e	/" "$T/all" | git update-index --index-info ||
		fail "git update-index"
	takes .local/share/openbsd/sparse-checkout >"$T/x220"
	takes .local/share/darwin/sparse-checkout >"$T/mac"
	takes .local/share/vertrice/repo-only >"$T/repo"
}

# none DESC PATTERN FILE: no line of FILE matches PATTERN (grep -E).
none() { eq "$1" "" "$(grep -E -- "$2" "$3")"; }
# takes_all DESC FILE PATH...: FILE lists every PATH.
takes_all() {
	_d=$1 _f=$2; shift 2
	for _p; do grep -qx -- "$_p" "$_f" || fail "$_d does not take $_p"; done
}

mac_only='^\.config/(aerospace|ghostty|karabiner|sketchybar)/|^\.local/(bin|share)/darwin/'
x220_only='^\.config/(cdxb|cwm|dunst|wal|zathura)/|^\.config/x11/x|^\.local/(bin/wrap|share/openbsd|src)/|^\.x(profile|session)$|^\.local/bin/(bk|cdxb|mounter|unmounter|remaps|dmenuwifi|rectoggle|vertrice-dict)$|/tests/check$'

t_select_x220() {
	sel
	none "the X220 takes none of the Mac's" "$mac_only" "$T/x220"
	eq "the X220 takes nothing repo-only" "" "$(comm -12 "$T/x220" "$T/repo")"
	takes_all "the X220" "$T/x220" .profile .config/cwm/cwmrc .config/x11/xinitrc \
		.local/bin/wrap/dmenu .local/bin/vertrice-install .local/bin/cdxb \
		.local/share/openbsd/sparse-checkout .local/share/openbsd/pkglist \
		.local/share/man/man7/vertrice.7 .local/share/vertrice/OPENBSD.md \
		.local/share/vertrice/tests/check .local/src/sd/proc-cwd.c
}

t_select_mac() {
	sel
	none "the Mac takes none of the X220's" "$x220_only" "$T/mac"
	eq "the Mac takes nothing repo-only" "" "$(comm -12 "$T/mac" "$T/repo")"
	takes_all "the Mac" "$T/mac" .profile .config/aerospace/aerospace.toml \
		.config/aerospace/run .config/sketchybar/sketchybarrc \
		.config/karabiner/karabiner.json .config/ghostty/config \
		.config/x11/themes/day .config/x11/themes/night \
		.local/bin/darwin/dmenu .local/bin/vertrice-install \
		.local/share/darwin/install .local/share/darwin/sparse-checkout \
		.local/share/man/man7/vertrice.7 .local/share/vertrice/OPENBSD.md
}

# What the Mac's keys and bar run, the Mac takes.
t_select_mac_runs() {
	sel
	a=$REPO/.config/aerospace/aerospace.toml
	for s in $(sed -n 's/.*aerospace\/run \([a-z][a-z-]*\).*/\1/p' "$a" | sort -u) \
	    $(sed -n 's/^blocks="\(.*\)"$/\1/p' "$REPO/.config/sketchybar/sketchybarrc") theme; do
		case $s in mpc|sketchybar) continue ;; esac
		grep -Eqx "\.local/bin/(statusbar/)?$s" "$T/mac" || fail "the Mac does not take $s"
	done
}

# Every file is in a list; none is both repo-only and on a machine.
t_select_every_file() {
	sel
	eq "in no list" "" "$(sort -u "$T/x220" "$T/mac" "$T/repo" | comm -23 "$T/all" -)"
	takes_all "repo-only" "$T/repo" README.md LICENSE .local/share/vertrice/SPEC.md \
		.local/share/vertrice/tests/run
}
