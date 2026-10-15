# Stack config files (current writer format)

Stack separates a project's configuration into a committed shape and a local
instance. Callers of `readConfig` work with their merged `StackConfig` view;
`writeConfig` splits that view into the two files below. The JSON-like
`StackToml` component in the static OpenAPI discovery catalog describes the
parsed committed output, not raw TOML, every accepted input, or an HTTP API.

## Committed shape: `.stack.toml`

```toml
[stack]
version = "1"
template = "fixture-template" # optional

[services.primary]
provider = "supabase"
secrets = ["FIXTURE_URL", "FIXTURE_ANON_KEY"]
mcp = "supabase"             # optional MCP entry name

[[environments]]
name = "dev"
default = true

[[environments]]
name = "prod"
[environments.overrides]
FIXTURE_URL = "_PROD"
```

The root has `stack`, `services` and `environments`. Service table keys are
logical slot names; they need not equal the entry's provider string. Each
canonical committed service has `provider`, `secrets` (an array of names,
possibly empty), and optional `mcp`. Project IDs, provider resource IDs,
regions, metadata and creator/timestamp fields belong to the local instance.

`emptyConfig` starts with version `"1"`, no services and one default `dev`
environment. The writer preserves the supplied version string and environment
array, including an empty array or zero/multiple default flags. The reader
has no version enum, exactly-one-default check or provider-registry validation.
The string map `overrides` is stored; this format description does not promise
remote provisioning or credential-placeholder expansion.

## Local instance: `.stack.local.toml`

```toml
[stack]
project_id = "stk_fixture"

[services.primary]
resource_id = "fixture-resource"
region = "fixture-region"
created_at = "2026-04-17T05:00:00Z"
created_by = "fixture-owner"
[services.primary.meta]
organization_id = "fixture-organization"
```

The local service table may contain `resource_id`, `region`, `meta`,
`created_at` and `created_by`. These fields are optional in the local file.
`meta` is a freeform provider-specific record. Canonical dedicated credential
slots reference names whose values are stored in Phantom, but manual TOML,
metadata and override strings can still contain user-supplied data. Neither
this format nor the config reader is a general secret-redaction boundary;
review files before sharing them.

## Merged library view and defaults

`readConfig` combines the committed shape with the local instance. Its
internal `ServiceEntry` has `provider`, `secrets` and `created_at`, plus optional
`mcp`, `resource_id`, `region`, `meta` and `created_by`. There is no service
`name` field: the enclosing service map supplies that key. The static
OpenAPI `ServiceEntry` component describes this internal merged entry, not
the committed subset or literal `stack add` stdout. `stack init` and
`stack add` print human-facing messages; the catalog's JSON media entries for
those commands are representation references, not running HTTP responses.
Commands such as `stack recommend --json` have their own actual JSON output.

On the normal split-file read path:

- Missing local `project_id` produces a fresh random ID in the returned view;
  reading alone does not persist that generated ID.
- Missing instance `created_at` becomes `"1970-01-01T00:00:00Z"`.
- Missing or empty committed environments become `[{ name: "dev", default: true }]`.
- A top-file `region` alone does not trigger legacy handling and is not the
  source of the merged instance region; that comes from the local file.

The implementation parses TOML and uses typed assumptions/normalization. It
does not run the documentation schemas as validators, reject all unknown
fields, or promise sensible behavior for arbitrary wrongly typed input.

## Legacy combined files

A parsed top file takes the legacy path when `[stack].project_id` is present,
or any service has `created_at` or `resource_id`. A `region` field alone is
not a legacy trigger. This path reads the top file as a combined view and
ignores an existing `.stack.local.toml`; reading does not migrate or rewrite
files. The next `writeConfig` splits the view into the current format.

Legacy defaults differ from normal split-file defaults: missing/nullish
`environments` becomes the default `dev` array, while an explicit empty array
is retained; a missing service provider defaults to its map key, missing
secrets to `[]`, and missing `created_at` to the current time. Missing legacy
`project_id` also generates an ID. No future version migration is promised by
these current legacy rules.

## Write effects and ownership

`writeConfig` writes the shape file, then the local file, then ensures an
ignore entry for `.stack.local.toml`, and finally attempts best-effort local
project registration. These are sequential effects, not an atomic commit;
a failure can leave earlier writes in place. The ignore-file update can fail,
and project registration failures are swallowed, so neither is an unconditional
completion guarantee. The config writer itself does not write `.phantom.toml`;
other Stack operations have separate Phantom setup behavior.

`services[*].secrets` tells service-removal code which named vault keys belong
to that entry; it is not proof of present values, successful cleanup, provider
health or remote deletion. Provider resource identifiers remain opaque to
this config layer. No live provider, vault or installed-package acceptance
follows from a file matching the documented shape.
