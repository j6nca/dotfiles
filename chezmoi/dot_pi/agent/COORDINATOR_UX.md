# Pi coordinator/subagent workflow

Status: implemented workflow reference.

## Purpose

The coordinator/subagent workflow delegates focused work to isolated Pi subprocesses while the parent session keeps the goal, task list, status, and handoff context. It is separate from the lightweight `/swarm-*` workflow; `/swarm-next` remains manual and unchanged.

Use it when a task benefits from isolated context, a read-only scout, a planner, an implementation worker, or a reviewer.

## Trust model

Default behavior is conservative:

- User-level agents from `~/.pi/agent/agents/*.md` are used by default.
- Project-local agents from `.pi/agents/*.md` are opt-in only.
- Project-local agents require an explicit `--project` or `--both` command flag, or `agentScope: "project" | "both"` for the `subagent` tool.
- Project-local agent use requires an interactive trust confirmation.
- Non-UI project-local use is denied.
- Subagents run isolated via `pi --mode json -p --no-session`.
- Subagent output and stderr are capped before returning to the parent session.
- Temporary system-prompt files are created with restrictive permissions and cleaned up.
- Do not delegate secrets, credentials, destructive operations, or ambiguous product decisions to subagents.

## Agent file format

Agents are Markdown files with frontmatter plus a system prompt.

User-level agents:

```text
~/.pi/agent/agents/*.md
```

Project-local agents:

```text
.pi/agents/*.md
```

Example:

```markdown
---
name: scout
description: Fast read-only repository reconnaissance
tools: read, grep, find, ls
model: optional-model-name
---

You are a read-only reconnaissance agent.

Return concise findings with file paths and risks. Do not edit files.
```

Fields:

- `name` required: command/tool-visible agent name.
- `description` required: shown by `/agents`.
- `tools` optional: comma-separated string or array. Omit to use Pi defaults.
- `model` optional: model override for the subagent process.

Malformed or incomplete agent files are skipped instead of crashing discovery.

## Commands

### Agent discovery

```text
/agents
/agents user
/agents project
/agents both
```

Lists discovered agents, their source, model override/default, and tool scope/default. `project` and `both` trigger project-local trust confirmation.

### Coordinator state

```text
/coordinate-start <goal>
/coordinate-add <task>
/coordinate-status
/coordinate-done [task-id] [summary]
/coordinate-block [task-id] <reason>
/coordinate-reset
```

Typical use:

```text
/coordinate-start improve the widget rendering path
/coordinate-add inspect the existing widget implementation
/coordinate-add identify minimal code changes
/coordinate-status
```

### Single dispatch

```text
/coordinate-dispatch <task-id> <agent> [--project|--both]
```

Example:

```text
/coordinate-dispatch 1 scout
```

Behavior:

- Validates the task and agent.
- Marks the task `running`.
- Runs the selected agent in an isolated Pi subprocess.
- Stores a result summary on success.
- Stores failure diagnostics on subprocess failure or nonzero exit.

### Bounded parallel dispatch

```text
/coordinate-dispatch-many <agent> [count<=4] [--project|--both]
```

Example:

```text
/coordinate-dispatch-many scout 2
```

Behavior:

- Selects up to four `todo` tasks.
- Runs with conservative concurrency of two.
- Updates each task independently.
- Partial failures do not prevent other tasks from completing.

### Chained workflows

```text
/coordinate-chain <task-id> scout planner [--project|--both]
/coordinate-chain <task-id> worker reviewer [--project|--both]
/coordinate-chain <task-id> worker reviewer worker [--project|--both]
```

Examples:

```text
/coordinate-chain 1 scout planner
/coordinate-chain 2 worker reviewer
/coordinate-chain 3 worker reviewer worker
```

Behavior:

- Only the allowlisted chains above are accepted.
- Each step receives the original task plus the previous step's summarized output.
- The task is marked `done` only when all chain steps succeed.
- The task is marked `failed` at the first failing step.

### Swarm bridge

```text
/swarm-dispatch <task-id> <agent> [--project|--both]
```

Example:

```text
/swarm-dispatch 1 scout
```

Behavior:

- Leaves `/swarm-next` unchanged.
- Creates a one-task coordinator state from the selected swarm task.
- Marks the swarm task `in_progress`.
- Forwards to `/coordinate-dispatch 1 <agent>`.
- Swarm task completion remains manual with `/swarm-done <task-id>`.

## Model-callable tool

### `subagent`

Parameters:

- `agent`: selected agent name.
- `task`: focused task text.
- `cwd`: optional working directory, defaults to the current workspace.
- `agentScope`: optional `user`, `project`, or `both`; defaults to `user`.

Use this when the parent model needs to delegate a single focused task without manually using coordinator commands. Do not use it for secrets, credentials, destructive operations, or unclear tasks.

## Prompt templates

Common prompt templates are available globally:

```text
/coordinate <goal>
/scout-and-plan <goal>
/implement-with-review <task>
```

These expand into structured prompts for common coordinator/subagent flows.

## Limitations

- `/coordinate-add-file` is currently a placeholder.
- `/coordinate-next` is currently a placeholder.
- Runtime subagent execution requires Pi to be applied/reloaded before testing new extension changes.
- Coordinator dispatch records summaries, not full uncapped subprocess transcripts.
- Parallel dispatch is intentionally limited to four tasks and concurrency two.
- Chained workflows are intentionally allowlisted; arbitrary chains are not accepted.
- The swarm bridge does not automatically mark the source swarm task done after coordinator success.
- Project-local agents are trust-gated but still execute repository-provided prompts; only use them in repositories you trust.

## Smoke tests

After applying dotfiles and reloading Pi, use safe toy tasks that do not touch secrets.

### Agent discovery

```text
/agents
/agents project
/agents both
```

Expected:

- `/agents` lists user-level agents.
- Project/both scope asks for trust confirmation when project agents exist or may be loaded.

### Coordinator basics

```text
/coordinate-start test coordinator workflow
/coordinate-add inspect repository layout without editing
/coordinate-status
```

Expected:

- Coordinator state is created.
- One `todo` task appears.

### Single dispatch

```text
/coordinate-dispatch 1 scout
/coordinate-status
```

Expected:

- Task moves through `running` to `done` or `failed`.
- Status shows assigned agent and result/failure summary.

### Bounded parallel dispatch

```text
/coordinate-start test parallel dispatch
/coordinate-add inspect top-level files
/coordinate-add inspect prompt templates
/coordinate-dispatch-many scout 2
/coordinate-status
```

Expected:

- Two tasks are dispatched with bounded concurrency.
- Partial success/failure is reflected per task.

### Chained workflow

```text
/coordinate-start test chain dispatch
/coordinate-add inspect and plan a no-op documentation cleanup
/coordinate-chain 1 scout planner
/coordinate-status
```

Expected:

- Scout runs first, planner runs second with scout output.
- Task is marked done only if both steps succeed.

### Swarm bridge

```text
/swarm-start test swarm bridge
/swarm-add inspect repository layout without editing
/swarm-dispatch 1 scout
/coordinate-status
/swarm-status
```

Expected:

- A coordinator task is created from swarm task #1.
- The swarm task is marked `in_progress`.
- `/swarm-next` behavior remains unchanged.

### Failure cases

```text
/coordinate-dispatch 999 scout
/coordinate-dispatch 1 missing-agent
/coordinate-chain 1 scout worker
/coordinate-dispatch-many scout 5
```

Expected:

- Missing task and missing agent report clear errors.
- Non-allowlisted chain is rejected.
- Parallel dispatch count above the limit is rejected.
