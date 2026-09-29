# voidrice on OpenBSD

This branch ports Luke Smith's voidrice to OpenBSD, for a ThinkPad X220.
Upstream is Arch/Void Linux; the port keeps the pattern (suckless tools,
scripts in `~/.local/bin`, config in `~/.config`, bookmarks compiled to
shell shortcuts) and swaps each Linux mechanism for the OpenBSD base one.

**Base first by default.** The default setup is what OpenBSD ships: ksh,
cwm and xterm. voidrice's tiling keys are carried into cwm (see "Keys"
below). Luke's dwm and st are opt-ins: build them into `~/.local/src`, then
set `WM="dwm"` and `TERMINAL="st"` in `.config/shell/profile`.

**State.** Written and tested off the machine: every shell file parses under
oksh (the portable OpenBSD ksh), the status blocks run against mocked
OpenBSD command output under BWK awk (OpenBSD's awk), and getbib's rewrite
matches the old output. Nothing has run on OpenBSD yet.
`~/.local/share/openbsd/check` tests on the machine each assumption that
could not be tested here.

## The walk: what changed and why

Each item names the Linux mechanism, the OpenBSD one, and the reason.
The commits follow the same order.

1. **Detaching programs.** Linux: `setsid -f cmd`. OpenBSD has the
   setsid(2) call but no setsid(1) command. New `detach` runs
   `nohup cmd >/dev/null 2>&1 &`: nohup makes the child ignore SIGHUP,
   the signal sent when its terminal closes. One name, so a C version
   can replace it later without touching the callers.
2. **Finding processes.** pidof and killall are not in base; pgrep and
   pkill are, with `-x` for an exact name. A shell script runs as its
   interpreter, so script lookups use `pgrep -f` (whole command line).
3. **The status bar.** dwmblocks refreshes a block on SIGRTMIN+n.
   OpenBSD has no real-time signals, so the signal cannot be named. New
   `sbar` (ksh) runs the blocks and writes the root window name; it
   sleeps in the background and `wait`s, so SIGUSR1 interrupts the wait
   and it redraws. `sb-refresh` sends SIGUSR1, after checking that the
   pid in the pidfile is still sbar (SIGUSR1 kills a process that does
   not catch it). Cost: a refresh redraws every block. Clickable blocks
   rode on sigqueue(3), also absent, so clicks do nothing for now.
4. **The shell.** ksh is base. `~/.profile` (a symlink to
   `.config/shell/profile`) is read by login shells and sets `ENV` to
   `.config/ksh/kshrc`, which every interactive shell reads. What zsh
   did that ksh cannot is listed at the end of the kshrc. Aliases use
   only flags OpenBSD's tools have (POSIX, plus `ls -h`), because an
   alias with a missing flag breaks the command it shadows.
5. **The X session.** `startx` from the first console (`ttyC0`), as
   voidrice does from tty1; or xenodm, which runs `~/.xsession` (a
   symlink to xinitrc). xinitrc starts the D-Bus session bus first, so
   dunst and notify-send share one bus; then `$WM`: cwm with
   `.config/cwm/cwmrc` by default, or dwm plus sbar when `WM=dwm` and dwm
   is installed. It starts ssh-agent only if none is running (xenodm may
   have started one). xprofile now loads xresources, where xterm gets
   voidrice's font and Alt-as-Meta.
6. **Sound.** sndiod(8) is the base sound server, started by rc(8).
   mpd outputs to sndio, volume goes through sndioctl(1), recording
   through ffmpeg's sndio input.
7. **Status block data.** /sys and /proc do not exist. Battery: apm(8).
   Backlight: wsconsctl(8) display.brightness. Temperature and CPU load:
   sysctl hw.sensors and kern.cp_time2. Network: one ifconfig(8) run.
   Traffic: netstat -ibn. Memory: top(1) and hw.physmem.
8. **GNU syntax.** `\s \S \+ \|` in sed and grep become POSIX classes or
   `-E`; `grep -P`, `sed \L`, `stat -c`, `file --mime-type`, `shuf`,
   `numfmt`, `shred`, `date -d` and `--suffix` get BSD equivalents.
   getbib's formatter became one awk pass.
9. **Root.** sudo becomes doas(1). Scripts that need root open a
   terminal so doas can ask for the password.
10. **No XDG_RUNTIME_DIR, no flock(1).** Linux sets XDG_RUNTIME_DIR per
    login; OpenBSD does not, and has no flock command. Four network
    blocks (forecast, moonphase, iplocate, price) locked through both.
    They now lock with `mkdir` on a directory in /tmp: mkdir is atomic,
    and OpenBSD's rc clears /tmp at boot, so a crash cannot leave a
    stale lock. State files that were in /tmp and could be abused by a
    planted symlink (OpenBSD has no protected_symlinks) moved to
    `~/.cache`. Upstream's other /tmp downloads (linkhandler,
    dmenuhandler, noisereduce) are unchanged.

## Keys: voidrice's dwm on cwm

cwm is a floating window manager with tiling on request. The mapping keeps
Luke's key for each job and uses cwm's own function where one exists
(`.config/cwm/cwmrc`; Super+F1 opens it). Every function name was checked
against cwm's source, and `cwm -n` accepts the file.

| Key (Super+) | dwm | cwm |
|---|---|---|
| j / k | focus next / previous | `window-cycle-ingroup` / `window-rcycle-ingroup` |
| t / Shift+t | tile / bottom stack layout | `window-vtile` / `window-htile`: focused window becomes master, the group's other windows share the rest |
| Space | zoom (focused to master) | `window-vtile` |
| h / l | master narrower / wider | resize the focused window left / right |
| Shift+h/j/k/l, Ctrl+h/j/k/l | (push in stack) | move / resize the window, vi directions |
| f / Shift+u | fullscreen / monocle | `window-fullscreen` / `window-maximize` |
| q | kill window | `window-close` |
| 1-9 / Shift+1-9 / Ctrl+1-9 | view / tag / toggle view | `group-only-N` / `window-movetogroup-N` / `group-toggle-N` |
| 0 / Shift+0 / s | view all / tag all / sticky | `group-toggle-all` / `window-stick` / `window-stick` |
| Tab, \ / g, ; / PgUp, PgDn | last tag / prev, next tag | `group-last` / `group-rcycle`, `group-cycle` |
| Return / Shift+Return / ' | terminal / scratch terminal / scratch calculator | `$TERMINAL` / `scratch term` / `scratch calc` |
| d | dmenu_run | `menu-exec`, cwm's own run prompt |
| b | toggle bar | `sb-show`: the status line as a notification |
| w, e, r, n, m, c, Shift+d/e/n/r | browser, mail, lf, wiki, music, chat, passmenu, abook, news, top | same programs (top from base for htop) |
| p, [, ], comma, period | mpc | mpc |
| minus / equal / Shift+m | volume / mute (wpctl) | sndioctl |
| BackSpace, Shift+q | sysact | sysact |
| F1 / F5 | LARBS guide / reload xresources | cwmrc in less / `restart` (rereads cwmrc) |
| Print, Shift+Print, Super+Print, Delete | screenshots, recording | same |

Mouse: Super+drag moves, Super+right-drag resizes. Clicking the empty
desktop gives cwm's window, group and command menus.

What does not carry over, because cwm has no equivalent:

- Automatic layouts. cwm tiles only when asked; after opening or closing
  a window, press Super+t again. Spiral, dwindle, deck and centered
  master (y, u, i) and the master count (o) are gone.
- Gaps (a, z, x) and the bar. Super+b shows the status line instead.
- Moving a window to the next or previous tag (Shift+g, Shift+;), and
  floating toggle (cwm windows are always floating).
- The XF86 media and brightness keys. The X220's volume, mute and
  brightness keys are handled below X (acpithinkpad), so they work without
  a binding (to check on the machine). F4 (pulsemixer), F8-F11 (mailsync,
  the removed mounters, webcam) are unbound.

## Installing on the X220

System side (root, typed by the owner):

- Packages: `doas pkg_add -l ~/.local/share/openbsd/pkglist`. Names are
  from memory, not checked against the current ports tree; `check`
  reports any that did not install.
- `rcctl enable apmd && rcctl start apmd` for zzz/ZZZ and battery data.
  `rcctl set apmd flags -A` adds automatic CPU speed. Whether a normal
  user may run `zzz` depends on apmd's socket permissions: not checked.
- `rcctl enable messagebus && rcctl start messagebus` (the system D-Bus
  from the dbus package; see its readme in /usr/local/share/doc/pkg-readmes
  for the machine-id step).
- `/etc/doas.conf`: at least `permit persist :wheel`. nvim's `:w!!`
  runs doas with no terminal, so it works only under a `nopass` rule.
- Console caps-to-escape: `keyboard.map+="keysym Caps_Lock = Escape"`
  in `/etc/wsconsctl.conf`.
- Screen recording with sound: `sysctl kern.audio.record=1` (off by
  default; `/etc/sysctl.conf` to keep it).

Home side: check the branch out into `$HOME` (for example as a bare repo
with `$HOME` as its work tree), then log in on the console and run
`~/.local/share/openbsd/check`, once on the console and once inside X.

Optional, for Luke's dwm and st: they are separate repos. They build on
OpenBSD once `config.mk` points at `/usr/X11R6` (their config.mk has
OpenBSD lines). Luke's dwm sends status-bar clicks with sigqueue(3), so
that patch needs replacing before his dwm builds here. dmenu comes from
packages.

## Not ported, or not tested

- `sd` (terminal in the focused window's directory): reads
  `/proc/PID/cwd`. OpenBSD exposes a process's cwd only through
  sysctl(3) `KERN_PROC_CWD`. A C helper of a few dozen lines would
  close it. Until then `sd` opens a plain terminal.
- Removed: mounter, unmounter (lsblk, udisks, cryptsetup, MTP),
  dmenumountcifs (avahi, CIFS), dmenupass (sudo askpass), remapd (udev),
  the pacman update blocks and cron job.
- Untouched and untested: pywal's postrun (GNU `echo -e`, `grep` lazy
  match), pinentry/preexec (Linux library paths), ueberzug previews
  (not packaged; lfub falls back to plain lf), cron jobs that notify
  (no fixed D-Bus address to point cron at).
- lf's opener trusts OpenBSD file(1)'s MIME database, which differs from
  libmagic's. A type it does not know comes back as
  application/octet-stream and opens in zathura. Try an mp3, mp4, epub
  and an empty file once on the machine.
- otp writes the scanned QR image to /tmp, which is on disk on OpenBSD
  (Linux used a RAM-backed runtime directory). `rm -P` overwrites the
  file, but on an SSD wear levelling can keep the old blocks.

## Open

- What this fork becomes, and whether a Mac port follows.
