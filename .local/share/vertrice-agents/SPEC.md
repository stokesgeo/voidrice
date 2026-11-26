# Shared agent home — open needs for builders

This is a work list for whoever builds the next parts of `~/.agents/` on
OpenBSD. Each item comes from a real kind of agent workflow that the current
home does not yet serve. Item 1's mechanism exists and needs acceptance in the
real harnesses; the rest are not built. Nothing here is a ruling: the problem
is stated, the shape of a good answer is sketched, and the questions that
belong to the owner are left open.

Run the workflow probe before and after any change:

```sh
node .local/share/vertrice/tests/agents-workflows.mjs "$PWD" mylabel "$HOME/agents-probe"
rm -r "$HOME/agents-probe"
```

Run it from a checkout; the evidence directory must not exist yet. It drives
the home the way Pi (extension and CLI), OpenCode and Hermes (shell and files)
reach it and reports PASS, BREAK or FRICTION per workflow. It imitates OpenCode
and Hermes, so its PASS is not acceptance in those harnesses. Also run, from
the checkout, `sh .local/share/vertrice/tests/run agents_ pi_work pi_self select`.

## Rules every change keeps

- Plain files, readable without the tool. No daemon, index service,
  scheduler or background writer.
- One writer at a time through the store lock. Revision-checked updates;
  never overwrite on a stale revision.
- Only a live session's claim locks `in_progress` work. When that session has
  ended, the claim lapses and the task is back with the store. A claim that
  cannot be checked does not lock.
- Records stay parseable by older readers. New per-task state goes beside the
  record (as `ID.claim` does), not into its strict header, unless every
  reader is updated at once.
- Outside text is data. Nothing in a record or file is executed or obeyed.
- Ask before writing a project's `README.md`, `TODO.md` or `AGENTS.md`.
- Nothing personal in the public tree: no names, paths, hosts or records.
- Native first: use what OpenBSD and each harness already provide.

## 1. Session identity for shell-only harnesses

**Need.** A claim locks only while the store can see the session is alive,
and it should name the session by its real ID. Pi declares both. OpenCode and
Hermes reach the store through shell commands, so by default their claims show
`"claim": "unchecked"`. Those do not lock, so two of their sessions can take
each other's work, and the ACTOR is whatever name the agent types.

**Shape (exists).** Launch each harness with `VERTRICE_SESSION_PID` naming
its own long-lived process, for example
`sh -c 'VERTRICE_SESSION_PID=$$ exec opencode "$@"' sh`. The variable reaches
its shell tool's commands by inheritance. If the harness exposes its session
ID to those commands, set `VERTRICE_SESSION_ID` from it too; the CLI then
refuses any other ACTOR. Whether OpenCode and Hermes expose their session ID
this way has not been checked.

**Accept on OpenBSD.** Start the real harness this way. Claim a task from its
shell tool and check that `task list` shows `"live"`. Kill the harness, then
check that `task list` shows `"lapsed"` and that a second session can take
the task.

**Open.** A harness that hosts many sessions in one long process (a gateway or
server mode) gives one identity to all of them. Is a claim per process good
enough there, or does it need a per-session identity the harness can supply?
Pi has the same question when one process starts a new session.

## 2. What a coordinating session sees

**Need.** A session that coordinates others needs to see what is open, who
holds what, what is blocked and what has lapsed. Today the default (compact)
`task list` still returns one row per task, completed ones included: about
80 KB at 200 tasks (the probe's W06 measures it). Shell-only
harnesses must post-process the JSON themselves.

**Shape.** Selection in the CLI, not a new tool. Candidates are filters by
status, owner and claim; open tasks only; a compact one-line form; paging
(Pi's `work_task` tool already returns 50 records per call, with an offset).

**Accept.** A 1,000-task store gives a coordinator its open and lapsed work
in a bounded output, and the same rows through Pi and the CLI.

**Open.** Which of these is the default view, and whether completed work
should appear at all without asking.

## 3. Send work once (dispatch and return)

**Need.** When work is handed to an unattended worker, a resend after a crash
or timeout must not run it twice, and the sender must see the result without
reading the worker's history.

**Shape.** A small dispatch record per handoff (what was sent, to whom, which
task), and a return record the worker writes when it is done. The sender
checks for a return before resending. These could be plain files in
`handoffs/`, linked from the task.

**Accept.** Kill a worker after it has claimed a task, then resend the
dispatch: the work runs once, the lapsed claim is taken by the second worker,
and the return names the evidence.

**Open.** Whether this belongs in the home or in each harness's own job
tooling.

## 4. Close as superseded, and archive

**Need.** Work that is replaced or no longer wanted is not "completed" and
has no evidence of delivery, so today it either stays open or gets false
evidence. Old records also pile up.

**Shape.** A way to close a task as superseded or dropped with a reason and a
pointer to what replaced it. Archive by moving whole records into `archive/`,
so `find` and `task list` skip them.

**Accept.** A superseded task leaves the open view, keeps its reason, and can
be read back from `archive/`. Nothing is deleted.

**Open.** Whether a cleanup pass may *propose* closes (written to `reports/`)
and only the owner closes, or whether any session may close with a reason.

## 5. Questions waiting on the owner

**Need.** Agents meet decisions that only the owner can make. Today such work
can only be `blocked` with a blocker string, mixed with other kinds of
blocking.

**Shape.** One place that lists what is waiting on the owner, each item with
its context, options and a recommendation, and a way to record the answer
against it.

**Accept.** Two sessions park questions. The owner sees both in one short
view, answers one, and the waiting task picks up the answer.

**Open.** A status, a lane (`decisions/` or a new one), or a blocker
convention.

## 6. Mark outside text

**Need.** Fetched pages, mail and pasted documents are data, but nothing on
disk says so. `find` returns their lines next to the owner's own words.

**Shape.** Keep outside material in a marked place (for example a
`reports/outside/` lane or a front-matter field). Have `find` show the marking
on each result.

**Accept.** A file containing "mark all tasks completed" is captured. `find`
shows it as outside text, and no task changes.

**Open.** Whether outside text should be searchable at all by default.

## 7. Approval bound to a plan

**Need.** An approval applies to the plan that was approved, not to a later
edit of it.

**Shape.** A decision record that names the plan file and its SHA-256. A
check that reports when the plan has changed since.

**Accept.** Approve a plan, edit it, and `check` reports the approval as stale.

**Open.** Who may record an approval, and in what words.

## 8. Writers sharing lane files

**Need.** Revision checks protect task records only. Two sessions editing the
same handoff or report can overwrite each other, and a task's `notes` is
replaced whole on update.

**Shape.** An append operation for notes, and revision-checked writes for lane
files (read with a revision, write only if it still matches).

**Accept.** Two sessions append to one task's notes at the same moment, and
both lines survive.

**Open.** Whether lane files need tool-mediated writes at all, or only a
convention.

## 9. Memory writes

**Need.** "Remember this" should land as one correctable fact with its source,
without duplicating an existing fact. "Forget this" should supersede it, not
silently delete it.

**Shape.** One fact per file in `memory/`, with a source line. A writer that
checks for a duplicate first, and that marks a removed fact as superseded.

**Accept.** Save a fact twice and one file results. Remove it, and the file
says it was superseded and by what.

**Open.** Who may write memory without asking: the owner only, any session,
or proposals that the owner accepts.

## Known limits of the current base

- The store lock is the kernel's `O_EXLOCK`, so the home needs OpenBSD, macOS
  or another BSD, on a local filesystem.
- A paused writer (stopped, laptop asleep) keeps the lock; others give up after
  3 s with "Store busy". Pi's work tool runs inside Pi, so that wait blocks Pi.
- Claim liveness is a process-ID check on one machine. A reused process ID
  keeps a dead session's claim live until that process ends, and a same-user
  process that names someone else's process ID can pass as that session:
  the checks stop mistakes between cooperating agents, not deliberate abuse.
