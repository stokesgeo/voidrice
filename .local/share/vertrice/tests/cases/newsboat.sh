# The existing URL selector must arrive with the optional news workflow.
t_newsboat_urlscan_dependency() {
	grep -Fxq urlscan "$REPO/.local/share/openbsd/pkglist.extra" || fail 'urlscan missing from optional packages'
	grep -q '^external-url-viewer "urlscan -dc -r' "$REPO/.config/newsboat/config" || fail 'Newsboat selector/handler contract changed'
}

t_newsboat_terminal_browser_macro() {
	grep -Fq 'macro w set browser "${TERMINAL_BROWSER:-lynx}" ; open-in-browser ; set browser linkhandler' \
		"$REPO/.config/newsboat/config" || fail 'terminal browser macro must restore linkhandler'
}

t_newsboat_terminal_browser_menu() {
	export TERMINAL_BROWSER=w3m
	answers w3m
	dmenuhandler 'https://example.org/article?x=1&y=2'
	logged '^detach xterm -e w3m https://example.org/article\?x=1&y=2$'
}

t_newsboat_legacy_terminal_browser_menu() {
	export TERMINAL_BROWSER=lynx
	answers lynx
	dmenuhandler 'https://example.org/article'
	logged '^detach xterm -e lynx https://example.org/article$'
}
