---
description: Implement a focused change, then prepare reviewer handoff
argument-hint: "<task>"
---

Implement this focused task and prepare it for review:

$ARGUMENTS

Rules:
- Implement only the requested task or one coherent slice.
- Read relevant files before editing them.
- Keep changes minimal, focused, and easy to review.
- Follow project instructions and existing conventions.
- Ask before broadening scope or making destructive changes.
- Run focused checks when safe and appropriate.
- Do not run commands that may expose secrets or credentials.
- If using coordinator chaining, prefer `/coordinate-chain <task-id> worker reviewer` or `/coordinate-chain <task-id> worker reviewer worker`.

Output exactly these sections when finished:

## Summary

Briefly describe what changed.

## Files changed

List changed files and why each changed.

## Verification

List checks run and results. If not run, explain why.

## Reviewer handoff

List what the reviewer should focus on.

## Remaining work

List follow-ups, blockers, or `None`.
