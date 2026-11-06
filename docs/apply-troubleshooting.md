# Troubleshooting `stack apply`

Run `stack apply <recipe-id>` from the project directory that contains the
saved `.stack/recipes/<recipe-id>.toml`. Apply can provision billable upstream
resources and write credentials, MCP configuration and project files. Review
the recipe and provider accounts before running it. Recipes are unsigned; use
only recipes you trust. Apply is not a dry run. For a read-only preview of an
individual provider's steps, use `stack add <provider> --dryRun`.

## Recipe cannot be found or selected

Check `pwd` and `ls .stack/recipes`, then pass the filename stem as the id.
Save a new recipe in this directory with `stack recommend "<description>" --save`
if needed. Without an id, apply opens a picker only in a terminal; in a
headless session it reports available ids and requires one explicitly. The
picker omits malformed recipes and recipes with unknown providers. If a file is
missing from the list, pass its id to see the error, then correct its TOML or
provider name; `stack providers` lists the installed catalog. Recipe resolution
happens before auto-init, so a bad id does not create `.stack.toml`.

## Project or Phantom prerequisite fails

If `.stack.toml` is absent, apply first attempts a blank, non-interactive init;
this may create the config and a registry entry even if a later step fails.
For an auto-init error, check the project directory and its write permissions,
then run `stack init` manually and inspect the result before retrying. Do not
use `--force` unless you intend to overwrite an existing config.

Apply requires Phantom Secrets even with `--noWire`. Check that `phantom
--version` works in the same execution context, and install Phantom using
[its setup instructions](https://phm.dev/secrets) if needed. From the project
directory, check `phantom status --json`: `initialized: true` means project
metadata is readable, not that credentials or provider access are healthy.
For a new, unconfigured project, run `phantom init --empty` in a trusted
terminal. If status is unreadable or initialization is refused, resolve that
boundary using Phantom's instructions before retrying; apply does not set up
the vault automatically.

## Provider fails or needs authentication

Apply attempts every recipe provider in order and reports individual failures.
Read each provider's error, check the account, access and provider-specific
requirements, and fix the underlying issue. In a headless session a provider
may require interactive sign-in or credential entry. Run the indicated
`stack add <provider>` in your own terminal with real credentials, then inspect
the resulting state before retrying. Never insert placeholder credentials:
Phantom does not overwrite existing names, so they can block real values.

A provider already in `.stack.toml` may fail as already added. Inspect `stack
doctor` and the local config and provider dashboard before deciding whether to
keep, reattach or remove it. Do not blindly rerun the entire recipe: successful
providers can already exist or a new run can create duplicate resources.
`stack add <provider> --use <resource-id>` requests attachment to an existing
resource; verify the id and provider support first.

## Partial failure and rollback

When some providers succeed and others fail, apply offers to roll back the
successful adds in a terminal; headless apply attempts that rollback by default.
`--noRollback` keeps successful adds. Rollback is best effort: it removes local
service entries and attempts MCP and vault cleanup, but **does not delete their
upstream resources**. Record the printed resource ids and inspect the provider
dashboards before deleting or reusing anything. Phantom may retain secrets,
especially without a terminal; reconcile the reported names in a trusted
terminal, removing them with `phantom remove <NAME>` only if no longer needed.
If rollback itself fails, inspect `.stack.toml`, `.mcp.json`, Phantom and the
provider dashboards for remaining state before retrying.

A failure within one provider can happen after resource creation, at resource
credential write, materialize, secret write, MCP write or config write. Read
the original error and teardown result. Depending on provider support, Stack
may tear down a newly created resource, report failed teardown, or require
manual cleanup; an explicitly attached existing resource is preserved. Kept
resource credentials may require manual vault reconciliation. Check the
reported resource and local state before retrying; cleanup is not atomic.

## Missing secrets, skipped wiring or webhook stubs

After at least one provider succeeds, apply attempts the optional wiring step
for the recipe, even if other providers failed or rollback was attempted. It
reports names present or missing in Phantom, not credential validity. Obtain
real values through the provider's normal flow and store them with `stack add`
or `phantom add <NAME>` in a trusted terminal. If providers are listed under
`phantom-wire skipped`, check `phantom status --json`, the installed Phantom
version and whether `phantom list --json` works in the project; an unreadable
inventory cannot establish which secrets are missing. Unknown providers are
also skipped. A `phantom-wire failed` warning can leave partial files: inspect
`.stack/webhooks` and its permissions before retrying.

`--noWire` skips the vault inventory and webhook stubs only; provider setup
and its credential, MCP and config writes still run. The webhook files are
commented examples, not working authenticated handlers. Apply can overwrite
existing stubs for supported providers; preserve any changes before retrying.
Implement provider-specific signature verification before accepting webhook
requests.

Apply runs `stack doctor` as an informational final check; its result does not
prove provider or application readiness and does not determine apply success.
Run `stack doctor` separately, investigate its findings, and verify the actual
services and application credentials independently.
