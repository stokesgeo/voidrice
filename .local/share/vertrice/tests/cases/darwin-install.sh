# The Mac install: vertrice-install hands over to darwin/install when uname
# says Darwin. Here copies of both sit in $T/x, with /etc/shells and
# /var/db/updates rewritten into $T/sys (derived, lib.sh). uname, brew,
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
		"s|/etc/shells|$R/etc/shells|g; s|/var/db/updates|$R/var/db/updates|g" >/dev/null
	for m in uname brew sudo chsh launchctl defaults killall open sysadminctl pkg_add rcctl; do
		ln -s "$VT_MOCKS/_log" "$T/bin/$m"
	done
	echo Darwin >"$VT_STATE/out.uname"
	printf '/bin/sh\n/bin/zsh\n' >"$R/etc/shells"
	export USER=puffy SHELL=/bin/zsh
	uid=$(id -u)
	la=$HOME/Library/LaunchAgents
}
di() { "$VT_SH" "$T/x/bin/vertrice-install" >"$T/out" 2>&1; }

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
	logged "^sudo install -o puffy -m 644 /dev/null $R/var/db/updates\$"
	for a in vertrice.newsup vertrice.updates; do
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
	for a in vertrice.newsup vertrice.updates; do
		eq "$a loaded twice" 2 "$(nlogged "^launchctl bootstrap .*/$a.plist")"
		eq "$a: unloaded, then loaded" "bootout bootstrap bootout bootstrap" \
			"$(grep "launchctl .*$a" "$VT_STATE/log" | cut -d' ' -f2 | paste -sd' ' -)"
	done
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
	for a in vertrice.newsup vertrice.updates; do
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
	printf 'PATH=%s:$PATH\n' "$T/p" >"$HOME/.profile"
	"$VT_SH" -c "$(agentcmd vertrice.newsup)"
	notlogged '^newsup'
	ln -s "$VT_MOCKS/_log" "$T/p/newsboat"
	"$VT_SH" -c "$(agentcmd vertrice.newsup)" || fail "agent failed"
	logged '^newsup $'
	notlogged '^newsboat'
}

# The screen asks for the password at once after sysact's lock: set once,
# with the password asked for, never passed.
t_darwin_install_screenlock() {
	di_setup; di
	logged '^sysadminctl -screenLock status$'
	logged '^sysadminctl -screenLock immediate -password -$'
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
	cmd=$(agentcmd vertrice.updates | sed "s|/opt/homebrew/bin/brew|brew|g; s|/var/db/updates|$T/updates|g")
	"$VT_SH" -c "$cmd" || fail "agent failed"
	logged '^brew update --quiet$'
	logged '^brew outdated --quiet$'
	bar=$(derived .local/bin/statusbar/sb-updates sb-updates "s|/var/db/updates|$T/updates|g")
	eq "bar" "📦2" "$("$VT_SH" "$bar")"
}
