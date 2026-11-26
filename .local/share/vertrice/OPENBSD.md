# vertrice on OpenBSD

Vertrice adapts Luke Smith's voidrice to OpenBSD, using native tools and small
scripts: ksh, cwm, xterm, dmenu and a single status line. Packages add what base
lacks. The public environment supplies generic defaults, not personal profiles
or signed-in accounts. Pi and Crush are both required supported assistants.
X220 and X210AI are target machines; X210AI hardware has not yet been tested.
A shared configuration is not evidence that every device works.

## Day to day

Console login on the first virtual terminal starts X; xenodm is also supported.
Super+F1 lists the actual cwm bindings. The default wallpaper is a hotkey guide;
`setbg ~/.local/share/vertrice/KEYS.png` restores it after a personal choice.

- Super+Return opens a terminal; Super+d opens the application menu.
- Super+w opens qutebrowser; Super+Shift+w opens the wireless menu.
  Chromium is available separately as `chrome`.
- Super+a opens Pi; `crush` starts Crush in a terminal.
- `ipe-pi FILE` opens a live writing seat. Reading the live buffer, editing and
  explicitly saving it are separate actions.
- Super+F2 locks, Super+F5 opens the sndio mixer, Super+F7 selects displays,
  Super+F8 toggles Transmission and Super+F11 toggles the palette.
  Check hardware actions on the actual machine.

W3m supplies terminal browsing and HTML text rendering. Set `TERMINAL_BROWSER`
in `~/.config/shell/profile` to w3m, lynx or elinks and install the matching
package before a fresh login. That variable does not change the graphical
browser. Reloading a shell profile does not update an already-running X session.

The microphone and camera default to off. Enable them only for a chosen call
or recording and restore the intended state afterwards. Never weaken browser
TLS checks or sandbox settings to make a startup fault disappear.

## Start with useful work

Read `man vertrice` for keys, writing, dictionary, reminders, media and `bk`
backups. Set up wanted optional applications with their own local data and
account UI; do not install every optional package merely to obtain one program.
Sign in separately to Pi and Crush on the machine, keeping secrets out of
prompts, source and transfer media. Install both with `vertrice-pi-setup` and `vertrice-crush-setup` as the ordinary
user. A clone alone is not an installed environment.

See [post-install use](POST-INSTALL.md) for practical checks,
[assistant capabilities](PI_CAPABILITIES.md) for authority boundaries and
[source updates](SOURCE-UPDATES.md) for the distinction between source review,
HOME deployment and system maintenance. Do not use a forced checkout or rerun
system provisioning as routine repair.

The same repository supports a separate macOS desktop; `man vertrice` describes
its installer, permissions and keys.
