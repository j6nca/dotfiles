---
description: Start and manage a coordinator/subagent workflow
argument-hint: "<goal>"
---

Use the coordinator/subagent workflow for this goal:

$ARGUMENTS

Rules:
- Read relevant project instructions and repository context before planning.
- Keep tasks small, specific, and independently reviewable.
- Use `/coordinate-start` for the goal and `/coordinate-add` for concrete tasks.
- Prefer user-level agents by default; use project-local agents only when explicitly requested and trusted.
- Do not dispatch subagents for secrets, credentials, destructive operations, or ambiguous work.
- Ask the user before making product decisions, destructive changes, or broadening scope.

Suggested flow:
1. Inspect enough context to understand the goal.
2. Start the coordinator workflow.
3. Add a concise task list.
4. Recommend the next dispatch command, or dispatch only if the user asked for execution.
5. Use `/coordinate-status` to summarize progress.

Output exactly these sections:

## Goal

Restate the goal in one sentence.

## Context checked

List files, docs, or commands inspected.

## Coordinator tasks

List the proposed `/coordinate-add ...` tasks.

## Suggested next command

Provide the next `/coordinate-*` command.

## Notes

List risks, assumptions, or `None`.
