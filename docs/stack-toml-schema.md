# `.stack.toml` schema (v1)

Human-editable, written by `stack` commands. Never stores secret values — credential values live in the Phantom vault; `.stack.toml` only references secret *names*.

```toml
[stack]
version = "1"             # schema version; always "1" for v1
project_id = "stk_xxx"    # random id assigned by `stack init`
template = "..."          # optional: which template seeded this config

# One [services.<name>] block per provisioned service.
[services.supabase]
provider = "supabase"     # must match a registered provider in @ashlr/stack-core
resource_id = "abcd1234"  # provider-side id (project_ref, project_id, app name)
region = "us-east-1"
secrets = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
mcp = "supabase"          # name of the MCP server entry in .mcp.json, if any
created_at = "2026-04-17T05:00:00Z"
created_by = "stack add"
# Freeform provider-specific metadata:
# [services.supabase.meta]
# org_id = "abc"

# Environments are overlays on top of the base service set.
[[environments]]
name = "dev"
default = true

[[environments]]
name = "prod"
# [environments.overrides]   # optional: per-env secret suffixes
# SUPABASE_URL = "_PROD"
```

## Invariants

- `stack.version` is always `"1"` in this release; breaking changes bump to `"2"` with a one-shot migration shipped in the CLI.
- `services[*].secrets` is the single source of truth for which Phantom vault keys belong to each service. `stack remove <service>` trusts this list when clearing secrets.
- `services[*].resource_id` is opaque to Stack; each provider interprets it.
- `.phantom.toml` is owned by Phantom and is **never** modified by Stack.
