# Privacy: fewer suggestions, no site notifications.
c.completion.open_categories = ["searchengines", "quickmarks", "bookmarks", "filesystem"]  # no history suggestions
c.content.notifications.enabled = False  # deny site notifications
config.load_autoconfig()  # last, so :set changes win
