---
name: pi-messenger-crew
description: Orchestrator reference for pi-messenger Crew planning, task management, configuration, and agent coordination. Crew workers already have the pi_messenger actions they need in crew-worker.md.
---

# Pi-Messenger Crew Skill

## Portable integration

Use the current native runtime and selected session model. Start with one worker,
explicit work requests, and no overlapping coordinator mutations. Workers cannot
delegate. Rendering does not authorize work. Native Pi owns project trust and
action approvals; review project resources through its trust flow. This package
does not grant trust or provide a sandbox. Return privilege and sign-in requests
to the coordinator. Worker completion is not independent verification.

> Crew workers do not need this skill. `crew-worker.md` already contains every `pi_messenger` action workers need for task execution.
>
> Orchestrators and humans can use this as the full reference for planning, task management, configuration, and Crew internals.

Use pi-messenger for multi-agent coordination and Crew task orchestration.

## Quick Reference

### Join or Leave the Mesh
```typescript
pi_messenger({ action: "join" })
pi_messenger({ action: "leave" })
```

### Check Status
```typescript
pi_messenger({ action: "status" })
pi_messenger({ action: "list" })  // See other agents
pi_messenger({ action: "feed" })  // Activity feed
```

## Crew Workflow

### 1. Check Crew Agents
```typescript
pi_messenger({ action: "crew.agents" })  // Verify 4 agents: worker, planner, reviewer, plan-sync
pi_messenger({ action: "crew.install" }) // Informational: shows discovered sources
```

### 2. Plan from PRD
```typescript
// Auto-discover PRD.md in current directory
pi_messenger({ action: "plan", autoWork: false })

// Or specify path
pi_messenger({ action: "plan", autoWork: false, prd: "path/to/PRD.md" })

// Or pass an inline prompt (no PRD file needed)
pi_messenger({ action: "plan", autoWork: false, prompt: "Scan the codebase for bugs focusing on error handling" })

// To change an existing backlog, inspect task.show then use task.revise/task.revise-tree.
// Do not call plan on a durable backlog: upstream re-planning deletes existing tasks.

// Steer first-time planning (prompt injected into progress notes before planner runs)
pi_messenger({ action: "plan", autoWork: false, prd: "docs/PRD.md", prompt: "focus on backend first" })

// Inspect the plan before any explicit work call; autoWork is an action argument.

// Cancel active or stale planning
pi_messenger({ action: "plan.cancel" })
```

The `in_progress` rejection is not a preservation guarantee: re-planning can
delete pending/done backlog data. Use revision actions for scoped changes, inspect
their effects and preserve evidence first. First-time steering goes into
`planning-progress.md` for the planner. No overlapping mutations during a run.

### Optional: Activate Team Context
```typescript
pi_messenger({ action: "team.setup", name: "migration-squad" })
pi_messenger({ action: "team.setup", name: "review-squad" })
pi_messenger({ action: "team.setup", name: "research-squad", message: "Research first, then plan the implementation." })
pi_messenger({ action: "team.memory.note", type: "decision", message: "Use cursor pagination for task history" })
pi_messenger({ action: "team.roles" })
pi_messenger({ action: "team.status" })
```

Team is optional. Use `team.setup` for first-run setup: it activates a profile, saves editable JSON if needed, creates a starter charter when missing, and returns next steps. Crew remains the execution engine. Team role names follow the packaged `pi-subagents` vocabulary where possible (`context-builder`, `delegate`, `oracle`, `planner`, `researcher`, `reviewer`, `scout`, `worker`). `pi-messenger` may read subagent markdown metadata from disk when present, but it does not require or invoke subagents. Active Team profiles let the planner tag tasks with `role` and `riskLabels`, then inject role, charter, and memory context into worker prompts. High-risk tasks wait for `task.approve`; `task.reject` records feedback and rejected tasks surface `task.revise` / `task.revise-tree` next steps.

### 3. Work on Tasks
```typescript
// Single explicit wave, within this integration
pi_messenger({ action: "work", concurrency: 1 })
// Model overrides are optional: use only an explicitly reviewed available provider/model.
```

### 4. Task Management
```typescript
pi_messenger({ action: "task.list" })
pi_messenger({ action: "task.ready" })  // Tasks with no pending deps
pi_messenger({ action: "task.show", id: "task-1" })
pi_messenger({ action: "task.start", id: "task-1" })
pi_messenger({ action: "task.progress", id: "task-1", message: "Implemented auth middleware" })
pi_messenger({ action: "task.done", id: "task-1", summary: "What was done" })
pi_messenger({ action: "task.block", id: "task-1", reason: "Why blocked" })
pi_messenger({ action: "task.unblock", id: "task-1" })
pi_messenger({ action: "task.reset", id: "task-1" })
pi_messenger({ action: "task.reset", id: "task-1", cascade: true })  // Reset dependents too

// Create tasks manually
pi_messenger({ action: "task.create", title: "Implement auth", content: "Detailed spec...", dependsOn: ["task-1"] })
pi_messenger({ action: "task.create", title: "Change auth API", role: "worker", riskLabels: ["auth", "api-contract"] })
pi_messenger({ action: "task.approve", id: "task-2" })

// Split a task into subtasks (two-phase: inspect then execute)
pi_messenger({ action: "task.split", id: "task-3" })  // Inspect: shows spec, deps, dependents
pi_messenger({ action: "task.split", id: "task-3", subtasks: [
  { title: "Subtask A", content: "..." },
  { title: "Subtask B", content: "..." }
] })  // Execute: creates subtasks, parent becomes milestone
```

### 5. Task Revision
```typescript
// Revise a single task's spec (planner rewrites based on your prompt)
pi_messenger({ action: "task.revise", id: "task-3", prompt: "add error handling for network failures" })

// Revise a task and all its transitive dependents (subtree revision)
// Planner sees the full subtree and can add/remove/modify tasks
pi_messenger({ action: "task.revise-tree", id: "task-3", prompt: "split this into separate API and CLI tasks" })
```

Single revision rewrites one task's spec. Tree revision rewrites an entire subtree — the planner can modify existing tasks, add new ones (capped at 2x subtree size), remove pending ones, and rewire dependencies. Done tasks in the subtree are preserved; revisable tasks reset to `todo`.

Both revisions are mutually exclusive (only one revision at a time).

### 6. Review
```typescript
// Review a task implementation
pi_messenger({ action: "review", target: "task-1" })

// Review the overall plan
pi_messenger({ action: "review", target: "plan", type: "plan" })
```

## Overlay Keybindings

The Crew overlay (accessible via `/messenger` then tab to Crew) supports these keybindings:

**Global:** `[+/-]` Adjust worker concurrency (1-10), `[c]` Cancel active planning, `[Esc]` Close/back

**Task list view:** `[↑/↓]` Navigate, `[Enter]` Detail view

**Task actions (list and detail):**
- `[s]` Start task (todo only)
- `[r]` Reset task, `[R]` Cascade reset (reset + all dependents)
- `[u]` Unblock task (blocked only)
- `[b]` Block with reason (in_progress only)
- `[q]` Stop worker (in_progress with live worker)
- `[m]` Message worker (in_progress with live worker)
- `[S]` Split task (shows hint with command)
- `[p]` Revise task spec, `[P]` Revise subtree (not in_progress, not milestone)
- `[x]` Delete task (not while worker is active)
- `[←/→]` Navigate between tasks in detail view

## File Coordination

```typescript
// Reserve files before editing
pi_messenger({ action: "reserve", paths: ["src/index.ts", "src/types.ts"], reason: "Working on core" })

// Release when done
pi_messenger({ action: "release" })
```

## Agent Communication

```typescript
// Rename yourself
pi_messenger({ action: "rename", name: "MyAgentName" })

// Send message to specific agent
pi_messenger({ action: "send", to: "OtherAgent", message: "Hello!" })

// Broadcast to all
pi_messenger({ action: "broadcast", message: "Announcement" })
```

Messages are logged to the feed and visible in the overlay. DMs interrupt only the target agent (delivered as steering); broadcasts interrupt all agents.

## Typical Crew Session

```typescript
// 1. Join
pi_messenger({ action: "join" })

// 2. Plan (spawns planner agent)
pi_messenger({ action: "plan", autoWork: false })

// 3. Check tasks
pi_messenger({ action: "task.list" })

// 4. Work
pi_messenger({ action: "work", concurrency: 1 })

// 5. Status
pi_messenger({ action: "status" })
```

## Data Storage

Crew stores data in `.pi/messenger/crew/`:
```
.pi/messenger/crew/
├── config.json              # Project config (concurrency, models, coordination, etc.)
├── plan.json                # Plan metadata
├── planning-progress.md     # Planner output log (Notes section for steering)
├── planning-outline.md      # Latest plan outline
├── planning-state.json      # Current planning phase/pass
├── agents/                  # Optional: project-level crew agent overrides
│   └── crew-worker.md
├── tasks/
│   ├── task-1.json          # Task metadata (status, deps, summary)
│   ├── task-1.md            # Task spec (planner-generated)
│   ├── task-1.progress.md   # Worker progress log
│   └── ...
├── blocks/
│   └── task-N.md            # Block context
└── artifacts/               # Debug artifacts (agent input/output)
```

Team stores active project state in `.pi/messenger/team/`:
```
.pi/messenger/team/
├── team.json        # Active team/profile
├── charter.md       # Project team charter
├── memory.jsonl     # Structured memory source of truth
├── decisions.md     # Human-readable memory rollups
├── interfaces.md
├── risks.md
└── handoffs.md
```

Reusable profiles are JSON files under the generated instance's explicit `teamProfileDir`.

The activity feed lives at `.pi/messenger/feed.jsonl` (project-scoped, shared across all agents in the project).

The four packaged agents have no model frontmatter default. This integration
uses the current qualified host session provider/model unless a task, request,
Team role or Crew config explicitly overrides it (priority below). No Anthropic
model is selected by default. Check actual provider availability before overrides.

To customize a project agent, copy the corresponding file from this immutable
package's `crew/agents/` into `.pi/messenger/crew/agents/`; project agents win by
name. Review project inputs through native trust. Optional `thinking`
frontmatter supports off/minimal/low/medium/high/xhigh; config `thinking.<role>`
overrides it. A model's `:level` suffix takes precedence over that setting.

## Configuration

The generated native profile's `pi-messenger.json` holds Crew keys under `crew`.
Project `.pi/messenger/crew/config.json` contains those keys directly and wins
by deep merge. Main settings.messenger.crew is not Crew config. Initial profile:

```json
{
  "crew": {
    "concurrency": { "workers": 1, "max": 1 },
    "dependencies": "strict",
    "coordination": "minimal"
  }
}
```

Leave `models` unset to inherit the selected session model. Explicit overrides
accept a qualified `provider/model` (and optional `:level`), not a shipped model
recommendation. `plan autoWork:false` and `work concurrency:1` must still be
supplied on each action; they are not persistent configuration keys.

### Key Settings

| Setting | Integration value / behavior |
|---------|------------------------------|
| `concurrency.workers`, `concurrency.max` | `1`, `1` |
| `dependencies` | `strict` |
| `coordination` | `minimal` |
| `models.worker/planner/reviewer/analyst` | Unset; qualified session fallback |
| `thinking.<role>` | Optional override; otherwise frontmatter |
| `planning.maxPasses` | Upstream default `1` |
| `work.maxWaves` | Upstream autonomous limit `50`; not an instruction to enable it |
| `work.maxAttemptsPerTask` | Upstream default `5` |
| `work.stopOnBlock` | Upstream default `false` |
| `work.shutdownGracePeriodMs` | Upstream default `30000` |
| `work.env` | Default `{}`; do not override agent directory or pass secrets |

### Coordination Levels

Controls how much workers communicate during execution:

- **`none`**: No coordination instructions. Workers just execute their task.
- **`minimal`**: Check reservations before editing files. Message if conflicts.
- **`moderate`**: Announce start/completion via broadcast. Check reservations. Ask about unclear dependencies.
- **`chatty`** (upstream default; integration selects `minimal`): All of moderate, plus: DM peers whose tasks overlap, share progress on interface changes, respond to incoming messages, claim next task after completion.

At `moderate` and `chatty`, workers also receive recent activity context and concurrent task info in their prompts.

### Model Override Priority

Worker model is resolved with this priority (highest wins):
1. Per-task `model` field on the task object
2. Per-wave `model` param on the work call
3. Team role model when present
4. Config-level `crew.models.worker`
5. Host session model
6. Agent `.md` frontmatter `model` field

### Graceful Shutdown

When you cancel a work run (Ctrl+C), workers receive a shutdown sequence:
1. Inbox message asking the worker to stop, release reservations, and exit
2. Wait `shutdownGracePeriodMs` (default 30s) for clean exit
3. SIGTERM if still running, wait 5s
4. SIGKILL if still running

Tasks from gracefully shutdown workers reset to `todo` for retry on the next wave. Crashed workers (non-graceful exit) block the task in autonomous mode to prevent retry loops.
