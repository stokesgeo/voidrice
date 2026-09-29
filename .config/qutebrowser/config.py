# voidrice's Firefox tweaks (larbs.js), where qutebrowser has the setting.
# No counterpart (qutebrowser lacks the feature): sponsored top sites, form
# prefill, address-bar autofill, Pocket, Sync, userChrome.css, the
# right-click fix. Allowing http:// and keeping cookies are the defaults.

c.completion.open_categories = ["searchengines", "quickmarks", "bookmarks", "filesystem"]  # no history suggestions
c.content.notifications.enabled = False  # no push notices

config.load_autoconfig()  # last, so :set changes win
