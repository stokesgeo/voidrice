# Important Note

These cronjobs send notifications and drive X programs, so they need the session's D-Bus address and display.
OpenBSD has no fixed bus address: xinitrc writes the session's to `~/.cache/session-env` (mode 600).

Add a job with `crontab -e`, reading your profile and that file first:

```
*/30 * * * * . $HOME/.profile; . $HOME/.cache/session-env; newsup
```

`crontog` switches all your cron jobs off and on.
