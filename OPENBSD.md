# vertrice: voidrice on OpenBSD

[README.md](README.md) says what vertrice is, the base-first rule, and the
short install. This file is the detail. Upstream voidrice targets Arch and
Void Linux; "The walk" below names each Linux mechanism and the OpenBSD one
that replaced it.

**The default session.** ksh, cwm and xterm, all from base. voidrice's
tiling keys are carried into cwm (see "Keys" below). Luke's dwm and st are
opt-ins: build them into `~/.local/src`, then set `WM="dwm"` and
`TERMINAL="st"` in `.config/shell/profile`. What each package is for, and
why base does not cover it, is under "Packages".

**Which OpenBSD.** vertrice tracks the latest OpenBSD release, or
-current (snapshots); it is not pinned to a version. (As written, in late
2026, the X220 install is expected to land about when 8.0 is released.)
- On a release: `syspatch` for base errata, `pkg_add -u` for packages, and
  `sysupgrade` to move to the next release when it ships.
- On -current: `sysupgrade -s` then `pkg_add -u`; snapshots get no syspatch.
- From -current to a release: once a release ships, snapshots move on to
  the next -current, and going back is a downgrade OpenBSD does not
  support. So upgrade to the release as soon as it is out (while the
  snapshot still carries its number), or reinstall (from memory; check
  that release's upgrade guide).
Take a level 0 `bk full` before any upgrade.

**State.** Written and tested off the machine: every shell file parses under
oksh (the portable OpenBSD ksh), the status blocks run against mocked
OpenBSD command output under BWK awk (OpenBSD's awk), and getbib's rewrite
matches the old output, and vertrice-install ran its dry run, apply and
re-apply against mocked rcctl, pkg_add, doas, sysctl, usermod and
cap_mkdb under a fake root. Nothing has run on OpenBSD yet.
`~/.local/share/openbsd/check` tests on the machine each assumption that
could not be tested here.

**Tests.** `~/.local/share/vertrice/tests/run` is the regression suite: run
it after every change. It runs the scripts from this tree against fake
OpenBSD commands (`tests/mock`: apm, sysctl, disklabel, doas, dmenu and
the rest), whose fixtures follow the formats the scripts assume; each mock
says which formats are known and which are assumed. One line per case
(PASS, FAIL, SKIP, or XFAIL for a known bug, named in the case), a total,
and a nonzero exit on failure. `run ext` runs the cases whose names start
with `ext`; `-k` keeps the scratch directories. On the X220 it needs
nothing extra. On Linux, set `OKSH` to oksh and `BWK_AWK` to the one true
awk (`CWM` and `CWM_SRC` add the cwmrc checks). `run --live`, on OpenBSD
only, skips the mocks and prints what each status block shows on the
machine; it changes nothing.

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
    `~/.cache`. linkhandler, dmenuhandler and noisereduce, which wrote
    fixed names in /tmp, now write into a new `mktemp -d` directory.

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
| Shift+F1 | (none) | `manpick`: any manual page, picked in dmenu, opened with man in a terminal |
| Shift+F2 | (free) | `writemode`: full-screen writing terminal (see "Writing") |
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

## Writing

The X220 as a plain-text writing machine. The owner's rule for this part:
"Unixisms like writers work bench and similar are fine to install, but we
want to conform to OpenBSD base where possible, and believe in that
workflow approach." So each check is a small command that reads a file and
prints what it found, as `FILE:LINE: text`, and the checks compose.

- **The writing directory** is `$WRITING_DIR`, set in the profile to
  `~/writing`. Files there are `.md` or `.txt`.
- **Super+Shift+F2** runs `writemode`: an xterm named "write", full screen
  (xterm's `-fullscreen`; cwm honours it when it maps the window), in the
  writing directory, with nvim in Goyo on the file you changed last (or
  on the file named: `writemode FILE`). With no writing file yet it opens
  the directory. Without nvim it opens base vi. Checked under Xvfb with cwm
  built from source and xterm 390: the window maps at full screen, named
  "write". Not yet on the machine.
- **nvim prose settings.** For `.md` and `.txt` under the writing
  directory, init.vim sets `wrap linebreak nonumber norelativenumber
  textwidth=0 nospell`: a paragraph is one line, wrapped at word ends on
  screen, and nvim inserts no line breaks. `,f` toggles Goyo, `,o` spelling.
  Checked with nvim 0.11: the settings apply there and nowhere else.
- **`sb-words`**: the word count (wc -w) of the writing file changed last,
  as `📝1234`. It is in sbar's list, so Super+b shows it under cwm. wc
  counts Markdown marks such as `#` as words.
- **`proof [FILE]`** runs the checks below on FILE, or on the writing file
  changed last, one after another, in `$PAGER`. From vi or nvim:
  `:!proof %`.

### The checks

- **`spellcheck [-b] FILE`**: base spell(1), with each flagged word shown
  in its line (`chapter1.md:12: She [recieved] the letter.`). `-b` is
  British spelling. `spellcheck -a WORD ...` adds names and coinages to
  your own list, `~/.local/share/spell/words`.
- **`dupwords FILE`**: doubled words ("the the"), also across line ends,
  which spell cannot see. A few lines of awk.
- **`diction -s FILE`** (wordy and misused phrases, with a suggestion) and
  **`style FILE`** (readability grades, sentence lengths, passive
  sentences) come from the diction package. The Unix Writer's Workbench
  from Bell Labs had both; GNU diction is a free reimplementation of the
  two. They are text filters in exactly the base-tool pattern, and base
  has nothing like them, so the package is argued in: it is in `pkglist`
  (textproc/diction; flags checked against diction 1.14, the port is
  1.11). style's passive-voice count is crude: in a three-sentence test
  it counted all three as passive, where one was.

### Spelling: base spell, and why no aspell or hunspell

What base has, read from OpenBSD's source (usr.bin/spell, share/dict):
`spell` is a ksh script. It runs deroff(1) to split the text into words,
then `/usr/libexec/spellprog` looks each word up, stripping common
prefixes and suffixes, in `/usr/share/dict/words`. That list is
Webster's Second International (1934), 234,936 words, with `american`,
`british` and a `stop` list of false derivations beside it. It prints the
words it cannot find, one per line, sorted, with no place and no
suggestion. It is not interactive. `+list` adds a word list of your own.

What it does to fiction, tested by building spellprog and deroff from
that source and running them with the real word lists:

- Contractions: `can't`, `won't`, `isn't`, `I'm`, `I've`, `she'd`, and
  capitalised `Don't`, are all flagged (the list has no apostrophes).
  Dialogue would drown in them, so spellcheck always adds
  `~/.local/share/spell/contractions`, 63 of them.
- Modern words: `email` and `okay` are flagged. `spellcheck -a` fixes
  each once.
- Word lists must be sorted with `sort -f`. spell(1) says `sort -df`, but
  spellprog's lookup folds case and nothing else, and `-d` sorts `I've`
  where the lookup never finds it. `spellcheck -a` sorts with `-f`.
- deroff takes ASCII letters and apostrophes only: `café` is checked as
  `caf`. spellcheck turns a curly apostrophe into a straight one first,
  so `don’t` stays one word.

For spelling while typing, nvim needs nothing more: the neovim package
ships its English list, `en.utf-8.spl` (in the port's packing list,
ports -current). Nothing is downloaded. Checked with nvim 0.11's own
list: it flags `recieved`, knows `email`, and marks `colour` as a
regional spelling. `,o` turns it on with `spelllang=en_us`; for British,
`:setlocal spell spelllang=en_gb`.

So base spell does the batch check over a finished file, and nvim's list
does the interactive one. aspell or hunspell would add a third dictionary
system for a job already covered twice. They stay out.

### Writing in base vi

vi (nvi) has no soft wrap at word ends: a long line folds at the screen
edge, mid-word. For prose in vi, break lines as you type:

    :set wraplen=72 noautoindent

`wraplen` breaks the line at a word end once it passes column 72;
`noautoindent` stops a new line from copying the last one's indent (the
exrc turns autoindent on, for code). `!}fmt -w 72` rewraps the paragraph
under the cursor with base fmt(1). `:!spellcheck %` and `:!proof %` run
the checks on the file. The option names were checked in nvi's source and
accepted by nvi 1.81. A file written this way has line breaks inside
paragraphs; Markdown joins them, and nvim shows them as they are.

vi counts bytes, not characters: from its source (key.c), a byte that is
not printable in its character set shows as an escape such as `\xe2`.
So curly quotes and dashes typed in nvim show as escapes in vi (not yet
seen on the machine).

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
  iso. Base tar, gzip and compress do most of it; bzip2, xz, zstd and
  unzip are in pkglist, 7zip (7z, rar, iso) in pkglist.extra. Single compressed files are decompressed next
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
offered are accepted, in both questions, and in unmounter. The drive's
label and a phone's name are text the device supplies: control characters
and backslashes are removed, so they cannot add a line to the menu. Tested end to end against mocked disklabel, mount,
bioctl and doas: plain FAT, encrypted unlock-and-mount, unmount-and-lock,
and refusing typed input. Not yet on the machine.

## Backups

**dump(8) and restore(8) are the backup.** `bk full` and `bk incr` dump the
/home filesystem, full and incremental, to an encrypted USB disk; restore
gets one file back (`restore -i`) or the whole filesystem (`restore -r`).
There is no second backup path: `restore -i` already gets single files
back, and a tool kept for its own sake is one more thing to maintain.

Sources read: dump.8, restore.8, restore's tape.c and restore.c, and
openrsync's rsync.1, main.c and fargs.c (GitHub mirror of src, September
2026). "From memory" marks what was not read.

### Why dump, and not something else

The rule here is base first; a package needs a reason base cannot meet.

- **dump** is OpenBSD's own backup for FFS, the filesystem /home is on. It
  reads the filesystem, not files, so a dump keeps everything FFS keeps:
  owners, modes, flags, hard links, sparse files, special files. Levels give
  incrementals for free: level N saves what changed since the newest dump of
  a lower level, and `dump -u` records each dump in /etc/dumpdates, which is
  how the next run knows the date. restore reads it back: `restore -i` is a
  small shell for picking files, `restore -r` rebuilds a whole filesystem
  from a full plus its incrementals.
- **openrsync** copies files. It keeps no history: the next run overwrites
  yesterday's copy, so a file damaged today is damaged in the copy too.
  The usual rsync way to keep history, `--link-dest` (unchanged files as hard
  links to the previous copy), is in openrsync's source but inside `#if 0`,
  so it is not built, and rsync.1 does not list it. It has no `-H`, so hard
  links are copied as separate files.
- **tar** can archive /home, but it has no incremental mode of its own
  (from memory: OpenBSD's tar has no `--listed-incremental`); rebuilding one
  from `find -newer` would be writing dump again, worse.
- **Packages** (borg, restic) add deduplication and their own encryption.
  The encryption is already softraid's, below the filesystem, and
  deduplication matters for many snapshots on a network store, not for a
  USB disk with a few gzipped dumps. Not a strong enough reason to leave
  base.

What dump cannot do:

- **No snapshot.** OpenBSD's FFS has no filesystem snapshots, so dump reads
  /home while it is in use. A file written during the dump may be caught
  half written, and restore.8 warns that incremental restores "can get
  confused" by dumps of active filesystems. For a copy that is certainly
  consistent, run it with the session quiet: close the browser, mail and
  anything else writing to /home, and leave the machine alone until it is
  done. The console with no X session running is quieter still.
- **One whole filesystem.** It backs up all of /home, not chosen
  directories. To leave something out (caches, downloads), mark it with
  `chflags nodump DIR`; incrementals skip it, but a full dump still takes it
  (dump's `-h` default is level 1; bk does not change it).
- **Not browsable.** The files are dump images; you need restore to see
  inside (`restore -i`, below).
- **dumpdates records the dump, not the file.** If dump finishes but gzip
  or the disk then fails, /etc/dumpdates already says the dump happened and
  the next incremental starts from it. bk removes the broken file and says
  so; after a failed full, run `bk full` again before the next `bk incr`.

### The backup disk, once

A USB disk with softraid CRYPTO on it and an FFS filesystem inside. Commands
from memory of the OpenBSD FAQ's softraid page; `disklabel -E` is
interactive (`a a`, accept the defaults, set the type, `w`, `q`). With the
disk plugged in as sd2 (`sysctl hw.disknames` shows the names):

    doas fdisk -iy sd2                     # one OpenBSD partition, whole disk
    doas disklabel -E sd2                  # a: whole disk, fstype RAID
    doas bioctl -c C -l sd2a softraid0     # set the passphrase; attaches as sd3
    doas dd if=/dev/zero of=/dev/rsd3c bs=1m count=1
    doas fdisk -iy sd3
    doas disklabel -E sd3                  # a: whole disk, fstype 4.2BSD
    doas newfs sd3a
    sysctl hw.disknames                    # sd3:DUID, the volume's DUID
    doas mkdir /mnt/backup

Then one line in /etc/fstab, by the DUID of the unlocked volume (sd3), not
of the USB disk (sd2):

    0123456789abcdef.a /mnt/backup ffs rw,noauto,nodev,nosuid 0 0

`noauto`: the disk is often absent, so boot must not wait for it. mounter
tries `mount DUID.a` first, so after unlocking it lands at /mnt/backup
every time. Once, while mounted: `doas chown YOU /mnt/backup`, so the dump
files are written as you.

### Using it

Plug the disk in, Super+F9, pick the 🔒 line, type the passphrase. Then, in
a terminal or from dmenu:

- `bk full`: level 0, all of /home. Monthly, and always **before a
  sysupgrade**, including the move from snapshots to the 8.0 release: an
  upgrade that goes wrong then costs nothing but time.
- `bk incr`: level 1, everything changed since the last full. Weekly or
  more. Each level 1 replaces the one before for restoring, so a restore
  needs only the newest full and the newest level 1.
- `bk restore-test`: reads the newest full with `restore -t` and checks
  that the files in `~/.config/bk/keyfiles` (one per line, relative to your
  home; default `.profile`) are in it, then reads the newest incremental
  through. Writes nothing but restore's scratch files, in a temporary
  directory it removes.
- `bk status`: how old the newest full and incremental are.

Super+F10 unmounts the disk and locks it again. Only dump runs as root
(it reads the raw disk); from a key, bk reopens in a small terminal for
doas, as mounter does. It refuses to run when /mnt/backup is not a mount
point, so a backup never fills the laptop's own disk. Files are
`HOST-YYYYmmdd-HHMM-lN.dump.gz`, mode 600, in /mnt/backup/dump; delete old
ones by hand, and keep the previous full until the new one passes
`bk restore-test`. `BK_DIR` and `BK_FS` change the disk and the filesystem.

**Reminder.** xprofile runs `bk remind` at login: a notification when the
newest dump, full or incremental, is older than `BK_DAYS` (7) days, or when
there is none. It reads one small file per kind in `~/.local/state/bk`,
written after each good run, so it works with the disk unplugged; no daemon,
no cron. Base's own view is `dump -W`, which reads /etc/dumpdates and the
dump-frequency field of /etc/fstab; bk keeps its own record because it
knows the file reached the disk, and because `-W` does not list a
filesystem that was never dumped (dump.8, BUGS). Whether `dump -W` runs
without root: not checked.

### Restoring

One file or directory, into an empty directory, never over the live one:

    mkdir ~/restored && cd ~/restored
    gzip -dc /mnt/backup/dump/x220-...-l0.dump.gz | restore -if -
    restore > cd YOU/Documents
    restore > add report.odt
    restore > extract           # "set owner/mode for '.'?" answer n
    restore > quit

restore reads the dump from the pipe and your commands from the terminal
(tape.c opens /dev/tty when the input is `-`). If the file changed after
the full, do the same with the newest incremental. Then move the file where
it belongs.

All of /home, onto a new disk or after a failure, as root, on a freshly
made filesystem:

    newfs sd1k && mount /dev/sd1k /home && cd /home
    gzip -dc /mnt/backup/dump/x220-...-l0.dump.gz | restore -rf -
    gzip -dc /mnt/backup/dump/x220-...-l1.dump.gz | restore -rf -
    rm restoresymtable

restore leaves `restoresymtable` to carry state between the full and the
incremental; remove it after the last one. Then run `bk full` at once:
restore cannot keep the old inode numbers, so later incrementals need a new
level 0 (restore.8, BUGS).

**Tested** against mocked mount, doas, dump and restore, with real gzip:
full and incremental files, names and modes, refusal with the disk
unmounted, a failed dump leaving no file and no record, the terminal
reopen, restore-test finding a missing key file and a broken incremental, the
reminder's threshold, status. Not yet on the machine: dump and restore
themselves, and the disk setup.

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

### The download queue: qndl on nq

voidrice queued downloads with task-spooler (`tsp`), which has no OpenBSD
port. vertrice queues them with nq(1), from the nq package (pkglist.extra):
a queue made of plain files, one per job, with no daemon.

- **Same use as voidrice.** `qndl URL [COMMAND]` queues a download; the
  command defaults to yt-dlp, and the URL is added as its last word. Jobs
  run one at a time, in order, in the directory qndl was started from.
  When one ends you get "👍 NAME done.", or "❌ NAME failed.", which
  voidrice did not send. A plain file loses its `?source=` tail and its
  `%20`s, as before.
- **Who queues.** newsboat's `t` (yt-dlp) and `a` (audio) macros,
  dmenuhandler's three "queue" entries, linkhandler's audio links, and
  `queueandnotify`, which podentr runs when newsboat's podcast queue
  changes. Plain files are fetched with base ftp(1).
- **Where the queue lives.** `~/.cache/qndl`, mode 700, because the job
  files hold the URLs. Each job is a file `,TIMESTAMP.PID` with the command
  and its output. `NQDIR=~/.cache/qndl fq` follows the running job. A job
  that succeeds removes its file; a failed one stays for `fq -a`.
- **The count.** `sb-tasks` shows 🤖2(1): two jobs not done, one of them
  waiting. A job file whose PID is alive is not done, and nq sets its
  execute bit while it runs (read in nq's source, v0.5). sb-tasks is not
  in sbar's list of blocks; add it there to see the count.
- **Notices from the queue.** nq starts each job with the environment of
  the qndl that queued it and adds only NQJOBID, so notify-send finds the
  session bus and reaches dunst (read in nq.c).
- **Limits.** Queued jobs do not survive a reboot: nq keeps the order in
  file locks. A PID reused by another process after a failed job would
  count that job again until the file is removed.

### WiFi: base does the daily work, dmenuwifi picks new networks

voidrice's network block opened NetworkManager's nmtui on a click.
NetworkManager is not on OpenBSD, and base covers most of its job:
ifconfig(8) joins a network (`ifconfig iwn0 join NAME wpakey KEY`), and
each `join` line in `/etc/hostname.iwn0` adds a network to the join list,
from which the kernel picks a known one in range (hostname.if(5)).

`dmenuwifi` is the one piece of nmtui kept: pick a new network from a
menu. It runs the way mounter does:

- It opens a small floating terminal, because scanning and joining need
  root (ifconfig says "no permission to scan" otherwise), and asks for
  your doas password once.
- `ifconfig iwn0 scan` lists the networks; dmenu shows each name once,
  strongest first, with 🔒 (a key) or 🔓 (open) and the signal. The
  interface is the first one in the `wlan` group; if it is down,
  dmenuwifi brings it up and scans again.
- For a secured network you type the key in the terminal, hidden. The
  packaged dmenu (5.4) has no password mode: `-P` is a patch the port does
  not apply (read in the ports tree).
- `doas ifconfig iwn0 join NAME wpakey KEY` joins it (`nwkey` for WEP).
  You get an address if `/etc/hostname.iwn0` has `inet autoconf`.
- dmenu then asks "Add NAME to /etc/hostname.iwn0?". Only a Yes appends
  the join line (with `doas tee -a`, so the key goes through a pipe).

The key on a command line: ifconfig takes the key only as an argument, so
it is in the argument list of doas and of ifconfig while they run, where
`ps` can show it to other users of the machine (from memory: OpenBSD's ps
shows every user's arguments). dmenuwifi runs `doas true` first, so doas
does not wait at its password prompt with the key in its arguments; the
join itself lasts a moment. hostname.iwn0 (mode 640, root:wheel) keeps the
key in the clear, as every join line there does.

Network names come from the air, so dmenuwifi treats them as untrusted.
ifconfig prints a name with bytes outside printable ASCII as hex (`0x...`)
and quotes a name with spaces (print_string in ifconfig.c); dmenuwifi drops
scan lines with control characters, joins a hex name as hex, takes only a
line it offered, and passes the name as one argument. netstart(8) runs
each hostname.if line through `eval`, as root, at boot (read in
etc/netstart), so dmenuwifi writes a join line only when the name and key
contain no `"`, `$`, `` ` ``, `\` and no double space. Otherwise it says so,
and you add the line by hand. A name in UTF-8 (an accent, an emoji) shows
as hex. Not handled: hidden networks (type the join by hand) and WPA
Enterprise (802.1X needs wpa_supplicant).

How to start it: sb-internet's click runs it (middle click shows the
current network), but sbar's blocks take no clicks yet, so for now type
`dmenuwifi` in the Super+d menu or a terminal. No key: voidrice had none
for this, and no free key reads naturally as "network".

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
- **dunst and zathura follow the palette.** See "Two ways to colour" below.

### Two ways to colour: theme (default) or pywal (opt-in)

voidrice took its colours from the wallpaper with pywal, and pywal's
templates coloured dunst and zathura. vertrice keeps both ways. The fixed
palettes are the default; pywal is a switch you turn on.

**theme, the default.** The palette files in `.config/x11/themes` are the
only source of colour. Each switch (clock, Super+F8, `theme day|night`)
changes:

- X resources and the open terminals (as above);
- dunst: `~/.config/dunst/dunstrc.d/theme.conf` gets the background and
  text colours; low urgency takes the dim grey (color8, 4.7:1 in both
  palettes). dunst reads that file after dunstrc (drop-ins, read in dunst's
  settings.c, 1.13.2), and a running dunst reloads with `dunstctl reload`.
  Frames, size and font stay in dunstrc;
- zathura: `~/.config/zathura/theme` gets page, bar, search and recolour
  (`i`) colours. zathurarc ends with `include theme`; a running zathura
  rereads its config over D-Bus (SourceConfig, read in zathura 0.5.14's
  source; not yet seen on the machine);
- the root window, when xwallpaper is not installed: it now follows the
  switch (before, only setbg set it, so it kept the old colour).

The two generated files are not in the repository. Until the first switch
dunst uses dunstrc's own colours (the night palette), and zathura logs a
warning and keeps its defaults.

**pywal, opt-in.** pywal has no OpenBSD package. It installs with pip; the
system Python refuses `pip install --user` (it is marked
EXTERNALLY-MANAGED and points to pipx), so use pipx:

	doas pkg_add py3-pipx ImageMagick
	pipx install pywal	# wal lands in ~/.local/bin (pipx default)

ImageMagick's `convert` is what pywal's default backend calls. Then add
`export PALETTE=wal` to `~/.config/shell/profile` and log in again. The
package names and the EXTERNALLY-MANAGED text were read in the ports
tree; the pipx steps are from memory, not run on the machine.

With `PALETTE=wal` and `wal` on your PATH, `setbg` runs
`wal -n -i WALLPAPER -o ~/.config/wal/postrun`. wal fills in the templates
in `~/.config/wal/templates` into `~/.cache/wal`, and postrun (now sh, not
bash) runs `theme wal`, which applies them the same way as a palette:
`palette` is a palette file in theme's format; `dunstrc` and `zathurarc`
are Luke's colour choices, now only the colours, copied to the two files
above. pywal itself would recolour terminals by writing to `/dev/pts/*`,
which OpenBSD does not have, so theme does it. With `PALETTE=wal`,
`theme clock` does nothing, so 07:00 and 19:00 leave the wallpaper's
colours alone; Super+F8 still switches to day or night by hand, until the
next setbg. Without the switch, or without wal, setbg does what it did.

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
  0 does nothing. The X220 needs no setting. The system stage installs
  `.local/share/openbsd/apm-suspend` as `/etc/apm/suspend` and
  `/etc/apm/hibernate`: apmd runs them as root before sleeping, and they
  send xidle SIGUSR1, which makes it start xlock (checked in xidle's
  source). Root sends a signal and nothing more. Whether a lid close
  reaches apmd's hook, and not only zzz and Fn+F4, is for a lid test on
  the machine: close it, open it, and the screen should be locked.
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
  memory). The system stage writes both repeat lines, with Caps Lock as
  Escape, to `/etc/wsconsctl.conf`. Font: Spleen is the kernel's own console font, 8x16 to 32x64 all
  built in on amd64; on the X220's 1366 px screen the kernel picks the
  12 px wide one. `wsconsctl display.font="Spleen 8x16"` gives a denser
  console (from memory that it takes the font's full name). wsfontload(8) is
  only needed for a font file not in the kernel. All of these go in
  `/etc/wsconsctl.conf`.

## Codex, in a box

Codex is OpenAI's coding agent (the `codex` package, 0.157.0 in ports).
`cdxb` runs it in a box: from your own terminal, as you, with low
friction, but able to reach only the files you choose.

### What a sandbox is

A program you start can do anything you can: read every file in your
home, change it, delete it. A coding agent runs many programs on its own
judgement, and a web page or a file it reads can steer that judgement. A
sandbox is a wall around the program, so that a mistake or a trick costs
only what is inside the wall. There are two kinds of wall on this system:

- **The view wall: unveil(2).** The program is given a list of paths,
  each with what it may do there: read, write, run, create or remove.
  Everything else looks as if it did not exist. The kernel enforces the
  list for the program and for every program it starts. Once set, the list
  is locked: no one can widen it for a running program, not even you. So
  giving Codex a new path means restarting it, and cdxb resumes the same
  conversation (below).
- **The user wall: file permissions.** Each file belongs to a user. A
  program running as another user can touch only what that user may, and
  cannot kill or trace your programs. It is stronger, but that user needs
  its own files, group and login. It is not built here (see "A stronger
  mode" below).

What neither wall does: stop the program from using the network, or from
sending out what it can read. A wall limits what it can reach, not what it
does with it. Keep secrets out of the box, and grant paths, not your home.

### Everyday use

    cdxb                          Codex in this directory
    cdxb ~/src/site               Codex in another directory
    cdxb -w ~/Documents/letters   also let it change your letters
    cdxb -r ~/Downloads/spec.pdf  also let it read one file
    cdxb -H                       your whole home, minus the deny list
    cdxb -d                       it may run your chosen doas rules
    cdxb -a                       Codex asks before every command
    cdxb -s                       a shell in the same box, to try the walls
    cdxb -n                       print the walls, run nothing
    cdxb add ~/notes              give the running session one more path
    cdxb review                   see and answer Codex's proposals
    cdxb ls                       list running sessions

### What is inside the box

- The directory you start in: read, change, create, run.
- The paths in `~/.config/cdxb/grants`, which every session gets
  (`rw PATH` or `r PATH`; the default is ~/src, ~/Documents and ~/notes to
  change, ~/Downloads to read), and the `-w`/`-r` paths.
- The system, to read and run: /bin, /sbin, /usr, /etc (certificates, DNS,
  time zone), the dynamic linker's hints file, /dev/null, /dev/tty, and
  /dev/ptm, which makes the pseudo-terminals Codex runs commands in.
- ~/.codex (Codex's settings, login and history), ~/.gitconfig to read,
  a private temporary directory as TMPDIR (the shared /tmp stays hidden:
  it holds the X server and ssh-agent sockets), and the proposal outbox.

Hidden, always: the paths in `~/.config/cdxb/deny` (keys, password store,
mail, browser profiles, shell history). A grant at or inside one is refused
with a message. `-H` does not lift it; `-X` does, for one session.

Read-only, always, whatever the flags: `~/.config/cdxb`, `~/.local/bin`
and `~/.local/src` (cdxb itself), `~/.local/share/openbsd` (the doas
rules), `~/.codex/config.toml` and `AGENTS.md`, and your startup files
(`.profile`, `.config/shell`, `.config/ksh`, `.config/x11`, `.xsession`,
`.xprofile`). The reason: code you run later outside the box must not be
writable from inside it. To work on your dotfiles with Codex, use a clone
(for example in ~/src), not the live copy.

No X display and no ssh-agent: cdxb clears DISPLAY and SSH_AUTH_SOCK, and
their sockets are hidden. A program on your X display can read every key
you type, and one with your ssh-agent can log in where you can.

### How it works

`codex-box` (`~/.local/src/codex-box`, about 220 lines of C and as many
of comments, built with base cc and make the first time you run cdxb)
calls unveil(2) once per
path, locks the list, and then calls exec to become Codex. The catch is in
that last step: exec normally throws the unveil list away, so the new
program would see everything. The kernel keeps the list only when the
process has *execpromises*, the second argument of pledge(2)
(sys/kern/kern_exec.c: with `PS_EXECPLEDGE` the list stays, otherwise
`unveil_destroy()`). fork(2) copies both to children, so every command
Codex runs is in the same box. codex-box therefore sets wide execpromises,
chosen to carry the box, not to restrict Codex: file access, network, and
starting programs are all allowed; the files are what the unveil list
decides. The `error` promise makes a forbidden call fail instead of
killing the program.

What the pledge still forbids: tracing your other programs, and running
setuid programs. The kernel refuses a setuid program to a process with
execpromises, so doas and su cannot run in the box. That is why `-d`
needs a relay (below).

Side effect of the lock: diff(1) and patch(1) from base call unveil
themselves, get refused, and stop. In the box, use `git diff --no-index`;
Codex edits files with its own patch tool.

### Adding a path to a running session

The view of a running program cannot be widened, so `cdxb add PATH`
(`add -r` for read-only) records the path in the session's grant list,
under ~/.cache/cdxb, and asks you to type `/quit` in Codex. cdxb then
starts Codex again with the old paths plus the new one and runs
`codex resume --last`, which continues the most recent conversation in
that directory. Run `add` from another terminal, or after quitting. Codex
cannot run it for itself: ~/.cache/cdxb is hidden in the box.

For one file there is a shortcut: a hard link, `ln ~/taxes/form.pdf .`,
gives the file a second name inside the project, and the box sees it
there. Files only, on the same file system. An editor that saves by
writing a new file and renaming it breaks the link, so changes can land
on one name only. A symbolic link does not work: unveil checks where the
link points, and that is outside the box.

### Proposals: Codex asks, you affirm

Codex cannot change the box's own settings, but it can propose: it writes
a full new version of the grants file, the deny list, `config.toml`,
`AGENTS.md` or the doas rules into the outbox (~/.cache/cdxb/proposals),
with a one-line reason. At every start and restart, after `cdxb add`, at
the end of a session, and with `cdxb review`, cdxb shows the reason and a
`diff -u` and asks `Apply it? [y/N]`. Only a typed `y` applies it;
anything else discards it. With no terminal, nothing is applied. Links,
directories and files with control characters are rejected unread (a
link could point at a secret; control characters could hide lines from
the diff). cdxb reviews a private copy, so what you see is what is
applied. Every decision goes to ~/.cache/cdxb/log. A proposal for the
doas rules is checked with `doas -C` and installed with doas, which asks
for your password: a second affirm.

### Root commands: copy, or a short allowlist

Inside the box doas cannot run. Two ways around it:

1. **Copy and run it yourself.** Codex prints the command; `/copy` copies
   its last answer. In the box Codex cannot reach X, so it sends the text
   with the OSC 52 escape sequence, and xterm puts it on the clipboard.
   xresources allows programs to *set* the clipboard that way (it is off
   by default) but not to *read* it: reading would let any program, or any
   file you cat, see your last copied password. Paste with Shift+Insert
   or the middle button (`selectToClipboard` is on). st: recent versions
   accept OSC 52 only when `allowwindowops` is set in config.h (from
   memory, not checked).
2. **A short allowlist, `cdxb -d`.** `~/.local/share/openbsd/doas-agent.conf`
   holds `permit nopass` rules with exact commands and arguments; it is
   empty by default. /etc/doas.conf is doas.conf followed by that file. In
   a `-d` session Codex runs `cdxb doas /usr/sbin/rcctl restart sndiod`;
   a relay outside the box (in codex-box, pledged and unveiled to its
   socket and doas) runs `doas -n` with those words. `-n` never asks for a
   password and fails for any rule without nopass, even when you typed
   your password a minute ago (doas.c checks -n before the persist
   ticket). doas cannot tell Codex from you, since both are your user:
   the nopass rules work for any program you run. Keep them few and exact,
   always with `args`.

### Codex's own settings

cdxb copies `~/.local/share/openbsd/codex/config.toml` and `AGENTS.md`
into ~/.codex on first use, if none are there. Codex has no sandbox of
its own on OpenBSD (issue #21977: its sandbox code knows macOS, Linux and
Windows), so the config lets it run ordinary commands without asking
(`approval_policy = "on-request"`, `sandbox_mode = "workspace-write"`);
the box is the wall. For a prompt before every command, `cdxb -a` marks
the project untrusted, which in 0.157 also skips the project's AGENTS.md.
cdxb always tells Codex whether the project is trusted, so Codex never
asks and never tries to write that answer into the read-only config.toml.
Keys were checked against Codex 0.157.0's source and config schema.
AGENTS.md tells Codex about the box, the proposals and OpenBSD habits.

### Limits

- The network is open. Whatever Codex can read, it can send.
- Codex's login token (~/.codex/auth.json) is inside the box: Codex needs
  it. Log in with `codex login --device-auth` (no browser redirect).
- Codex runs as you. It can kill your other programs (pledge "proc"
  allows it), but not trace them.
- It writes to your terminal. A program it leaves running after you quit
  could still write there, but not type into your shell: OpenBSD removed
  the TIOCSTI call that allowed that (it is gone from sys/kern/tty.c).
- The kernel keeps at most 128 unveiled paths per process.
- Not yet run on OpenBSD, so to test on the machine (`check` does most):
  that the promises are enough for Codex, git, cc and python; that
  /dev/ptm is all Codex's terminals need; how Codex behaves when it cannot
  write config.toml (for example after `/model`); and that the `-c
  projects=...` trust setting takes effect. If something fails in the
  box, try it in `cdxb -s`; with process accounting on (accton(8)),
  lastcomm(1) marks a program that unveil refused a file with U.

### A stronger mode (not built)

A separate `agent` user that Codex runs as (`doas -u agent`, with a
nopass rule only for becoming that less privileged user), sharing a
group-writable workspace with you. Grants then change at once, by group
permissions, without a restart, and pf(4) can limit its network by user.
The cost is two owners for every file in the workspace, a umask to agree
on, and its own login and token. Prefer it for long unattended runs, or
when limiting the network matters more than convenience.

## Installing on the X220

`~/.local/bin/vertrice-install` does the setup in two stages. Each stage
prints its plan first and changes nothing; add `-y` to apply it. Each
step looks at the current state first and is skipped when already done,
so running a stage again is safe and changes nothing. Every system file it
edits is first copied to `FILE.orig`, once.

**0. Get git.** A fresh OpenBSD has no git and no doas rule yet. As root
(`su -`, the root password from the install): `pkg_add git`, then `exit`.
Your user must be in group wheel; the installer puts the first user there.
wheel is also what lets you run `zzz`: apmd makes its socket 0660
root:wheel (apmd.c).

**1. Home stage, as you.** The dotfiles are not on the machine yet, so
take the installer out of the repository by hand:

    git clone --bare https://github.com/stokesgeo/vertrice.git ~/.local/share/vertrice.git
    git --git-dir=$HOME/.local/share/vertrice.git show HEAD:.local/bin/vertrice-install >/tmp/vertrice-install
    ksh /tmp/vertrice-install home       # the plan
    ksh /tmp/vertrice-install -y home    # do it

It uses the bare repository (history only, no files of its own) with
`$HOME` as its work tree: the dotfiles land where programs look for them,
and `$HOME` is not itself a git checkout. Files already in `$HOME` that
the repository also has (a fresh install's `~/.profile`) are moved to
`~/.local/share/vertrice-backup/DATE/`, never overwritten. It sets
`status.showUntrackedFiles=no` and tells git to ignore its own directory.
Then log out and in again.

Manage the dotfiles with `config`, a function in the kshrc that is git
pointed at that pair: `config status`, `config diff`, `config add FILE`,
`config commit`, `config pull`. Add files by name; `config add .` in
`$HOME` would add everything you own.

**2. System stage, as root.** The first time, doas has no rule yet, so
use su and the full path:

    su -
    /home/YOU/.local/bin/vertrice-install system       # the plan
    /home/YOU/.local/bin/vertrice-install -y system    # do it

Later runs: `doas ~/.local/bin/vertrice-install -y system`. It reads the
files in `~/.local/share/openbsd` and does:

- Packages: `pkg_add` with the names from pkglist that are not
  installed; with `-e`, from pkglist.extra too (see "Packages"). Most
  names match a port directory; zathura-pdf-mupdf, noto-emoji, noto-fonts
  and ntfs_3g do not (a package name can differ from its directory) and
  are not checked. `check` fails on a core package that did not install
  and lists the extra ones that are not installed.
- doas: installs `doas.conf` as /etc/doas.conf only after `doas -C`
  accepts it, and only if your user is in wheel (the rule permits wheel,
  so anyone else would be locked out). The new file is renamed into place,
  so there is always a working /etc/doas.conf.
- Root's shell: `root.kshrc` to /root/.kshrc, and `export
  ENV=/root/.kshrc` in /root/.profile (for console logins as root;
  `doas -s` gets ENV from the doas rule).
- USB notices: `hotplug-attach` to /etc/hotplug/attach, and hotplugd.
- Browser memory: puts you in login class `staff` (`usermod -L staff`)
  and gives that class in /etc/login.conf `datasize-cur=4096M`,
  `datasize-max=infinity`, `openfiles-cur=4096`, `openfiles-max=8192`.
  OpenBSD's default limits are small (datasize is the most memory a
  process may take); Chromium and qutebrowser reach them and crash, and
  Chromium's many processes run out of open files. The values are the
  ones commonly given for browsers (from memory, not from a pkg-readme).
  The edited file is checked with cap_mkdb before it replaces the old one,
  and login.conf.db is rebuilt if the system has one. The limits apply
  from your next login. If Chromium still runs out of files, the
  system-wide `kern.maxfiles` may need raising too (not done here).
- apmd, with flags `-z 7`: suspend when the battery reaches 7% with no
  AC. No `-A`, `-L` or `-H`: those set the CPU speed policy, which is
  obsdfreqd's job here, and the two would fight. apmd also gives zzz/ZZZ
  and the battery data. Whether a normal user may run `zzz` depends on
  apmd's socket permissions: not checked.
- obsdfreqd (package), CPU speed, with flags `-m 100,50 -r 50,90 -T
  85,65`. Each flag takes `on AC,on battery`. `-m` caps the speed in
  percent (full on AC, half on battery). `-r` is the CPU use that makes it
  step up: 50% on AC for a quick response, 90% on battery so only
  sustained load raises the clock. `-T` is a temperature ceiling in °C:
  past it, the cap drops each cycle until the CPU cools (85 on AC, 65 on
  battery, which also keeps the X220's fan quiet). Flag letters are from
  obsdfreqd's documentation as quoted in search results; `man obsdfreqd`
  on the machine is the authority.
- hotplugd, messagebus (the system D-Bus, from the dbus package) and
  sndiod (already on by default): enabled and started.
- unwind(8): a validating, caching DNS resolver on the laptop itself,
  which also notices captive portals (hotel and café logins) and steps
  aside for them. With unwind running, resolvd(8) points
  /etc/resolv.conf at it (127.0.0.1).
- Console: `keyboard.map+="keysym Caps_Lock = Escape"` in
  /etc/wsconsctl.conf, read at boot.
- Battery charge limit: only if the machine has the sysctl
  `hw.battery.chargestop` (newer ThinkPads do; whether the X220 does is
  not known). Then `hw.battery.chargestop=80` and, if present,
  `hw.battery.chargestart=75` are set now and in /etc/sysctl.conf, so the
  battery rests between 75 and 80%. Without it, the step is skipped with
  a note.
- Audio recording stays off (`kern.audio.record=0`, OpenBSD's default).
  `-r` turns it on, now and in /etc/sysctl.conf; dmenurecord records
  silence without it.

- sshd: left as the OpenBSD installer set it; the stage notes when it is
  enabled (see "Security").

A daemon whose flags changed is restarted. If a step fails, the others
still run, the failure is listed, and the exit status is nonzero; fix it
and run again.

**Optional: pf.** `doas vertrice-install pf` (the plan), then `-y pf`,
installs `~/.local/share/openbsd/pf.conf` as /etc/pf.conf: nothing comes in
unasked, everything may go out. It is checked with `pfctl -nf` first, the
old file is kept as /etc/pf.conf.orig, and the new one is loaded. Read the
file before installing it; see "Security".

**3. Check.** Log in on the console and run `vertrice-install check`
(which runs `~/.local/share/openbsd/check`), once on the console and once
inside X.

**Wi-Fi** is not configured by the installer. For iwn0 (the X220's usual
card; `ifconfig` shows yours), /etc/hostname.iwn0 with one `join` line per
network; ifconfig picks the best one in range:

    join homenet wpakey "home passphrase"
    join "cafe wifi"
    join worknet wpakey "work passphrase"
    inet autoconf

Then `sh /etc/netstart iwn0`. The file holds passphrases: keep it mode
0640, owned by root (from memory: netstart warns when it is readable by
others).

### By hand, for reading before running

What the system stage does, as commands. They are not idempotent: run
each once.

    pkg_add -l ~/.local/share/openbsd/pkglist
    pkg_add $(sed '/^#/d' ~/.local/share/openbsd/pkglist.extra)   # optional
    install -o root -g wheel -m 0640 ~/.local/share/openbsd/doas.conf /etc/doas.conf.new
    doas -C /etc/doas.conf.new && mv /etc/doas.conf.new /etc/doas.conf
    install -o root -g wheel -m 0644 ~/.local/share/openbsd/root.kshrc /root/.kshrc
    echo 'export ENV=/root/.kshrc' >>/root/.profile
    install -d /etc/hotplug
    install -o root -g wheel -m 0755 ~/.local/share/openbsd/hotplug-attach /etc/hotplug/attach
    usermod -L staff YOU    # then edit the staff class in /etc/login.conf;
                            # cap_mkdb /etc/login.conf if login.conf.db exists
    rcctl enable apmd obsdfreqd hotplugd messagebus unwind
    rcctl set apmd flags -z 7
    rcctl set obsdfreqd flags -m 100,50 -r 50,90 -T 85,65
    rcctl start apmd obsdfreqd hotplugd messagebus unwind
    echo 'keyboard.map+="keysym Caps_Lock = Escape"' >>/etc/wsconsctl.conf
    # only if sysctl hw.battery.chargestop exists:
    echo hw.battery.chargestop=80 >>/etc/sysctl.conf
    # only for sound in screen recordings:
    echo kern.audio.record=1 >>/etc/sysctl.conf

`sysctl.conf` lines take effect at boot; `sysctl name=value` sets one now.

Codex: the `codex` package's pkg-readme warns that it needs a lot of memory
(256 MB per worker thread) and many open files, so the staff class limits
above matter for it too. Once you add rules to `doas-agent.conf`,
/etc/doas.conf is doas.conf and doas-agent.conf joined (the command is at
the top of doas-agent.conf; `cdxb review` runs it). `cdxb` builds
codex-box the first time it runs.

Optional, for Luke's dwm and st: they are separate repos. They build on
OpenBSD once `config.mk` points at `/usr/X11R6` (their config.mk has
OpenBSD lines). Luke's dwm sends status-bar clicks with sigqueue(3), so
that patch needs replacing before his dwm builds here. dmenu comes from
packages.

## Packages

Two rules. Base first: a package is added only for a feature we want that
base does not provide. Keep it simple: a package or script nobody will use
on purpose is cruft and is left out, not kept as an option. `pkglist` is
the core: what the default session, its autostart and its keys call.
`pkglist.extra` holds features you would plausibly want but can skip, one
per package; `vertrice-install -e system` installs it.

Core (`pkglist`), and why base does not cover it:

| Package | Used by | Base |
|---|---|---|
| git | the dotfiles (bare repository, `config`) | no git client in base |
| neovim | `$EDITOR`, init.vim | vi (nvi) stays as the fallback |
| lf, fzf | file manager (lfub, `ext` on E); fzf for lf's bookmark moves and `se` | none |
| nsxiv, mpv, zathura, zathura-pdf-mupdf | images, video, PDF: lf, linkhandler, dmenuhandler, compiler | no viewers in base |
| mpd, mpc, ncmpcpp | music: autostart, sb-music, Super+m, p, [, ] and the rest | sndiod plays sound, but base has no music player |
| dunst, libnotify, dbus | notify-send in about 30 scripts; sb-show is the status line under cwm | no notifications in base |
| xclip | clipboard: maimpick, otp, dmenuunicode, lf, linkhandler | no command-line clipboard in X |
| xdotool | scratchpads (Super+Shift+Return, Super+'), dmenuunicode, maimpick | none |
| xcape | remaps: Super tapped alone is Escape | setxkbmap maps keys, not taps |
| maim, slop | Print keys; slop picks the area for dmenurecord | xwd(1) dumps only xwd images |
| ffmpeg | dmenurecord (Super+Print); mpv needs it anyway | none |
| entr | hotplug-watch (USB notices), podentr | no file-watch command |
| noto-emoji | emoji in blocks, menus and notifications | none in X fonts |
| dmenu | every menu | cwm's menu-exec runs commands only |
| qutebrowser, chromium | `$BROWSER` and Super+Shift+w | none |
| exfat-fuse | mounter: exFAT sticks and SD cards | base has no exFAT |
| unzip, bzip2, xz, zstd | ext | tar, gzip and compress cover the rest |
| sct | nightlight (Super+F4) | xrandr's gamma keeps white at full blue |
| ibm-plex | the font everywhere | none |
| obsdfreqd | CPU speed per power source, with a heat ceiling | apmd -A has no cap or ceiling |

Extra (`pkglist.extra`): mutt-wizard (mail: neomutt, isync, msmtp and pass
come with it; Super+e, sb-mailbox), newsboat (Super+Shift+n, sb-news),
password-store and pass-otp (Super+Shift+d, otp), transmission
(torrents),
tremc (the torrent screen on Super+F6 and sb-torrent's click: a curses
front end to transmission-daemon, in place of voidrice's stig, which has
no port),
yt-dlp (web video in mpv),
nq (qndl's download queue; listed beside yt-dlp, the queue's default command),
xwallpaper (setbg; without it the
root window takes the theme's background colour), unclutter (hides an idle pointer), ntfs_3g
and simple-mtpfs (mounter: NTFS disks and Android phones), 7zip (ext: 7z,
rar).

Left out:

- curl: every fetch goes through base ftp(1) (`-o file` or `-o -` for
  stdout, `-M -V` for quiet, `-U curl` where the site picks its format by
  User-Agent, `-w` for the timeouts, which limits only the connect).
  curl is still installed, because git depends on it.
- socat: pauseallmpv talks to mpv's sockets with base nc(1) (`nc -NU`).
- bash: rssget, sb-ticker and pywal's postrun are POSIX sh now.
- highlight, bat: nothing runs highlight; lf's previewer uses bat when it
  is installed and otherwise shows the start of the file with head(1).
- xwallpaper is extra: without it, setbg sets the root window to the
  current theme's background colour with xsetroot(1).
- calcurse: only sb-clock's click, and sbar blocks take no clicks.
- libiconv: only booksplit. git installs it anyway.
- noto-fonts: no config names it; IBM Plex and Noto Color Emoji cover
  the session.

## Learning

The machine is also for learning OpenBSD's way of writing programs:
ksh first, then C in style(9). Everything here uses base only.

- **Manual pages.** Super+Shift+F1 runs `manpick`: dmenu over every page
  on the machine (`apropos .`, whose argument is a regular expression, so
  "." matches all), and the pick opens with man(1) in `$TERMINAL`. Pages
  for one machine type (`apm(4/amd64)`) open with `man -s 4 -S amd64`.
  Typing `ksh(1)` or `ksh` into the menu works too.
- **Practice programs.** `learn new NAME` makes `~/src/learn/NAME` from
  the templates in `.local/share/vertrice/learn`: a ksh script (`set -u`,
  getopts, a usage line) with `tests/run` and `tests/cases`, which print
  PASS or FAIL per case as the vertrice suite does. `learn new NAME c`
  makes the C kind: a Makefile for bsd.prog.mk (PROG, SRCS, MAN, CFLAGS
  with -Wall -Wextra), a style(9) main.c with pledge(2), getopt(3) and
  err(3), and an mdoc manual page. `make` builds; `make manlint` runs
  `mandoc -Tlint` on the page (that target comes with bsd.man.mk). The
  comments say what each line teaches; the templates hold no answers.
- **Reading list.** `.local/share/vertrice/learn/reading`: scripts that
  come with the system (/etc/netstart, /etc/rc, sysupgrade, rcctl,
  sysmerge) and small C programs in /usr/src (yes, echo, cat, head, wc).
  /usr/src is empty on a fresh install. The list says how to fill it with
  cvs(1), which is in base: the main branch while the machine runs
  snapshots, the `OPENBSD_8_0` branch (8.0-stable) once it runs 8.0.

Checked off the machine: bsd.prog.mk, bsd.man.mk (manlint), style(9),
pledge(2) and apropos(1)'s output format were read in OpenBSD's source;
the C skeleton compiles with gcc and clang (`-Wall -Wextra`), the manual
page passes mandoc's lint, and the ksh files parse and run under oksh.
Not run: bsd.prog.mk itself, and the cvs commands (from memory of the
FAQ).

## Security

The rule: OpenBSD's defaults are the floor; above it, vertrice takes cheap
changes that remove a real worry and leaves out costly ones. Sources read
for this section: OpenBSD's etc/pf.conf, etc/examples/pf.conf,
usr.bin/ssh/sshd_config, distrib/miniroot/install.sub, usr.bin/doas/doas.c,
sbin/disklabel/disklabel.c and bin/pax (GitHub mirror of src). "From
memory" marks what was not read.

### What OpenBSD already gives

- **Programs that limit themselves.** Base daemons and many base programs
  call pledge(2) (which system calls they may make) and unveil(2) (which
  paths they may see); chromium from ports does too (from memory, as a
  general statement).
- **Memory protections**, on by default: W^X (no memory both writable and
  executable, except on a `wxallowed` mount such as /usr/local), address
  randomisation, a kernel relinked at every boot, a hardened malloc (from
  memory, as a list).
- **Recording off.** `kern.audio.record=0`, so a program opening the
  microphone gets silence; `kern.video.record=0` does the same for the
  webcam (the video one from memory).
- **Encrypted swap.** Swap pages are encrypted with keys that exist only
  until shutdown (`vm.swapencrypt.enable=1`, from memory).
- **The network.** The default /etc/pf.conf passes everything in and out
  with state and blocks only remote X11 (ports 6000-6010); X does not listen
  on TCP anyway. Nothing but sshd, if chosen at install, listens for the
  network.
- **sshd.** The installer asks "Start sshd(8) by default?" (default yes) and
  then "Allow root ssh login?" (default no, written into sshd_config).
  sshd's own defaults are good: privilege separation, no empty passwords.
  Passwords are allowed (`PasswordAuthentication yes`).
- **doas.** With no /etc/doas.conf, nobody may use it; there is no
  passwordless default.
- **Signed updates.** Install sets, packages and patches are signed with
  signify(1) and checked before use (from memory).

### What vertrice adds

- One doas rule for wheel: password asked (persist, per terminal), no
  `nopass`, no `keepenv`; root gets its own kshrc, never the user's files.
- Drives: every mount `nosuid,nodev`; the system disk is never offered; only
  lines the menu offered are accepted; device-supplied text (label, phone
  name) cannot add lines.
- hotplugd's root script writes one file and nothing else; nothing mounts
  by itself.
- unwind(8): DNS answers are validated (DNSSEC) where the zone signs them.
- State and downloads out of fixed /tmp names (a shared directory where
  a planted symlink could redirect a write).
- xidle locks X after 10 idle minutes.
- Optional: the laptop pf.conf (`vertrice-install pf`).

**The laptop pf.conf** (`.local/share/openbsd/pf.conf`, each rule explained
in the file). Nothing enters unless the laptop asked for it; everything may
leave. In order: skip the loopback; `block in`, which drops silently, so a
scan does not see the laptop; `pass out`, keeping state, so replies return;
pass IPv6 neighbour and router messages, without which IPv6 fails; an
optional `pass in on egress` for the ports in `tcp_in`, commented out with
the macro, so no port is open by default, ssh included;
`antispoof quick for lo0`, dropping forged 127.0.0.0/8 and ::1 sources.
OpenBSD's own two rules stay: remote X11 blocked (made `quick`, so tcp_in
can never open it) and no network for the `_pbuild` user. OpenBSD's default
file has no antispoof or uRPF line. /etc/examples/pf.conf has uRPF
commented out, marked "use with care"; it stays commented out here too,
because with Wi-Fi and a wired dock both up it drops good replies. Not
checked with pfctl off the machine; the installer runs `pfctl -nf` before
it installs anything.

**sshd on the laptop: off unless you log in to it remotely.**
`rcctl disable sshd; rcctl stop sshd`. The system stage prints a note when
it is enabled and changes nothing. If you use it, OpenBSD's sshd_config
needs two lines, added above any Match block (OpenBSD's file has none
active). sshd takes the first value it reads, so delete an earlier
uncommented line for the same keyword:

    PermitRootLogin no              # log in as yourself, then doas
    AuthenticationMethods publickey # keys only; passwords are refused

Put your key in `~/.ssh/authorized_keys` first, check with `sshd -t`, then
`rcctl reload sshd`, and set `tcp_in = "{ ssh }"` in pf.conf.

### Full-disk encryption on the X220

For the rebuild. The whole OpenBSD disk goes inside a softraid(4) CRYPTO
volume: /, swap, /home and the kernel. Only the boot blocks stay plain.
boot(8) asks for the passphrase, unlocks the volume and loads the kernel
from it (from memory).

- **At install.** Recent installers ask whether to encrypt the root disk,
  with a passphrase or a keydisk (from memory: added around 7.5; say yes).
  By hand, from the installer's (S)hell (the OpenBSD FAQ's steps, from
  memory):

      cd /dev && sh MAKEDEV sd0
      fdisk -iy sd0                     # MBR: boots from SeaBIOS
      disklabel -E sd0                  # one partition a, fstype RAID, whole disk
      bioctl -c C -l sd0a softraid0     # asks the passphrase; prints the new disk, e.g. sd1
      cd /dev && sh MAKEDEV sd1
      dd if=/dev/zero of=/dev/rsd1c bs=1m count=1
      exit                              # then install onto sd1

- **Libreboot.** The SeaBIOS payload boots OpenBSD's MBR boot blocks,
  which then ask for the passphrase. GRUB cannot open softraid; with the
  GRUB payload, chain to SeaBIOS (from memory).
- **Keydisk instead of a passphrase.** `bioctl -c C -k sd2a -l sd0a
  softraid0`, where sd2a is a small RAID partition on a USB stick: the
  machine boots only with the stick in. Losing the stick loses the data:
  keep a copy of that partition (dd it to a second stick). It is one or the
  other, passphrase or keydisk (from memory). For one person carrying a
  laptop, the passphrase costs less.
- **Change the passphrase:** `bioctl -P sd1`.
- **Suspend (zzz, the lid).** RAM stays powered and holds the disk key. The
  encryption protects nothing while the laptop sleeps; the screen lock is
  the only barrier, so `/etc/apm/suspend` locks X before the machine
  sleeps (see Lid, under X220).
- **Hibernate (ZZZ).** RAM is written to the swap partition and the power
  goes off. Swap is inside the CRYPTO volume, so the image is encrypted
  with the disk key; at power-on boot(8) asks for the passphrase and
  resumes (from memory, including that hibernating to a softraid CRYPTO
  disk is supported). The per-boot keys of encrypted swap cannot survive
  power-off, so they do not cover the image: without full-disk encryption,
  a hibernated laptop has its RAM (open files, ssh-agent keys) in plain
  text on disk (from memory). Swap must be at least the size of RAM.
- **In practice:** zzz at home; ZZZ or power off when the laptop leaves
  your hands (travel, a bag). That is the state in which a stolen laptop
  is only ciphertext.

### Updates: -current or the latest release

- **Snapshots (-current), until 8.0 ships.** `sysupgrade -s` moves base to
  the newest snapshot and reboots; then `pkg_add -u` updates the
  packages, which must come from the snapshot package tree. There is no
  syspatch on -current: a fix arrives in the next snapshot. `fw_update`
  runs as part of the upgrade (from memory).
- **8.0 release.** `syspatch` installs base errata (security and
  reliability fixes, signed); `pkg_add -u` updates packages from the
  release's -stable package branch, which gets security fixes (from
  memory: pkg_add looks there by itself on a release). `sysupgrade`
  without `-s` moves to the next release when it is out.
- **Moving from snapshots to 8.0:** a snapshot newer than 8.0 is 8.0-current
  on its way to 8.1, so there is no step back to the release without a
  reinstall or an upgrade from the 8.0 sets (from memory: sysupgrade does not
  go backwards).

### Left out, on purpose

- **Filtering outbound traffic.** Every new program would need a rule;
  it stops little that a program running as you could not do another way.
- **pf on by default in the system stage.** With sshd off, nothing listens
  for the network, so the default pf.conf already exposes nothing; the
  laptop file is for the day something does listen. It is its own
  explicit stage.
- **sysctl and kernel hardening beyond OpenBSD's defaults**, securelevel 2,
  USB device allow-lists: high cost (breaks X, updates or plugging in),
  little worry removed on a one-person laptop.
- **A random MAC address** (`lladdr random` in hostname.iwn0, from memory):
  it is privacy, not security, and a café's login page would ask again
  after every boot. One line to add if wanted.
- **Integrity scanners and antivirus.** OpenBSD's nightly security(8) run
  already reports setuid changes and file-system changes (from memory).

### Review findings not fixed (proposals)

- **ext overwrites files.** OpenBSD tar has no `-k` (checked: bin/pax
  tar_options), so `ext` in `$HOME` can overwrite a file of the same name
  (`.profile` in a tarball). Escaping the directory is not possible: tar
  strips leading `/` and `..` and defers symlinks that point outside
  (checked in bin/pax); unzip and 7z strip them too (from memory).
  Proposed: extract into a new directory named after the archive.
- **mpd's fifo is /tmp/mpd.fifo.** A fixed name in /tmp; low risk (only
  local users could plant it). Move it to `~/.cache` with ncmpcpp's
  visualizer path.
- **The system stage installs files from your home as root.** Accepted:
  anything running as you that could change those files could as well
  change your kshrc and wait for your next doas password.

## Not ported, or not tested

- `sd` (terminal in the focused window's directory): reads
  `/proc/PID/cwd`. OpenBSD exposes a process's cwd only through
  sysctl(3) `KERN_PROC_CWD`. A C helper of a few dozen lines would
  close it. Until then `sd` opens a plain terminal.
- Removed: dmenumountcifs (avahi, CIFS), dmenupass (sudo askpass), remapd
  (udev), the pacman update blocks and cron job. mounter and unmounter
  were rewritten for OpenBSD; the Linux versions' LUKS and Android (MTP)
  support did not come over.
- Untouched and untested: pinentry/preexec (Linux library paths), ueberzug previews
  (not packaged; lfub falls back to plain lf), cron jobs that notify
  (no fixed D-Bus address to point cron at).
- lf's opener trusts OpenBSD file(1)'s MIME database, which differs from
  libmagic's. A type it does not know comes back as
  application/octet-stream and opens in zathura. Try an mp3, mp4, epub
  and an empty file once on the machine.
- otp writes the scanned QR image to /tmp, which is on disk on OpenBSD
  (Linux used a RAM-backed runtime directory). `rm -P` overwrites the
  file, but on an SSD wear levelling can keep the old blocks.
- xidle also locks when the pointer rests in a screen corner: always on,
  northwest by default (read in xidle's source). Pushing the pointer into
  the top-left corner locks the screen; `-no` on the xprofile line turns
  that off.

## Open

- What this fork becomes, and whether a Mac port follows.
