# Cron jobs that notify

These jobs (`newsup`, and mutt-wizard's `mailsync`) send notifications and
may drive X programs, so they need the session's D-Bus address and display.
Cron starts them with neither.

Voidrice pointed cron at the display with `export DISPLAY=:0`, and systemd
gave every login a fixed bus at `/run/user/UID/bus`. OpenBSD has no such
fixed bus: the bus is the one `dbus-launch` starts in xinitrc, and its
address changes with each session. So xinitrc writes the address, the
display and the X authority file to `~/.cache/session-env` (mode 600) when
the session starts. A cron line reads your profile (for PATH and the XDG
directories) and that file, then runs the job:

```
*/30 * * * * . $HOME/.profile; . $HOME/.cache/session-env; newsup
```

Add it with `crontab -e`. `crontog` switches all your cron jobs off and on.

When no X session is running, the file names the last session's bus, which
is gone: notify-send then fails quietly and the job itself still runs.

Root's update counter (`vertrice-updates`, added to root's crontab by
`vertrice-install system`) does not use this: it writes a file that the
`sb-updates` block reads, and never talks to the session.
