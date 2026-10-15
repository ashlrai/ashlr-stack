# `.stack.toml` schema (v1)

Human-editable, written by `stack` commands. Never stores secret values — credential values live in the Phantom vault; config files only reference secret *names*.

Config is split across two files (`packages/core/src/config.ts`):

- `.stack.toml` (committed) is the **shape**: which services the project uses, their secret slot names, and MCP entries.
- `.stack.local.toml` (gitignored, added to `.gitignore` on first write) is the **instance**: the project id and per-developer provider-side ids, regions, metadata, and timestamps.

`readConfig` merges the two; `writeConfig` splits them back out. A legacy single-file `.stack.toml` that still carries instance fields is read transparently and split on the next write.

```toml
# .stack.toml (committed)
[stack]
version = "1"             # schema version; always "1" for v1
template = "..."          # optional: which template seeded this config

# One [services.<name>] block per provisioned service.
[services.supabase]
provider = "supabase"     # must match a registered provider in @ashlr/stack-core
secrets = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
mcp = "supabase"          # name of the MCP server entry in .mcp.json, if any

# Environments are overlays on top of the base service set.
[[environments]]
name = "dev"
default = true

[[environments]]
name = "prod"
# [environments.overrides]   # optional: per-env secret suffixes
# SUPABASE_URL = "_PROD"
```

```toml
# .stack.local.toml (gitignored)
[stack]
project_id = "stk_xxx"    # random id assigned when the config is created

[services.supabase]
resource_id = "abcd1234"  # provider-side id (project_ref, project_id, app name)
region = "us-east-1"
created_at = "2026-04-17T05:00:00Z"
created_by = "stack add"
# Freeform provider-specific metadata:
# [services.supabase.meta]
# org_id = "abc"
```

## Invariants

- `stack.version` is always `"1"` in this release; breaking changes bump to `"2"` with a one-shot migration shipped in the CLI.
- `services[*].secrets` is the single source of truth for which Phantom vault keys belong to each service. `stack remove <service>` trusts this list when clearing secrets.
- `services[*].resource_id` is opaque to Stack; each provider interprets it.
- `.phantom.toml` is owned by Phantom and is **never** modified by Stack.
