# vertrice on OpenBSD

vertrice is voidrice, Luke Smith's dotfiles for Linux, ported to OpenBSD
and set up for a ThinkPad X220. It is one person's working machine,
kept in a public repository with nothing personal in it. The reference
is `man vertrice`; this page says what the thing is and why.

## Why OpenBSD, and why a fork

The owner's words, from his own instruction file: "Hardened Plaintext
... Poles: plaintext (comprehensible, composable, suckless /
worse-is-better) x hardened (adversarial-by-design, assume-breach) —
OpenBSD at the intersection. Cascade: trust what 1 mind can hold -> else
a nameable taste -> assume that fails, compartmentalize -> live in it
daily or it isn't real. Comprehension surface = attack surface."

voidrice already has the shape wanted: plain shell scripts in
`~/.local/bin`, configs in `~/.config`, dmenu for every menu, one status
line, and a key for each job. The port swaps the Linux parts (systemd,
PipeWire, sudo, /sys, GNU flags) for what OpenBSD base has (rc, sndio,
doas, apm and sysctl, BSD flags) and keeps the rest. Most of the scripts
are still Luke's.

Reading, not yet confirmed by the owner: OpenBSD is the choice because
its base system already is the thing the school describes, a whole
system one person can read, and voidrice is the fork base because its
scripts are the same kind of thing at the desktop layer.

## The principles, in the owner's words

- "This is a human first codebase/ .dotfile repo. It needs a lot of
  effort put into simplicity, directness, readability, clarity of
  purpose and intention and idiomaticy. OpenBSD and voidrice idioms are
  import for our approach across the board. Nothing we are doing should
  be complication, convoluted or involved. Anywhere we made changes, but
  especially anywhere we added lines over the voidrice is suspect. I do
  not want bloat."
- Base first: packages over ports, never compile ports; a package is
  added only for a feature base does not have.
- Comments: "clean crisp, meaningful comments in the openbsd/voidrice
  idiom ... Grounded, simple, clear STE/anglo-saxon type beat English."
  Luke's asides stay: "They are character comments from people, which
  aren't problematic."
- Git: "I, by default, don't want to think about git." "I want sane,
  failsafe and low friction defaults, and review before use is none of
  those."
- The microphone and camera are off until a call needs them.
- Bugs: "I don't want to chase phantom bugs/hallucinated bugs/its not a
  bug, its a feature, bugs."
- On what comes next: "We'll probably end up with st as default (with
  patches) and a cointoss over dwm." Until then: ksh, cwm and xterm,
  all from base.

## Day to day

Log in on the console and X starts: cwm, with voidrice's keys, a status
line along the bottom, dmenu for menus. Super+F1 lists the keys.
`man vertrice` has the rest: the install, what the installer changes,
the machine settings, backups (`bk`), writing (`writemode`, `proof`),
the dictionary (`dict`, `roget`), reminders (`~/.calendar/calendar`) and
Codex in a box (`cdxb`). The dotfiles are a bare git repository with
`$HOME` as its work tree; `config` is git pointed at it, and
`config pull origin master` updates.

Agents working on the repository start from `SPEC.md`, beside this file.
