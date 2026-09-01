# AGENTS.md

## Purpose

chezmoi source repo for macOS dotfiles across two machine profiles: `stackadapt` (work) and `personal`. Shared config lives in one tree; the differences are gated by templates on the `.machine` variable.

> [!WARNING]
> **This repo is public** (`github.com/j6nca/dotfiles`). Nothing work-identifying — internal hostnames, email addresses, model catalogues, credentials — may be committed to it. Anything of that kind goes in 1Password and is pulled in with `onepasswordRead` at apply time.

## Secrets: hard rules

Templates in this repo reference real credentials. Rendering a template resolves them.

**Never resolve a secret into your output.** In practice that means: do not run `op read`, `op item get`, `chezmoi diff`, `chezmoi apply`, or `chezmoi execute-template` against any file containing `onepasswordRead`. Each of these prints live credentials into the transcript. Leave them for the user to run.

**Never read an applied target that holds a resolved secret.** After `chezmoi apply`, these files contain plaintext credentials on disk:

- `~/.pi/agent/models.json` — provider API keys
- `~/.pi/agent/mcp.json` — MCP bearer token and endpoint
- `~/.talos/config` — cluster CA, cert and key
- `~/.gitconfig` — work email address

Read the **source template** instead. If you genuinely need to inspect an applied file's structure, parse it and print key names only, never values.

**To test a template, stub the secret calls out:**

```sh
sed -E 's/\{\{ onepasswordRead "[^"]*" \}\}/STUB/g' <file> > /tmp/t.tmpl
chezmoi execute-template < /tmp/t.tmpl | python3 -c 'import json,sys; json.load(sys.stdin); print("valid")'
```

This validates structure and both profile branches without touching 1Password. Render each profile by pointing `--config` at a throwaway TOML containing just the `[data]` block.

**Warn the user on any suspected plaintext secret.** While editing, if a file contains something that looks like a live credential, stop and tell them — naming the file and line, never quoting the value. Signals: `sk-`, `ghp_`, `AKIA`, `xoxb-`, `-----BEGIN … PRIVATE KEY-----`, a long opaque base64/hex run, or an `apiKey`/`password`/`token`/`secret`/`credential` key with a literal value rather than a template call. Treat it as a finding even in files outside this repo and even when it is already gitignored.

**If a secret does reach your output**, say so plainly and recommend rotating it. Do not quietly continue.

## Layout

```
.chezmoiroot           # "chezmoi" -> source dir is chezmoi/, not the repo root
chezmoi/               # the chezmoi source state
  .chezmoi.toml.tmpl   # rendered once per machine at `chezmoi init`; sets .machine
  dot_zshrc
  empty_dot_gitconfig.tmpl
  dot_pi/agent/{private_models.json,private_mcp.json,settings.json}.tmpl
  dot_talos/private_config.tmpl
  private_dot_config/{cmux,fastfetch,mise,opencode,zed}/…
```

## Conventions

- **Source-name prefixes are attributes, not part of the filename.** `dot_` → leading `.`; `private_` → mode `0600`; `empty_` → keep the file even when it renders empty; `.tmpl` → run through Go `text/template`. Any new file carrying a credential must get `private_`.
- **Profile branching** is `{{ if eq .machine "stackadapt" }} … {{ else }} … {{ end }}`. The value comes from `~/.config/chezmoi/chezmoi.toml`, not the repo. Valid values are `stackadapt` and `personal` — keep both branches in sync when adding config.
- **`.chezmoiignore` is a template too**, and its paths are *target* paths (`.talos`, not `dot_talos`). Prefer it over a template that renders to nothing.
- **1Password vaults split by profile**: `Stackadapt` for work secrets, `Personal` for homelab. Both accounts must be signed in on both machines, because the Talos config is currently managed on both profiles.
- **`sourceDir` in the machine config overrides `.chezmoiroot`.** If `chezmoi source-path` does not end in `/chezmoi`, the config is stale — fix it before anything else. Note that the README's `chezmoi init --apply --ssh j6nca/dotfiles` clones to `~/.local/share/chezmoi`, while `.chezmoi.toml.tmpl` hardcodes `~/projects/dotfiles/chezmoi`; on a fresh machine, clone to that path manually first.

## Verifying a change

```sh
chezmoi source-path                        # must end in /chezmoi
chezmoi execute-template '{{ .machine }}'  # stackadapt | personal
chezmoi managed                            # what would be written
```

Then hand off to the user for `chezmoi diff` and `chezmoi apply` — both resolve secrets, so neither is yours to run.
