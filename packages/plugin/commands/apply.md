---
description: Replay a saved recipe through provider setup and optional wiring; inspect partial results. Usage — /stack:apply <recipe-id>
---

Call `stack_apply` via the ashlr-stack MCP server with the recipe id the user provided.

Invocation:

```
stack_apply { recipe_id: "<user's input>", no_wire: false }
```

What `stack_apply` does:
- If `.stack.toml` is absent, attempts config-only init with `--noInteractive --noProvision`.
- Runs the CLI provider setup loop for recipe entries one at a time; adapters create or attach resources according to their implementation. On partial failure, the CLI can attempt cleanup of added local config, MCP entries and named vault slots. Headless cleanup can keep secrets; this is not guaranteed upstream-resource deletion. The CLI `--noRollback` flag disables this multi-service cleanup attempt.
- After at least one successful setup, reads secret names from `phantom list --json` (never values) and reports which declared secrets are in the vault and which are missing. It never writes to the vault; `stack add` or `phantom add <NAME>` stores real values. If the vault can't be listed, those providers are reported as skipped.
- Writes optional commented webhook stub files for supported recipe providers; the app must implement and verify their handlers.
- Attempts credential, MCP and split-config writes during setup. These effects are not atomic and failures can leave partial state. The final doctor call is informational and does not establish application acceptance.

If the user requests skipping optional wiring (e.g. `/stack:apply rec_xxx --noWire`), call with `no_wire: true`. The wrapper forwards the CLI flag `--noWire`; provider setup, credential storage and config writes still occur. This is not a dry run. Confirm the requested recipe and provider effects before calling.

Read the returned text, including failures and skips, and summarize:
- Which providers were added
- Any providers that were skipped and why (already present, missing API credentials, etc.)
- The `secrets in vault`, `missing` and `webhooks` counts apply printed, the `not in Phantom:` names, and any providers phantom-wire skipped

Then suggest the next step verbatim:

> Run `/stack:doctor` to inspect the implemented checks; verify unchecked services and application credentials separately.

If Phantom setup is missing or refused, report the boundary and point to https://phm.dev/secrets for the installed-version setup instructions. Do not initialize a vault or grant permissions automatically. If the recipe id is missing, suggest `/stack:recommend <query>` to save a new recipe. The MCP server must run in the intended project directory with its Stack CLI and runtime available.
