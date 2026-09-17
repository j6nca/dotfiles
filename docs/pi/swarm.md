# Pi swarm workflow

Swarm is a guided, single-session workflow for planning, implementing, testing,
reviewing, and summarizing work in Pi. It is **not** a parallel or autonomous
multi-agent system: each role runs in the same conversation, and you control task
completion and phase transitions.

## Setup

The chezmoi source files are:

- [Orchestration extension](../../chezmoi/dot_pi/agent/extensions/swarm.ts)
- [Role prompt templates](../../chezmoi/dot_pi/agent/prompts/)

Apply your dotfiles yourself, then run `/reload` in Pi. The extension belongs in
`~/.pi/agent/extensions/swarm.ts`, and the five `swarm-*.md` templates belong in
`~/.pi/agent/prompts/`.

**Security:** chezmoi diff/apply may resolve credentials through 1Password. Do not
paste their output into chat or commit rendered private configuration. Agents
should not run those commands for this repo.

## Quick start

Run each command separately inside Pi; wait for each role's response and assess
its output before advancing.

1. Start with a concrete goal:

   ```text
   /swarm-start Add usage documentation for a local helper
   ```

   This stores the goal and sends the planner prompt. Review the plan first.

2. Add small tasks manually from the plan; planner output is not imported:

   ```text
   /swarm-add Write the helper's usage documentation
   /swarm-add Check examples against the implementation
   ```

3. Start the first task:

   ```text
   /swarm-next
   ```

   It becomes `in_progress`, and Pi receives the implementer prompt for that task.
   After inspecting the work, mark it done and start the next task:

   ```text
   /swarm-done
   /swarm-next
   ```

4. After the second task is finished:

   ```text
   /swarm-done
   /swarm-next
   ```

   With no pending tasks, this starts testing. Assess the test results, then run
   `/swarm-next` once for each subsequent phase:

   | Current phase | Next `/swarm-next` action |
   | --- | --- |
   | `testing` | Start review |
   | `reviewing` | Start summary |
   | `summarizing` | Mark the workflow `done` |

5. Check the final state:

   ```text
   /swarm-status
   ```

Do not advance just because a role finished responding. Fix failures or record
blockers first. Phase advancement does not validate results automatically.

## Orchestration commands

`<...>` denotes a required argument; `[...]` denotes an optional argument.

| Command | Behavior |
| --- | --- |
| `/swarm-start <goal>` | Replace the current swarm with a new goal and empty task list; send the planner prompt. **No replacement confirmation.** |
| `/swarm-add <task>` | Add a `todo` task with an incrementing numeric ID. |
| `/swarm-status` | Show the goal, phase, tasks, and notes. Close the TUI view with `q` or Escape. |
| `/swarm-next` | Start the first `todo` task, or advance to the next role when none remain. Refuses while any task is `in_progress`, or when the task list is empty. |
| `/swarm-done [id] [note]` | Mark the specified task done, or the current task if no ID is supplied. Does not advance the phase. |
| `/swarm-block [id] <reason>` | Mark the specified/current task blocked and save the reason. |
| `/swarm-reset` | Clear the active swarm state, with confirmation when UI is available. Does not undo code changes or erase conversation history. |

Examples:

```text
/swarm-done 1 Documentation verified
/swarm-block 2 Waiting for a decision on supported platforms
```

## Role templates versus tracked state

These templates can also be invoked directly:

| Template | Purpose |
| --- | --- |
| `/swarm-plan <goal>` | Inspect context and propose small, verifiable tasks. |
| `/swarm-execute <task>` | Implement a focused task. Always supply the task text. |
| `/swarm-test [focus]` | Run safe, targeted validation and report coverage gaps. |
| `/swarm-review [focus]` | Review correctness, maintainability, and safety. |
| `/swarm-summary [focus]` | Summarize work, validation, and remaining concerns. |

**Templates do not update swarm state.** For example, `/swarm-review` requests a
review but does not set the tracked phase to `reviewing`. Use `/swarm-next` for
tracked transitions and `/swarm-done` for task completion.

The usual phase order is:

```text
planning → executing → testing → reviewing → summarizing → done
```

Tasks have separate statuses: `todo`, `in_progress`, `done`, and `blocked`.
Adding a task during review or after completion is allowed; the next
`/swarm-next` starts that task and returns the workflow to `executing`.

## Blocked tasks and current limitations

- Blocked tasks are skipped by `/swarm-next`. When only done/blocked tasks remain,
  the workflow can proceed through testing, review, summary, and even `done`.
  **A done phase does not guarantee every task was completed.** Check task counts
  and report unresolved blockers in the summary.
- There is no unblock/requeue, edit, delete, import, or direct phase-setting
  command. Add a follow-up task for remaining work. Only mark the original
  blocked task done once it really is resolved.
- Role output is not parsed into task updates or pass/fail gates.
- Role instructions are prompts, not enforced tool permissions or sandboxes.
- Wait for the agent to finish before advancing. When busy, routed prompts are
  queued as follow-ups, but the tracked state changes immediately.

## Persistence

State is stored as `swarm-state` custom entries in the Pi session and reconstructed
from the active branch on session start and tree navigation. Reloading/resuming
that session should restore its state; a fresh session starts without a swarm.
Tree navigation can restore an earlier state. This is not a shared, repository-wide
task database.

## Troubleshooting

- **Unknown command:** apply the source changes yourself, then `/reload`. Verify
  both the extension and all five role templates are installed.
- **No active swarm:** run `/swarm-start <goal>` or resume the session containing
  the existing swarm.
- **Cannot advance:** use `/swarm-status`; finish/block the in-progress task, or
  add tasks if the list is empty.
- **Task finished, phase unchanged:** expected; run `/swarm-next` after marking
  it done.
- **Empty implementer task:** use `/swarm-next` to route a tracked task, or supply
  explicit text to `/swarm-execute`.
- **Old commands or duplicate behavior after a rename:** inspect installed
  extension/template filenames for stale copies (for example, old `team-*`
  templates). Removing a source file does not necessarily remove an already
  installed unmanaged target. Remove only confirmed obsolete copies, then reload.
