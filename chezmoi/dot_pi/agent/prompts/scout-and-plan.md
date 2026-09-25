---
description: Scout repository context, then produce an implementation plan
argument-hint: "<goal>"
---

Scout and plan this goal:

$ARGUMENTS

Rules:
- Do not edit files.
- Inspect relevant files, docs, and existing conventions before planning.
- Use read-only commands only.
- If using coordinator chaining, prefer `/coordinate-chain <task-id> scout planner`.
- Ask clarifying questions if the goal is ambiguous or has important tradeoffs.
- Keep the plan small, focused, and easy to review.
- Do not run commands that may expose secrets or credentials.

Output exactly these sections:

## Goal

Restate the goal in one or two sentences.

## Scout findings

Summarize relevant files, conventions, constraints, and risks.

## Plan

Use a numbered list of small implementation tasks.

## Verification strategy

List focused checks or manual validation steps.

## Open questions

List questions for the user, or `None`.
