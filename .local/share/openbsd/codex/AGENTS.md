# Working on this machine

This is an OpenBSD system. Prefer what the base system ships; use packages
(pkg_add) only when base has no tool for the job, and never build ports.

## The box you run in

You run inside `cdxb`, a box made with unveil(2) and pledge(2). You see the
project directory, the paths the owner granted, the system directories
(read-only) and ~/.codex. Everything else in the owner's home is hidden:
a missing file may exist but be outside the box. Do not try to get around
the box; ask the owner instead.

- Need another path? Say which path and why. The owner runs
  `cdxb add PATH` (or `cdxb add -r PATH` for read-only) and restarts you;
  the conversation resumes.
- Temporary files go in `$TMPDIR` (a private directory), not /tmp.
- Running setuid programs is refused by the kernel in the box, so `doas`
  and `su` do not work. If the session was started with `cdxb -d`, run
  `cdxb doas /full/path/to/command args` instead: it can run only the
  commands the owner allowed without a password, written exactly as in
  their doas.conf. Otherwise print the command for the owner to run; they
  copy it with /copy.
- diff(1) and patch(1) from base stop with an unveil error in the box
  (they call unveil themselves, and the box is locked). Use
  `git diff --no-index a b` to compare files and your own patch tool to
  edit them.

## Changing the box's own settings

These files are read-only for you: ~/.config/cdxb/grants,
~/.config/cdxb/deny, ~/.codex/config.toml, ~/.codex/AGENTS.md and
~/.local/share/openbsd/doas-agent.conf. To propose a change, write the
FULL new file to the outbox, `$CDXB_OUTBOX`, under one of these names,
plus a one-line reason in the same name with `.why` added:

    grants  deny  codex (config.toml)  agents (AGENTS.md)  doas

Example: `$CDXB_OUTBOX/grants` and `$CDXB_OUTBOX/grants.why`. The owner
sees a diff and types y or n when cdxb next starts or restarts. Plain text
only: links, directories and control characters are rejected. Then tell
the owner a proposal is waiting.

## OpenBSD habits

- Shell scripts: POSIX sh or OpenBSD ksh (`#!/bin/ksh`), not bash. Check
  them with `ksh -n`.
- C: style(9). Use pledge(2) and unveil(2) in new programs, err(3) for
  errors, strtonum(3) for numbers, strlcpy(3) and snprintf(3) for strings.
  Build with base cc and make (bsd.prog.mk).
- Commands and flags: base tools and their BSD flags. Check the manual
  (`man 1 sed`) before assuming a GNU flag exists; GNU tools, when
  installed, are prefixed with g (gsed, gmake).
- Services: rcctl(8). Packages: pkg_add(1), pkg_info(1). Privilege: doas(1).
- Keep changes small and readable. Explain in comments how a thing works,
  in plain words.
