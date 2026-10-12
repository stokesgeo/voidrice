# The Mac install: vertrice-install hands over to darwin/install when uname
# says Darwin. Here copies of both sit in $T/x, with /etc/shells,
# Homebrew's bin in PATH rewritten into $T/sys (derived,
# lib.sh): on a Mac the real brew would come before the mock. uname, brew,
# sudo, chsh, launchctl, defaults, killall, open and sysadminctl are logging mocks, so
# sudo runs nothing. ~/Library/LaunchAgents is in the case's own HOME.
#
# Known: brew bundle --file (Homebrew's cmd/bundle.rb), launchctl's
# bootout and bootstrap with gui/UID (launchctl(1)). Assumed, not run on a
# Mac: the rest of what macOS answers.

di_setup() {
	R=$T/sys
	mkdir -p "$T/x/bin" "$T/x/share" "$R/etc" "$R/var/db"
	cp "$REPO/.local/bin/vertrice-install" "$T/x/bin/"
	cp -R "$REPO/.local/share/darwin" "$T/x/share/"
	derived .local/share/darwin/install x/share/darwin/install \
		"s|/etc/shells|$R/etc/shells|g; s|/var/db/updates|$R/var/db/updates|g
		 s|^PATH=/opt/homebrew/bin:|PATH=$R/opt/homebrew/bin:|" >/dev/null
	for m in uname brew sudo chsh launchctl defaults killall open sysadminctl pkg_add rcctl; do
		ln -s "$VT_MOCKS/_log" "$T/bin/$m"
	done
	echo Darwin >"$VT_STATE/out.uname"
	echo 'screenLock delay is immediate' | fx out.sysadminctl
	printf '/bin/sh\n/bin/zsh\n' >"$R/etc/shells"
	export USER=puffy SHELL=/bin/zsh
	uid=$(id -u)
	la=$HOME/Library/LaunchAgents
}
di() { "$VT_SH" "$T/x/bin/vertrice-install" >"$T/out" 2>&1; }

t_darwin_install_bundle_failure() {
	di_setup
	echo 1 | fx rc.brew
	di && fail "failed bundle reported success"
	notlogged '^chsh'
	notlogged '^sudo'
	notlogged '^launchctl'
	notlogged '^open'
}

t_darwin_install_bootstrap_failure() {
	di_setup
	echo 5 | fx rc.launchctl
	VT_SLEEP=0 di && fail "failed bootstrap reported success"
	eq "failed agent retried once" 2 "$(nlogged '^launchctl bootstrap')"
	notlogged '^defaults'
	notlogged '^open'
}

t_darwin_install_shell_registration_failure() {
	di_setup
	echo 1 | fx rc.sudo
	di && fail "failed shell registration reported success"
	notlogged '^chsh'
	notlogged '^launchctl'
}

t_darwin_install_hands_over() {
	di_setup; di
	logged '^brew bundle --file=Brewfile$'
	notlogged '^pkg_add'
	notlogged '^rcctl'
}

t_darwin_install_steps() {
	di_setup; di
	logged "^sudo tee -a $R/etc/shells\$"
	logged '^chsh -s /opt/homebrew/bin/oksh$'
	notlogged '^sudo install'
	for a in vertrice.mpd vertrice.newsup vertrice.updates; do
		cmp -s "$REPO/.local/share/darwin/$a.plist" "$la/$a.plist" || fail "$a.plist not in LaunchAgents"
		logged "^launchctl bootout gui/$uid/$a\$"
		logged "^launchctl bootstrap gui/$uid $la/$a.plist\$"
	done
	notlogged '^brew services'	# AeroSpace starts the bar
	logged '^defaults write com.apple.dock autohide -bool true$'
	logged '^defaults write -g InitialKeyRepeat -int 20$'
	logged '^open -a AeroSpace$'
}

t_darwin_install_twice() {
	# Shell set and the update file there: no sudo, no chsh. Each agent is
	# unloaded before it is loaded again.
	di_setup
	echo /opt/homebrew/bin/oksh >>"$R/etc/shells"
	: >"$R/var/db/updates"
	export SHELL=/opt/homebrew/bin/oksh
	di; di
	notlogged '^sudo'
	notlogged '^chsh'
	eq "one oksh in /etc/shells" 1 "$(grep -c oksh "$R/etc/shells")"
	for a in vertrice.mpd vertrice.newsup vertrice.updates; do
		eq "$a loaded twice" 2 "$(nlogged "^launchctl bootstrap .*/$a.plist")"
		eq "$a: unloaded, then loaded" "bootout bootstrap bootout bootstrap" \
			"$(grep "launchctl .*$a" "$VT_STATE/log" | cut -d' ' -f2 | paste -sd' ' -)"
	done
}

# bootout can return before launchd has let the agent go; bootstrap then
# fails ("Bootstrap failed: 5", assumed from reports, not seen here). The
# launchctl here fails each agent's first bootstrap: a second must follow.
t_darwin_install_bootstrap_race() {
	di_setup
	rm "$T/bin/launchctl"
	cat >"$T/bin/launchctl" <<'EOF'
#!/bin/sh
echo "launchctl $*" >>"$VT_STATE/log"
[ "$1" = bootstrap ] || exit 0
[ -e "$VT_STATE/booted.${3##*/}" ] && exit 0
: >"$VT_STATE/booted.${3##*/}"
echo "Bootstrap failed: 5: Input/output error" >&2; exit 5
EOF
	chmod +x "$T/bin/launchctl"
	VT_SLEEP=0 di
	for a in vertrice.mpd vertrice.newsup vertrice.updates; do
		eq "$a: tried again" 2 "$(nlogged "^launchctl bootstrap .*/$a.plist")"
	done
	logged '^open -a AeroSpace$'
}

t_darwin_install_brewfiles() {
	# One entry a line, each a tap, brew or cask, and a tap for each
	# tapped name.
	for f in Brewfile Brewfile.extra; do
		bad=$(grep -v -e '^#' -e '^$' "$REPO/.local/share/darwin/$f" |
			grep -Ev '^(tap|brew|cask) "[a-z0-9./@-]+"$')
		eq "$f: plain entries" "" "$bad"
	done
	f=$REPO/.local/share/darwin/Brewfile
	for t in $(sed -En 's/^(brew|cask) "([^/"]*\/[^/"]*)\/.*/\2/p' "$f"); do
		grep -q "^tap \"$t\"$" "$f" || fail "no tap for $t"
	done
}

# The agents' plists: each parses, is named for its label, and runs /bin/sh.
t_darwin_install_plists() {
	command -v python3 >/dev/null 2>&1 || skip "no python3 to parse a plist"
	for a in vertrice.mpd vertrice.newsup vertrice.updates; do
		got=$(python3 -c 'import plistlib, sys
p = plistlib.load(open(sys.argv[1], "rb"))
print(p["Label"], p["ProgramArguments"][0], p["ProgramArguments"][1])' \
			"$REPO/.local/share/darwin/$a.plist") || fail "$a.plist does not parse"
		eq "$a" "$a /bin/sh -c" "$got"
	done
}

# agentcmd NAME: the command an agent's /bin/sh -c runs.
agentcmd() {
	sed -n '/<string>-c<\/string>/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;}' \
		"$REPO/.local/share/darwin/$1.plist" | sed 's/&gt;/>/g; s/&lt;/</g; s/&amp;/\&/g'
}

# Reminders are Reminders.app's (darwin/remind): no calendar(1) agent.
t_darwin_install_no_calendar() {
	[ ! -e "$REPO/.local/share/darwin/vertrice.calendar.plist" ] || fail "a calendar agent"
	grep -q calendar "$REPO/.local/share/darwin/install" && fail "install names calendar"
	return 0
}

# newsup under the login profile's PATH, and only once newsboat is there.
t_darwin_install_newsup_agent() {
	mkdir -p "$T/p"
	ln -s "$VT_MOCKS/_log" "$T/p/newsup"
	# Not the caller's PATH: the host may have newsboat.
	printf 'PATH=%s:/usr/bin:/bin\n' "$T/p" >"$HOME/.profile"
	"$VT_SH" -c "$(agentcmd vertrice.newsup)"
	notlogged '^newsup'
	ln -s "$VT_MOCKS/_log" "$T/p/newsboat"
	"$VT_SH" -c "$(agentcmd vertrice.newsup)" || fail "agent failed"
	logged '^newsup $'
	notlogged '^newsboat'
}

# An insecure lock setting stops the install before packages or prompts.
t_darwin_install_screenlock() {
	di_setup
	echo 'screenLock delay is 5 seconds' | fx out.sysadminctl
	di && fail "insecure lock reported success"
	logged '^sysadminctl -screenLock status$'
	notlogged 'screenLock immediate'
	notlogged '^brew'
	notlogged '^sudo'
	has "lock instruction" 'Immediately' "$(cat "$T/out")"
	: >"$VT_STATE/log"
	echo 'screenLock delay is immediate' | fx out.sysadminctl
	di
	logged '^sysadminctl -screenLock status$'
	notlogged 'screenLock immediate'
}

t_darwin_install_updates_agent() {
	# What brew outdated lists, sb-updates counts, as on the X220.
	ln -s "$VT_MOCKS/_log" "$T/bin/brew"
	printf 'ffmpeg\nmpv\n' | fx out.brew
	cmd=$(agentcmd vertrice.updates | sed 's|/opt/homebrew/bin/brew|brew|g')
	"$VT_SH" -c "$cmd" || fail "agent failed"
	logged '^brew update --quiet$'
	logged '^brew outdated --quiet$'
	bar=$(derived .local/bin/statusbar/sb-updates sb-updates "s|/var/db/updates|$XDG_CACHE_HOME/updates|g")
	eq "bar" "📦2" "$("$VT_SH" "$bar")"
}

t_darwin_install_updates_preserve_on_failure() {
	ln -s "$VT_MOCKS/_log" "$T/bin/brew"
	printf 'previous\n' >"$XDG_CACHE_HOME/updates"
	echo 1 | fx rc.brew
	cmd=$(agentcmd vertrice.updates | sed 's|/opt/homebrew/bin/brew|brew|g')
	"$VT_SH" -c "$cmd" && fail "failed brew update reported success"
	eq "previous count survives" previous "$(cat "$XDG_CACHE_HOME/updates")"
	notlogged '^brew outdated'
	# A failing outdated may still print a partial list: do not publish it.
	rm "$T/bin/brew"
	cat >"$T/bin/brew" <<'EOF'
#!/bin/sh
[ "$1" = update ] && exit 0
echo partial
exit 1
EOF
	chmod +x "$T/bin/brew"
	"$VT_SH" -c "$cmd" && fail "failed brew outdated reported success"
	eq "partial count not published" previous "$(cat "$XDG_CACHE_HOME/updates")"
}

t_darwin_install_updates_home_cache() {
	ln -s "$VT_MOCKS/_log" "$T/bin/brew"
	printf 'mpv\n' | fx out.brew
	unset XDG_CACHE_HOME
	cmd=$(agentcmd vertrice.updates | sed 's|/opt/homebrew/bin/brew|brew|g')
	"$VT_SH" -c "$cmd" || fail "agent failed"
	eq "launchd uses HOME without XDG" mpv "$(cat "$HOME/.cache/updates")"
}
