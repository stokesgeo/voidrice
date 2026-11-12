# vertrice on OpenBSD

vertrice is voidrice, Luke Smith's dotfiles for Linux, ported to OpenBSD
for ThinkPads X220 and X210AI. The public package contains code and defaults,
not personal account state or a user profile. The reference
is `man vertrice`; this page says what the thing is and why. The same
files now install on a Mac as well, with a macOS desktop; this page is
about the OpenBSD side, and `man vertrice` has the Mac.

## Native tools and small scripts

voidrice already has the shape wanted: plain shell scripts in
`~/.local/bin`, configs in `~/.config`, dmenu for every menu, one status
line, and a key for each job. The port swaps the Linux parts (systemd,
PipeWire, sudo, /sys, GNU flags) for what OpenBSD base has (rc, sndio,
doas, apm and sysctl, BSD flags) and keeps the rest. Most of the scripts
are still Luke's.

The defaults are ksh, cwm and xterm. Packages supply capabilities missing from
base. The microphone and camera are off until explicitly enabled.

## Day to day

Log in on the console and X starts: cwm, with voidrice's keys, a status
line along the bottom, dmenu for menus. Super+F1 lists the keys.
The default wallpaper is a hotkey and workflow guide. A saved wallpaper choice
is kept; select `.local/share/vertrice/KEYS.png` with `setbg` to return to the guide.
Super+w opens qutebrowser, the human default. Chromium (`chrome` on OpenBSD)
is for agents and remains available on Super+Shift+w. Check actual rendering
and input on the machine; do not weaken browser security to fix a startup issue.
W3m is the terminal browser: Newsboat comma-w, the URL menu and LF HTML
previews use it. TERMINAL_BROWSER in the profile selects w3m, lynx or elinks
for interactive browsing and the shared HTML renderer. This does not replace
the graphical browser default.
After system installation, `vertrice-pi-setup` installs Pi as the ordinary
user. Super+a opens it; `ipe-pi FILE` opens a live writing seat. The manual
describes the separate edit, save and backup paths.
`man vertrice` has the rest: the install, what the installer changes,
the machine settings, backups (`bk`), writing (`writemode`, `proof`),
the dictionary (`dict`, `roget`) and reminders (`~/.calendar/calendar`).
Codex/cdxb is deprecated; Pi is the default assistant.
The dotfiles are a bare git repository with
`$HOME` as its work tree; `config` is git pointed at it, and
`config pull origin master` updates.

Development tests run from the repository; they are not installed user tasks.
