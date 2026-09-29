# vertrice: spec, decisions and the walk

For agents working on this repository. The code and `man vertrice`
(`.local/share/man/man7/vertrice.7`) are the reference: where this file
and the tree disagree, the tree is right and this file needs the fix.
The history is `git log`, from 009be54 (the first port commit) on; it is
not copied here. The explainer for people is `OPENBSD.md`, beside this
file. The suite is `tests/run` (its header says how to run it); each
reproduced bug gets a case there.

The owner is Geo, a writer, not a developer. His words are quoted as he
gave them (2026-09-29 unless dated). A line marked "Reading" is an
agent's inference, not yet confirmed by him; carry it as a question.

## Spec: what vertrice is and must keep true

vertrice is Luke Smith's voidrice, ported to OpenBSD for a ThinkPad X220
(Libreboot). It is public, with nothing personal in it. It keeps
voidrice's layout (scripts in `~/.local/bin`, configs in `~/.config`,
dmenu for every menu, one status line) on OpenBSD base: ksh, cwm, xterm,
doas, sndio, apm, dump. A package is added only for a feature base does
not have. The dotfiles are a bare repository whose work tree is `$HOME`.

The owner, on the whole fork:

> "We need to find ways where anything we are doing that's become
> complicated can be made simple, idiomatic and direct, readable one
> liners strongly preferred. This is a human first codebase/ .dotfile
> repo. It needs a lot of effort put into simplicity, directness,
> readability, clarity of purpose and intention and idiomaticy. OpenBSD
> and voidrice idioms are import for our approach across the board.
> Nothing we are doing should be complication, convoluted or involved.
> Anywhere we made changes, but especially anywhere we added lines over
> the voidrice is suspect. I do not want bloat."

What that covers: "Specifically test suite is fine as it's for
agents/code exe alone/ build not ux. The .dotfiles themselves however
are ux in terms of readability."

Changing behaviour while simplifying: "The simplicity pass can change
behavior if the behavior change is smart/idiomatic/sane/competent. The
tests are for conformity to agent intent, testing etc, by and large."

Comments: "I want clean crisp, meaningful comments in the
openbsd/voidrice idiom (tho more strongly on the openbsd side, as some
voidrice comments are a bit cryptic/specific/for Luke and don't
generalized to me well). Grounded, simple, clear STE/anglo-saxon type
beat English." And: "most good comments aren't simply repeating what the
code says/does in a different register, but focus on saying the
important other things that the code cannot easily say, and/or help the
reader grok the big picture or pattern keystone or principle or block
concept/abstraction". "I don't want a bunch of changelog cruft in
comments." Luke's asides stay: "They are character comments from people,
which aren't problematic." A comment goes when it is "for Luke, in that
it's not written for understanding by another person outside of Luke's
brain".

Bugs: "I don't want to chase phantom bugs/hallucinated bugs/its not a
bug, its a feature, bugs."

The future: "we want to reason about the work from the perspective of
the future and not make bad decisions now that could be smart if future
aware today."

The school, from the owner's own instruction file: "Hardened Plaintext
... Poles: plaintext (comprehensible, composable, suckless /
worse-is-better) x hardened (adversarial-by-design, assume-breach) —
OpenBSD at the intersection. Cascade: trust what 1 mind can hold -> else
a nameable taste -> assume that fails, compartmentalize -> live in it
daily or it isn't real. Comprehension surface = attack surface." And:
"Security is built to quietude, bounded by cost — never by a quality
ceiling."

Reading, not yet confirmed: a fix is proven by reproducing the bug
first, and lands with the test that failed before it; a bug that cannot
be reproduced is not chased.

## Decisions

One entry per ruling. The ruling is in the owner's words where he gave
them; an entry with no quote is the agents', and says so. Status: done
means in the tree; untested means not yet run on the X220.

- **Base first; packages over ports.** Standing ruling: packages over
  ports, never compile ports, base first. `pkglist` is what the default
  session calls; `pkglist.extra` the rest. Rules out a package for a job
  base does (curl, socat, bash, task-spooler, rsync went). Done.
- **ksh, cwm and xterm for now; st and dwm-or-cwm ahead.** Standing
  ruling: ksh + cwm by default (for now). The owner: "I'm no great lover
  of xterm. It's a bloated mess only in OpenBSD because they maintain
  X11 via xenocara and therefore having another terminal would be extra
  work. I like suckless tools. I'm indifferent to cwm, but it is the
  obsd native wm and so worth giving a shot, it has people who quite
  like it. We'll probably end up with st as default (with patches) and a
  cointoss over dwm. So at some point we will pick a side and want to
  clean up the codebase/rice to be specialized and singular to one
  build." `WM=dwm` and `TERMINAL=st` in the profile are the opt-in
  (built by hand into `~/.local/src`). Open: the pick, and when.
- **Track the latest release or -current.** Not pinned to a version.
  Done.
- **Public, nothing personal.** The GitHub token for the Codex box is
  ignored by git. Done.
- **Backups: dump(8).** Standing ruling: backups with dump. `bk full`
  and `bk incr` dump /home to `/mnt/backup/dump`; `dump -u` keeps the
  record, `dump -W` is the status, `dump -w` in xprofile is the
  reminder. Agents' reason for no second path: openrsync keeps no
  history, tar has no incremental mode, borg and restic add nothing a
  USB disk needs. Done; untested.
- **Reminders: calendar(1), mailed by daily(8).** The owner: "calendar
  is a good idea (with agent wiring as well)". `~/.calendar/calendar`;
  the nightly `calendar -a` at 01:30 mails the lines; the Codex box
  may write there (grants) and its AGENTS.md says how. Done.
- **Root's mail to the owner.** "root mail seems reasonable".
  `/etc/mail/aliases`, unless root has an alias. Done.
- **Git is Codex's job, in the box.** "I, by default, don't want to
  think about git." "I want sane, failsafe and low friction defaults,
  and review before use is none of those." The partial `.git` walls
  went (f72ad4c); in a repository the box can change, git runs in the
  box, and pushes go over https with a scoped GitHub token in
  `~/.config/cdxb/github-token`. Done; untested. Open: a separate Unix
  user for Codex.
- **cdxb is a hack, not for keeps.** "Long term, cdxb should probably
  live outside of vertrice, or die once a better handling of codex is
  developed/released... I don't want cdxb long term, it's a hack." Kept
  with `-a`, `-d` and `-H`; `-n`, `-s` and `-X` were cut (a2df77a).
  Reading, not yet confirmed: this rules out growing it. Held.
- **Recording off by default, on per call.** Standing ruling. OpenBSD's
  `kern.audio.record` and `kern.video.record` stay 0; `rectoggle`
  (Super+Ctrl+F11) flips both; fbtab gives the camera to the console
  user. Done.
- **obsdfreqd.** "I want obsdfreqd I asked for it." Flags
  `-m 100,50 -r 50,90 -T 85,65`; apmd gets `-z 7` and no `-A`, `-L` or
  `-H`, so the two do not fight over the speed. Done.
- **doas: one rule, no nopass, except Codex's allowlist.** Standing
  ruling: no nopass doas rules except the scoped Codex allowlist.
  `doas.conf` is one `permit persist` line for wheel; `doas-agent.conf`
  is empty by default and takes only nopass rules with full paths and
  `args`; the installer joins them behind `doas -C`. Done.
- **Root UX: sane, small.** "I do want a sane root ux, but it's not an
  essential thing, certainly not something to complicate." `/root/.kshrc`
  is vi mode and a red prompt; doas hands it to `doas -s` through
  `setenv ENV`. Done.
- **pf.conf.** "Having a pf.conf that's good is worthwhile." Nothing in
  unasked, all out; installed behind `pfctl -nf`. Done.
- **Touchpad off, TrackPoint only.** The owner's pick (bc6f0a9). One
  line in wsconsctl.conf; `remaps` turns on wheel emulation on the
  middle button. Done; untested.
- **Escape stays Escape; Caps Lock types Escape.** "Escape should be
  escape. Capslock is dumb." Console: the `keyboard.map` line; X:
  `remaps` (Caps tapped is Escape, held is Super, as in voidrice).
  voidrice's swap of the two keys is not carried. Done.
- **Battery charge limit: dropped.** The owner's ruling (7dec67c). Rules
  out `hw.battery.chargestop` lines. Done.
- **Installer: a plain command list.** The owner: "25-line script".
  `vertrice-install` is the commands themselves; reading the file is
  the dry run; a second run is safe but for the two appends. Done;
  untested.
- **The cwm bar: a one-line terminal.** Agents' (6017867, 7e9ae0b): cwm
  draws no bar, and cwmrc(5) documents `gap` for such windows. xinitrc
  starts an xterm named vbar along the bottom running `sbar -t`; cwmrc
  keeps it on every group, frameless, out of cycling, and under a gap.
  Super+b shows the line as a notice when a window covers it. Clicks
  never reach a block. Done; untested.
- **dmenu through a wrapper.** Agents' (c0230f3): the ports dmenu reads
  no Xresources. `~/.local/bin/wrap/dmenu`, first in PATH, passes IBM
  Plex Mono and the palette `theme` last set; the caller's options come
  after and win. Done.
- **No compositor.** Agents' (9ee25f2): xterm has no alpha, so xcompmgr
  only cost work; run it by hand for st. Done.
- **sd through proc-cwd.** The owner picked "Write the C helper" (7f5231a): no /proc, so a 49-line C
  helper reads a process's directory with `sysctl kern.proc_cwd`, built
  on first use; without it `sd` opens a plain terminal. Super+Return.
  Done; untested.
- **Palette: day and night.** Agents': two themes, `theme clock` from
  xprofile (day 07:00, night 19:00), Super+F8 toggles; pywal is opt-in
  with `PALETTE=wal`. GTK follows it: "Either way I'd want to follow day
  night." The GTK themes for day and night are placeholders
  "pending the owner's pick" (`theme`). Done; the pick is open.
- **Spelling and dictionary.** Agents': base spell(1) with a
  contractions list, nvim's own list for spelling while typing, no
  aspell or hunspell. The owner: "Obsd dictionary tooling for default,
  install extra compatible dictionaries would be fine". dictd on
  localhost with GCIDE and Roget's Thesaurus (1911), built by
  `vertrice-dict`; `dict`, `roget`, and K in nvim. Done; untested.
- **Archives: bsdtar.** Agents' (c68ce0c): libarchive replaces tar,
  unzip, 7z and unrar; `ext` keeps existing files. Done.
- **Docs.** The owner: "Man vertrice is a great idea, do it, with
  openbsd style man page completeness and readability and idiom
  expectations, including prose style and such." vertrice(7) is the
  reference, the README is short, CHANGES went (git log keeps it), and
  this file and OPENBSD.md are what is left of the old notes. Done.
- **The Mac.** "vertrice roadmap has Mac as an install target (different
  wm and some other expected changes) so testing/polishing on Mac where
  such can be done, is worth doing." And: "sync with Mac and such would
  be a future concern." Held: a test round there, after the open items
  close.

## The walk: each Linux mechanism and what replaced it

As the tree has it now. Each item names the voidrice way, the OpenBSD
way, and where it lives.

1. `setsid -f` -> `detach`: `nohup CMD >/dev/null 2>&1 &`. One name, so
   a C version could replace it without touching the callers.
2. pidof, killall -> pgrep and pkill, `-x` for an exact name, `-f` for
   a script (its process is the interpreter).
3. dwmblocks and SIGRTMIN+n -> `sbar`: runs the blocks every 5 seconds
   and sets the root window name (dwm) or redraws in its own terminal
   (`sbar -t`, the bar under cwm). `sb-refresh` sends SIGUSR1 with
   `pkill -f`, which ends sbar's `sleep & wait`. No real-time signals,
   no sigqueue, so `$BLOCK_BUTTON` is never set: the click cases in the
   blocks are inert.
4. zsh -> ksh. `~/.profile` (a link into `.config/shell`) sets `ENV` to
   `.config/ksh/kshrc`. Aliases use only flags OpenBSD's tools have.
5. The X session: `startx` from ttyC0 (the profile), or xenodm through
   `~/.xsession`. xinitrc starts one D-Bus bus, writes its address to
   `~/.cache/session-env` for cron jobs (`cron/README.md`), sources
   xprofile, then runs cwm under ssh-agent unless an agent is set;
   `WM=dwm` runs dwm with sbar. No compositor.
6. PipeWire -> sndiod from rc(8): mpd outputs to sndio, `sndioctl` sets
   the volume (cwmrc), ffmpeg records from `-f sndio` (dmenurecord).
7. /sys and /proc -> apm(8) for the battery, wsconsctl(8) for the
   backlight, sysctl for temperature, load and clock (`hw.sensors`,
   `kern.cp_time2`, `hw.cpuspeed`), one `ifconfig` for the network,
   `netstat -ibn` for traffic, `top -b` and `hw.physmem` for memory.
8. GNU syntax and GNU tools -> POSIX and BSD forms: `ftp(1)` for every
   fetch, `nc(1)` for mpv's sockets, `sort -R` for shuf, `stat -f`,
   `file -bi`, `nq(1)` for task-spooler, bsdtar for the archive tools.
9. sudo -> doas. A script that needs root and has no terminal reopens
   itself in one (mounter, bk, dmenuwifi), or cwmrc runs it in
   `$TERMINAL` (rectoggle). doas has no askpass.
10. XDG_RUNTIME_DIR and flock(1) -> a `mkdir` lock in /tmp for the
    fetching blocks (atomic; /tmp is cleared at boot), state in
    `~/.cache`, and `mktemp -d` where a fixed /tmp name could be planted
    (linkhandler, dmenuhandler, noisereduce).
11. lsblk and cryptsetup -> disklabel(8) and bioctl(8) in `mounter`,
    fstab by DUID first, every mount `nosuid,nodev`, the system disk
    never offered, only offered lines accepted. `unmounter` locks the
    volume again.
12. Luke's dmenu build -> the ports dmenu behind `wrap/dmenu` (item
    "dmenu through a wrapper" above).
13. pacman checks in cron -> one root crontab line writing
    `/var/db/updates` (`syspatch -c`, `pkg_add -u -n -v`); `sb-updates`
    counts it, `sb-popupgrade` installs it in a terminal.
14. udev and remapd -> `remaps` once at login (Super+F12 again);
    hotplugd(8) runs `/etc/hotplug/attach`, which writes the disk name
    to one file, and `hotplug-watch` (entr) turns that into a notice.
    Nothing mounts by itself.
15. dwm's tags and layouts -> cwm groups and on-request tiling, Luke's
    key for each job (`cwmrc`; Super+F1 lists it). Tags are
    `group-only-N`, `window-movetogroup-N` and `group-toggle-N`; tile
    and bottom stack are `window-vtile` and `window-htile`; run is
    `menu-exec`. Not carried, because cwm has none: automatic layouts
    (press Super+t again after a window opens or closes), gaps, moving a
    window to the next tag, a float toggle. XF86 volume and brightness
    keys work below X (acpithinkpad).
16. slock, and `slock loginctl suspend` -> xidle(1) from xprofile, xlock
    in blank mode (xresources); zzz and ZZZ go through apmd, whose
    `/etc/apm/suspend` signals xidle before sleep.
17. vi: nvi is the fallback that always works. `NEXINIT` in the profile
    points it at `.config/vi/exrc`; nvim reads neither. Root gets vi.

## Untested on the machine

vertrice(7) CAVEATS lists what has not run on an X220, and
`tests/check` is the first-boot check. Beyond that list, not yet seen on
the machine: the bar's height under st (cwmrc's gap is xterm's 22
pixels); what a cwm restart (Super+F5, "renew") does to hidden windows,
since cwm never removes a client from its save-set; `theme`'s OSC
recolouring on real ptys; xidle's corner lock (top-left, always on);
lf's opener against OpenBSD file(1)'s MIME database (try an mp3, mp4,
epub and an empty file); otp's QR image in /tmp on an SSD (`rm -P`
cannot beat wear levelling); `hotplug-watch` with a real attach.

## Open

- The window manager and terminal (see "ksh, cwm and xterm for now").
- The Codex box: a separate Unix user; whether upstream Codex gains a
  pledge/unveil sandbox, which would retire cdxb.
- The Mac: the install target and the test round.
- The GTK themes for day and night.
- Held by the owner, in his words: a console writing session
  ("interesting, but too much for now, note as a future feature idea");
  word-level diffs for prose ("it might be great, but id want to
  actually experience test it"); got and the OpenBSD development stack
  ("got isn't something I plan to adopt yet, but I might want to learn
  the obsd development stack in the future").
- Leftovers from dwm and Luke's setup, to discuss one by one: setbg's
  dwm lines, `sb-help-icon`, the st lines in xresources, `tutorialvids`.
- `cdxb ls` can show a crashed session as live if its pid is reused.
  Rare, no grant leaks; every fix tried would hide a live session. Left.
