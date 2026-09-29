# vertrice: voidrice on OpenBSD

vertrice is Geo's fork of Luke Smith's voidrice, ported to OpenBSD for a
ThinkPad X220.
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
(`.config/cwm/cwmrc`; Super+F1 lists its keys). Every function name was checked
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
| w / Shift+w | browser / nmtui | qutebrowser (`$BROWSER`) / chromium |
| e, r, n, m, c, Shift+d/e/n/r | mail, lf, wiki, music, chat, passmenu, abook, news, top | same programs (top from base for htop) |
| F9 / F10 | mounter / unmounter | same, OpenBSD versions, in a terminal for doas |
| F11 / F12 | webcam / remaps | `touchpad toggle`: touchpad off/on, TrackPoint stays / remaps (keys and TrackPoint scrolling again) |
| F4 | pulsemixer | `nightlight`: warm screen on/off (sct) |
| F8 | mailsync | `theme toggle`: day / night palette |
| p, [, ], comma, period | mpc | mpc |
| minus / equal / Shift+m | volume / mute (wpctl) | sndioctl |
| BackSpace, Shift+q | sysact | sysact |
| F1 / F5 | LARBS guide / reload xresources | `keys`: this key list in dmenu, read from cwmrc / `restart` (rereads cwmrc) |
| Print, Shift+Print, Super+Print, Delete | screenshots, recording | same |

Mouse: Super+drag moves, Super+right-drag resizes. cwm's Alt mouse
bindings are removed with its Alt keys. Clicking the empty desktop gives
cwm's window, group and command menus.

What does not carry over, because cwm has no equivalent:

- Automatic layouts. cwm tiles only when asked; after opening or closing
  a window, press Super+t again. Spiral, dwindle, deck and centered
  master (y, u, i) and the master count (o) are gone.
- Gaps (a, z, x) and the bar. Super+b shows the status line instead.
- Moving a window to the next or previous tag (Shift+g, Shift+;), and
  floating toggle (cwm windows are always floating).
- The XF86 media and brightness keys. The X220's volume, mute and
  brightness keys are handled below X (acpithinkpad), so they work without
  a binding (see "X220 details").

## Editors: vi and nvim, side by side

nvim is the daily editor, with voidrice's `.config/nvim/init.vim`. vi, which
is nvi in OpenBSD base, is the fallback that always works: in single-user
mode, as root, and with no packages installed. Each has its own config, and
neither reads the other's:

- vi reads `$NEXINIT`, which the profile points at `.config/vi/exrc`. nvi
  checks NEXINIT before EXINIT, and nvim reads neither while it has an
  init.vim. The exrc turns on show-mode, ruler, bracket matching,
  auto-indent, smart case (`iclower`), incremental and extended search, and
  Tab for file names on the ex line. Checked: nvi loads it and every option
  takes effect.
- `EDITOR` and `VISUAL` are nvim when it is installed, else vi.
- Root always gets vi: doas clears EDITOR, and root's own kshrc sets
  `EDITOR=vi`. Edit root-owned files with `doas vi file`. The nvim `:w!!`
  trick is removed: nvim gives doas no terminal to ask on, so it needed a
  passwordless rule.

## Root and doas

- `doas` gives the command a fresh environment for root (HOME, PATH,
  SHELL, USER and LOGNAME become root's; DISPLAY and TERM pass through), so
  your EDITOR and variables do not follow you. It does find the command in
  *your* PATH: a script in `~/.local/bin` with the name you type would run
  as root. The profile puts `~/.local/bin` last, so base names win; for
  anything sensitive, type the full path. `.local/share/openbsd/doas.conf`
  is one rule: `permit persist setenv { ENV=/root/.kshrc } :wheel`, with no
  nopass and no keepenv.
- Root gets its own small `.local/share/openbsd/root.kshrc`: a red `#`
  prompt, vi mode, history, EDITOR=vi and PAGER=less, and `-i` on cp, mv
  and rm. The doas rule points ENV at it, so `doas -s` gives a root shell
  with it. Use `doas -s`, not `su`: su keeps your ENV and would run your
  own kshrc, from a directory you can write, as root.

## Browsers

qutebrowser is `$BROWSER` (Super+w); chromium is Super+Shift+w. Google's
Chrome does not exist for OpenBSD; chromium from ports is the same engine,
and on OpenBSD it runs under pledge(2) and unveil(2), with the paths it may
see listed in /etc/chromium. qutebrowser uses QtWebEngine, also Chromium's
engine, without that confinement.

Ladybird is left out. It has no OpenBSD port in the ports tree; the
OpenBSD build is an out-of-tree patch set kept by one person, and upstream
does not take outside ports. That is not "well maintained" yet.

## Files: archives and drives

- `ext file ...` extracts any archive by its name: tar in all its
  compressions, gz, bz2, xz, zst, Z, zip (and jar, epub), 7z, rar and
  iso. Base tar, gzip and compress do most of it; bzip2, xz, zstd, unzip
  and 7zip are in pkglist. Single compressed files are decompressed next
  to the original, which is kept, and an existing file is never
  overwritten (7z skips files that exist). lf's E key calls ext, so the
  shell and lf share one table.

### Drives: voidrice's mounter, on OpenBSD

`mounter` (Super+F9) and `unmounter` (Super+F10) keep Luke's workflow:
one dmenu list of everything mountable, fstab first, then "Mount this drive
where?", notifications at the end. What each voidrice step became:

| voidrice (Linux) | vertrice (OpenBSD) |
|---|---|
| 💾 partitions from lsblk | 💾 partitions from disklabel(8), with size and the disk's label |
| 🔒 LUKS, `cryptsetup open` in a small floating terminal | 🔒 softraid CRYPTO, `bioctl -c C` in the same small floating terminal |
| 📱 Android via simple-mtpfs | the same (simple-mtpfs is in ports) |
| `mount "$drive"` first, for fstab entries | `mount DUID.part` first: an fstab line keyed on the disk's DUID (from `sysctl hw.disknames`) gives a stick a fixed home |
| "Mount this drive where?" from /mnt /media /mount /home, offer to create | the same, with `/mnt/<partition>` offered first |
| vfat `umask=0000`, others `uid=,gid=` | FAT via mount_msdos, exFAT via mount.exfat, NTFS via ntfs-3g, owned by you; FFS, ext2, ISO9660 via base |
| unmounter: `umount`, then `cryptsetup close` | `umount`, then `bioctl -d` once nothing on the volume is mounted: the drive is locked again |
| `sudo -A` with a dmenu password prompt | doas has no askpass: the scripts reopen themselves in a small floating terminal (like voidrice's decrypt step), where doas asks once |

OpenBSD specifics handled: MBR type 7 and GPT data partitions can be FAT,
exFAT or NTFS, so mounter tries them in turn. Every mount is
`nosuid,nodev`, so a setuid program on a found stick cannot become root.
The system disk (the one holding `/`), swap, and softraid chunks already
in use (your encrypted internal disk) are never offered. Only entries dmenu
offered are accepted. Tested end to end against mocked disklabel, mount,
bioctl and doas: plain FAT, encrypted unlock-and-mount, unmount-and-lock,
and refusing typed input. Not yet on the machine.

## Everyday conveniences

- **Idle lock.** xidle(1), in base, starts from xprofile and runs xlock
  after 10 idle minutes. xresources sets `XLock.mode: blank`, so the lock
  screen draws nothing (sysact's lock uses the same).
- **USB notices.** hotplugd(8), in base, runs `/etc/hotplug/attach` as
  root when a device appears. The installed script
  (`.local/share/openbsd/hotplug-attach`) writes a new disk's name to
  /var/run/hotplug-disk and nothing else; `hotplug-watch`, started in your
  session, watches that file with entr and sends "sd1 attached: Super+F9
  to mount it". Root never reaches into your session, and nothing mounts
  by itself. Tested with entr: first attach after boot, later attaches,
  non-disk devices ignored, no stale notice on login.
- **Night light.** Super+F4 runs `nightlight`, which toggles a 4000 K
  screen with sct (a small program from ports; it sets the colour once and
  exits). `nightlight 3200` picks another temperature.
- **rsync.** The rsync alias uses openrsync(1) from base, with the flags
  it has (`-vrl`). Installing the rsync package brings back voidrice's
  `-vrPlu` (progress, partial, update). To a Linux host, which has rsync
  but not openrsync, add `--rsync-path=rsync` (not checked: openrsync's
  default remote program).

## The rice: day and night, IBM Plex, fvwm frames

voidrice's look is gruvbox brown with no frames to speak of. vertrice
replaces it:

- **Two palettes, eye-gentle and legible.** `.config/x11/themes/day` is
  pastel paper (#f5f1e8) with soft dark inks; `night` is deep slate
  (#24232e) with pastel inks. Contrast was computed, not eyeballed: every
  text colour clears 4.5:1 against its background (WCAG AA), the body text
  10.5:1 by day and 10.7:1 by night, and the night inks 7:1 or more. On
  light paper, pastel inks would be illegible, so by day the pastel is the
  page.
- **Switching.** `theme clock`, started by xprofile, applies day from 07:00
  and night from 19:00, checking every 5 minutes so a suspended laptop
  catches up after waking. Super+F8 (`theme toggle`) flips it by hand until
  the next boundary. New terminals take the palette from X resources; open
  ones are recoloured in place with OSC escape sequences sent to your
  ttys. Tested: the palette merges, each of your pseudo-terminals gets the
  sequences once, the console none.
- **Codex and nvim.** Both draw with the terminal's 16 colours (nvim runs
  `notermguicolors` with the plain `vim` scheme), so they follow the
  palette. Codex asks the terminal for its background when it starts; a
  session already running keeps the old guess until you restart it.
- **Font.** IBM Plex Mono everywhere (the ibm-plex package): terminals,
  cwm menus, dmenu and dunst through fontconfig; Plex Sans and Serif for
  the rest. IBM's own family, drawn for legibility (slashed zero, distinct
  l 1 I). Noto Color Emoji fills in the emoji.
- **Frames: fvwm's.** OpenBSD's fvwm (xenocara system.fvwmrc) draws 7-pixel
  frames in dark red and blue with grey menus. cwm does the same: 7 pixels,
  the focused window dark red (#8b0000), the others a softened fvwm blue
  (#4a64b0), menus grey (#bebebe) with dark red selection. fvwm itself
  colours the focused window blue and the rest red; this is the other way
  round, by choice. The frames stay the same in day and night.
- **Notifications.** dunst in Plex Mono, slate with pastel text, framed in
  the window-border colours.

## X220 details

Sources read for this section: xenocara's xserver `config/wscons.c` and
xf86-input-ws, and OpenBSD's pms.c, wsmouse.c, wstpad.c, acpithinkpad.c,
acpibtn.c, amd64 machdep.c, apmd.c, wsconsctl and wsfont (GitHub mirror of
src). "From memory" marks what was not read.

- **Two pointers, two X devices.** pms(4) attaches the Synaptics touchpad
  as one wsmouse and the TrackPoint behind it (its pass-through port) as a
  second. At start X opens each touchpad by its own node, as a device named
  `/dev/wsmouse0`, and all other mice through the mux, `/dev/wsmouse`.
  Opening a wsmouse directly takes it out of the mux, so the TrackPoint is
  the mux device and no xorg.conf.d file is needed. `check` prints the
  pms/wsmouse boot lines and the X devices, to confirm which is which.
- **Touchpad off, TrackPoint on.** `touchpad on|off|toggle` runs
  `xinput enable/disable` on the numbered device; Super+F11 toggles
  (F11 was voidrice's webcam key, unbound here). In xprofile,
  `touchpad_at_login=off` starts every session with it off; the default
  is on. xinput is in base X.
- **TrackPoint scrolling.** `remaps` (run at login, again by Super+F12)
  turns on the ws driver's wheel emulation on `/dev/wsmouse`: hold the
  middle button and push the stick, both axes. A middle press shorter than
  200 ms is still a click, so paste works.
- **Touchpad below X.** `wsconsctl mouse.tp.tapping=1` turns on tapping (one,
  two, three fingers for left, right, middle); it stays off unless set.
  `mouse.tp.disable=1` stops all touchpad output except clicks in a top
  button area; it acts in the kernel, so in X too. `mouse` is wsmouse0,
  `mouse1` wsmouse1; the check shows which is the touchpad. Put the lines in
  `/etc/wsconsctl.conf` to keep them.
- **Fn keys.** acpithinkpad handles, below X: brightness up/down, volume
  up/down/mute, mic mute, Fn+F5 (Bluetooth), Fn+F4 (suspend) and Fn+F12
  (hibernate). The ThinkVantage button is not in its list, so it does
  nothing; `xev` would show whether it reaches X at all. The ThinkLight is
  hardware.
- **Backlight.** `wsconsctl display.brightness` is the main path (the
  battery block uses it). xbacklight is in base X as a fallback; whether
  the X220's inteldrm gives X a backlight property is not checked.
- **Lid.** `machdep.lidaction`: 1 suspends (the default), 2 hibernates,
  0 does nothing. The X220 needs no setting. Closing the lid does not lock
  the screen; `/etc/apm/suspend`, which apmd runs before sleeping, is the
  place for that (not done; from memory).
- **Battery, for the installer.** apmd `-z percent` suspends when on
  battery and the charge falls below that percentage; `-Z percent`
  hibernates instead (needs swap at least the size of RAM; from memory).
  apmd checks at each power-change event and waits a short grace period
  after a resume. Suggested: `rcctl set apmd flags -z 5`, with no `-A`,
  `-L` or `-H`.
- **CPU block.** `sb-cpu` shows temperature and `hw.cpuspeed` together,
  "52°C 1.2GHz", and either one alone when the other is missing.
- **Console.** Key repeat: `wsconsctl keyboard.repeat.del1=300` (delay
  before the first repeat, ms) and `keyboard.repeat.deln=20` (between
  repeats, ms; about X's rate of 50). Blanking: `display.screen_off` is the
  delay in ms before an idle console goes dark (default 10 minutes, from
  memory). Font: Spleen is the kernel's own console font, 8x16 to 32x64 all
  built in on amd64; on the X220's 1366 px screen the kernel picks the
  12 px wide one. `wsconsctl display.font="Spleen 8x16"` gives a denser
  console (from memory that it takes the font's full name). wsfontload(8) is
  only needed for a font file not in the kernel. All of these go in
  `/etc/wsconsctl.conf`.

## Installing on the X220

System side (root, typed by the owner):

- Packages: `doas pkg_add -l ~/.local/share/openbsd/pkglist`. Names are
  from memory, not checked against the current ports tree; `check`
  reports any that did not install.
- `rcctl enable apmd && rcctl start apmd` for zzz/ZZZ and battery data,
  with no speed flags: `-A`, `-L` and `-H` set the CPU speed policy, which
  is obsdfreqd's job here, and the two would fight. The low-battery flag
  `-z` is wanted (see "X220 details"). apmd makes its socket 0660
  root:wheel (apmd.c), so a user in wheel may run `zzz`.
- CPU speed, obsdfreqd (package), throttled hard on battery:

      rcctl enable obsdfreqd
      rcctl set obsdfreqd flags -m 100,50 -r 50,90 -T 85,65
      rcctl start obsdfreqd

  Each flag takes `on AC,on battery`. `-m` caps the speed in percent (full
  on AC, half on battery). `-r` is the CPU use that makes it step up: 50%
  on AC for a quick response, 90% on battery so only sustained load raises
  the clock. `-T` is a temperature ceiling in °C: past it, the cap drops
  each cycle until the CPU cools (85 on AC, 65 on battery, which also keeps
  the X220's fan quiet). Flag letters are from obsdfreqd's documentation
  as quoted in search results; `man obsdfreqd` on the machine is the
  authority.
- `rcctl enable messagebus && rcctl start messagebus` (the system D-Bus
  from the dbus package; see its readme in /usr/local/share/doc/pkg-readmes
  for the machine-id step).
- doas: `install -o root -g wheel -m 0640 ~/.local/share/openbsd/doas.conf
  /etc/doas.conf`, then `doas -C /etc/doas.conf` to check it.
- Root's shell: `install -o root -g wheel -m 0644
  ~/.local/share/openbsd/root.kshrc /root/.kshrc`, and add
  `export ENV=/root/.kshrc` to /root/.profile (for console logins as root;
  `doas -s` gets it from the doas rule).
- USB notices: `install -o root -g wheel -m 0755
  ~/.local/share/openbsd/hotplug-attach /etc/hotplug/attach`, then
  `rcctl enable hotplugd && rcctl start hotplugd`.
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
- Removed: dmenumountcifs (avahi, CIFS), dmenupass (sudo askpass), remapd
  (udev), the pacman update blocks and cron job. mounter and unmounter
  were rewritten for OpenBSD; the Linux versions' LUKS and Android (MTP)
  support did not come over.
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
- xidle may also lock when the pointer rests in a screen corner (from memory
  of its defaults). If that happens, its corner flags in xidle(1) turn it off.

## Open

- What this fork becomes, and whether a Mac port follows.
