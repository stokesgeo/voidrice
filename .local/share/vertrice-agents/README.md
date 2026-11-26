# Shared agent home

`~/.agents/` is where your agents keep tasks, handoffs, notes and session
records, so work outlasts one session and one harness. `vertrice-agents init`
seeds the starting files; `vertrice-agents --help` gives the exact commands.
Read [the shared instructions](templates/AGENTS.md) and
[the home guide](templates/README.md) before you use it.

`init` creates only missing files and never changes existing ones. It does not
touch harness settings. The seeded `.gitignore` ignores everything in the
home, which helps keep personal records out of any repository.

**What `init` makes live.** It writes `~/.agents/AGENTS.md`. Pi builds with
this integration load that file at the next process start, and the shipped
`.config/crush/crushrc` asks Crush to load it too (not yet tested in Crush).
Loading it is not review: read [the template](templates/AGENTS.md) first, or
try a scratch home. `--root` does not retarget Pi or Crush.

## Try it on a scratch home

This touches no harness and no real `~/.agents`. The root must be a real
directory path with no symlinks in it; on macOS, `/tmp` is a symlink.

```sh
vertrice-agents --help
vertrice-agents --root ~/agents-try init
vertrice-agents --root ~/agents-try task create me \
  '{"title":"Try the shared home","next_action":"Read this task","spent_when":"It reads back"}'
vertrice-agents --root ~/agents-try task list
vertrice-agents --root ~/agents-try task read ID   # ID from the list
vertrice-agents --root ~/agents-try find "shared home"
rm -r ~/agents-try
```

The task is a Markdown file under `~/agents-try/tasks/`, named by its ID; open
it in any editor. It starts as `maybe`, since nobody has committed to it.
`me` works from a plain terminal. From Pi's shell tool, use Pi's session ID
instead: Pi sets `VERTRICE_SESSION_ID`, and the CLI refuses any other name.

## Several sessions, one home

Writers take turns through a kernel lock on `tasks/.lock`. It is released the
moment its holder exits or is killed, so it never goes stale; a writer waits
up to three seconds for it. Claims on `in_progress` work lock only while their
session lives: see [Tasks](templates/tasks/README.md) and, for harnesses other
than Pi, [Harness notes](adapters/README.md).

`check` reports every problem it finds (a broken link; a missing `.gitignore`,
folder, `AGENTS.md` or `README.md`; an unreadable folder) and exits nonzero if
there was one. `find` searches the Markdown you wrote for the text you type,
ignoring case; it skips sessions, the archive, hidden and private folders,
symlinks and hard links. Neither is a privacy boundary.

Needs OpenBSD, macOS or another BSD (for the lock), Node, and a local filesystem.

## Harnesses and building further

- [Harness notes](adapters/README.md): what Pi, Crush, OpenCode and Hermes load
  and the checks still to run in each.
- [Open needs](SPEC.md): workflow needs this home does not serve yet, the rules
  every change keeps, and how to check each on OpenBSD.
- Maintainers: see the root `AGENTS.md` for the Pi copies of this code.
