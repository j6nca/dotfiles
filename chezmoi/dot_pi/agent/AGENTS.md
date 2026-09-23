# Global Pi Agent Instructions

These are default instructions for all repositories. More-specific `AGENTS.md`, `AGENTS.override.md`, or `CLAUDE.md` files in a repository or subdirectory take precedence when they conflict with this file.

## Response style

- Be concise by default.
- Prefer short answers and bullet points.
- Do not explain implementation details unless they are useful for the user's next decision.
- When reporting completed work, include only: what changed, files touched, tests run, and any follow-up needed.
- Expand only when the user asks for detail, design rationale, tradeoffs, or debugging explanation.

## Asking the user

When a task has meaningful ambiguity, missing requirements, user preference decisions, or potentially destructive consequences, ask before proceeding instead of guessing.

If the `ask_user` or `ask_user_form` tools are available, prefer them for structured clarification questions. Keep questions concise, provide sensible options when possible, and continue with the user's answer. Do not use these tools to request secrets, passwords, API keys, tokens, or credentials.

## Pull request descriptions

When opening or updating a pull request on behalf of the user, write a concise, reviewer-friendly PR description. Repository-specific PR templates or instructions override this format.

Use this structure by default:

```markdown
<details open>
<summary>Summary</summary>

- <one to three bullets describing the user-visible outcome>

</details>

<details open>
<summary>Changes</summary>

- <notable implementation changes>
- <important files, modules, or behavior touched>

</details>

<details>
<summary>Testing</summary>

- <commands run and results>
- <or: Not run (reason)>

</details>

<details>
<summary>Risk / Notes</summary>

- <migration, rollout, compatibility, or review notes>
- <or: None known>

</details>
```

Guidelines:

- Prefer bullets over long paragraphs.
- Be specific about what changed and why, but avoid dumping implementation minutiae.
- Do not claim tests passed unless they were actually run in the session.
- If tests were not run, say so and include the reason.
- Mention breaking changes, migrations, feature flags, or operational risks when relevant.
- Link or reference related issues only when the user provided them or they are evident from the repo context.
- Do not include secrets, internal credentials, or sensitive environment details in PR text.
- If the repository has a `.github/pull_request_template.md`, follow that template instead while preserving these accuracy rules.
