# qutebrowser settings: the intent of voidrice's .config/firefox/larbs.js
# (Luke's changes on top of the arkenfox user.js), carried to qutebrowser,
# vertrice's $BROWSER. Setting names checked against qutebrowser's
# settings.asciidoc at v3.7.0, the packaged version.
#
# Carried over:
#	browser.urlbar.suggest.history false	-> no history in :open's
#						   completion
#	keyword.enabled true			-> words typed in :open search
#						   (url.auto_search, the default)
#	network.cookie.lifetimePolicy 0,	-> cookies kept until they expire
#	privacy.clearOnShutdown.cookies false	   (content.cookies.store, the
#						   default)
#	dom.push.enabled false			-> sites may not show
#						   notifications (the nearest
#						   setting: qutebrowser has no
#						   separate switch for push)
#	dom.security.https_only_mode false	-> nothing to set: qutebrowser
#						   opens http:// sites
#
# No qutebrowser counterpart (qutebrowser does not have the feature):
#	browser.urlbar.suggest.topsites (sponsored top sites),
#	signon.prefillForms (a password manager filling forms),
#	browser.urlbar.autoFill (inline completion in the address bar),
#	extensions.pocket.enabled (Pocket),
#	identity.fxaccounts.enabled (Firefox Sync),
#	toolkit.legacyUserProfileCustomizations.stylesheets (userChrome.css
#	for the browser's own interface; content.user_stylesheets styles web
#	pages only),
#	ui.context_menus.after_mouseup (a Firefox right-click fix).
#
# Your own :set and :bind changes live in autoconfig.yml. It is loaded
# last, so they still override anything here, as larbs.js allowed.

c.completion.open_categories = ["searchengines", "quickmarks", "bookmarks", "filesystem"]
c.url.auto_search = "naive"
c.content.cookies.store = True
c.content.notifications.enabled = False

config.load_autoconfig()
