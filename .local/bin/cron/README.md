# Important Note

These cronjobs have components that require information about your current display to display notifications correctly.

When you add them as cronjobs, I recommend you precede the command with commands as those below:

```
export DISPLAY=:0; . $HOME/.profile; then_command_goes_here
```

This ensures that xdotool commands will function and environmental variables will work as well.

OpenBSD note: there is no /run/user session bus path to point at. notify-send needs the D-Bus session started by `dbus-launch` in xinitrc; its address is in that session's environment only. Run notifying jobs from inside the X session (a loop started in xprofile) if cron cannot reach the bus.
