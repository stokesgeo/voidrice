# qutebrowser's config.py: it runs, and loads autoconfig.yml last.

t_browser_qutebrowser_config() {
	command -v python3 >/dev/null 2>&1 || skip "no python3"
	out=$(python3 - "$REPO/.config/qutebrowser/config.py" <<'EOF'
import sys
class C:
    def __init__(self, p=""): object.__setattr__(self, "p", p)
    def __getattr__(self, n): return C(self.p + "." + n if self.p else n)
    def __setattr__(self, n, v): print(self.p + "." + n)
class Config:
    def load_autoconfig(self): print("load_autoconfig")
exec(open(sys.argv[1]).read(), {"c": C(), "config": Config()})
EOF
) || fail "config.py failed: $out"
	eq "settings, then autoconfig.yml" "completion.open_categories
content.notifications.enabled
load_autoconfig" "$out"
}
