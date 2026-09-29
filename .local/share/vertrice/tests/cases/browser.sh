# qutebrowser's config.py (larbs.js's intent) and the removed inert files.

t_browser_qutebrowser_config() {
	command -v python3 >/dev/null 2>&1 || skip "no python3 to read config.py"
	# Run config.py against stand-ins for qutebrowser's c and config
	# objects: it must parse, set only the names below, and load
	# autoconfig.yml last, so your own :set changes still win.
	out=$(python3 - "$REPO/.config/qutebrowser/config.py" <<'EOF'
import sys
log = []
class C:
    def __init__(self, path=""):
        object.__setattr__(self, "_p", path)
    def __getattr__(self, name):
        return C(self._p + "." + name if self._p else name)
    def __setattr__(self, name, value):
        log.append("%s.%s=%r" % (self._p, name, value))
class Config:
    def load_autoconfig(self, *a):
        log.append("load_autoconfig%r" % (a,))
exec(compile(open(sys.argv[1]).read(), sys.argv[1], "exec"),
     {"c": C(), "config": Config()})
print("\n".join(log))
EOF
) || fail "config.py failed: $out"
	eq "settings, then autoconfig.yml" \
"completion.open_categories=['searchengines', 'quickmarks', 'bookmarks', 'filesystem']
url.auto_search='naive'
content.cookies.store=True
content.notifications.enabled=False
load_autoconfig()" "$out"
}

t_browser_inert_files_gone() {
	for f in .config/sxiv .config/firefox/larbs.js; do
		[ -e "$REPO/$f" ] || [ -L "$REPO/$f" ] && fail "$f is back"
	done
	return 0
}
