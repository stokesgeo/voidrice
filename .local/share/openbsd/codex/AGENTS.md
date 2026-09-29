# Working on this machine

This is an OpenBSD system. Prefer what the base system ships; use packages
(pkg_add) only when base has no tool for the job, and never build ports.

## The box you run in

You run inside `cdxb`, a box made with unveil(2) and pledge(2). You see the
project, the paths the owner granted, the system (read-only) and ~/.codex.
A file that seems missing may exist outside the box. Do not try to get
around the box.

- Need another path? Say which and why. The owner runs `cdxb add PATH`
  (or `cdxb add -r PATH`) and restarts you; the conversation resumes.
- Temporary files go in `$TMPDIR`, not /tmp.
- setuid programs cannot run in the box, so `doas` and `su` fail. In a
  `cdxb -d` session, `cdxb doas /full/path/to/command args` runs the
  commands the owner allows without a password, written exactly as in
  doas.conf. Otherwise print the command for the owner to run (they copy
  it with /copy).
- diff(1) and patch(1) call unveil themselves and fail here: use
  `git diff --no-index a b`, and your own patch tool.
- Run git yourself, here in the box; never hand the owner a git command
  to run outside it. The box holds no push credential yet: when a push is
  needed, say so.

## Changing the box's own settings

~/.config/cdxb/grants, ~/.config/cdxb/deny, ~/.codex/config.toml,
~/.codex/AGENTS.md and ~/.local/share/openbsd/doas-agent.conf are
read-only for you. To propose a change to one, write the FULL new file to
`$CDXB_OUTBOX` under its name here:

    grants  deny  codex (config.toml)  agents (AGENTS.md)  doas

Plain ASCII only (tabs and newlines allowed). Then tell the owner why;
when cdxb next starts or restarts, they see the diff and type y or n.

## Reminders

The owner's reminders are in ~/.calendar/calendar, in calendar(1)'s
format: a date, a tab, the text (`Oct 3<TAB>Return the library books`).
When asked for a reminder, add a line there; cron mails the day's lines
each morning.

## OpenBSD habits

- Shell: POSIX sh or ksh (`#!/bin/ksh`), not bash; check with `ksh -n`.
- C: style(9); pledge(2) and unveil(2) in new programs; err(3),
  strtonum(3), strlcpy(3). Build with base cc and make (bsd.prog.mk).
- Base tools and their BSD flags: check the manual before assuming a GNU
  flag; GNU tools, when installed, start with g (gsed, gmake).
- Services: rcctl(8). Packages: pkg_add(1). Privilege: doas(1).
- Keep changes small and readable.
