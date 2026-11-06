# Operator impact: `stack apply` placeholder change

The [changelog](../CHANGELOG.md#021-2026-10-16) records that older wiring
attempted to add `TODO_STACK_APPLY` for each declared secret. Those calls
failed: Phantom rejected values in arguments, and the old `envelopes` count
was always zero. The fix removed those attempts. Check your installed version
and `stack apply --help`; a source changelog does not establish what is
installed. The [0.3.0](../CHANGELOG.md#030-2026-10-31) and
[Unreleased](../CHANGELOG.md#unreleased) entries describe the behavior below.

## What operators see

- Wiring does not write placeholders or fill missing values. Provider setup is
  separate and may store real credentials.
- After at least one provider succeeds, wiring checks secret names for every
  provider in the recipe, including failed providers. Missing names alone do
  not fail apply; provider failures do. An applied recipe is not proof that
  every required secret is present or that a stored credential works.
- With a readable vault, the summary counts present and missing names and
  lists missing names. For example, the changelog shows:

  ```text
    secrets in vault 0 · missing 1 · webhooks 0
    (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
  ```

  For each required missing name, obtain the real value and run
  `phantom add <NAME>` in a trusted terminal, substituting the reported name
  and entering the value when prompted. Do not put the value in arguments.
- If the vault cannot be read, providers are reported as skipped, rather than
  identified as missing. The changelog's example is:

  ```text
    secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
    (phantom-wire skipped: openai)
  ```

  The zero counts cover checked names only; they do not establish that the
  vault is empty or that no values are missing. Unknown providers are also
  skipped. Investigate the inventory before deciding what is missing.
- Wiring can create webhook stubs for recipe providers even if a provider
  failed or the vault is unreadable. `--noWire` skips both the name checks and
  the stubs, and prints no wiring summary. See
  [apply troubleshooting](apply-troubleshooting.md) before retrying an apply.

## Migration: stated and unknown

The changelog states the action for required names reported missing, but does
not specify a complete migration procedure for existing installations. In
particular, whether any existing placeholder values need identification,
replacement or cleanup, and the steps for doing so, are **unknown** from the
changelog. Do not infer that failed historical attempts prove the contents of
an existing vault. Inspect the relevant installation and vault using trusted
procedures before deciding on further action.

For consumers of the core result, the changelog says `WireResult.envelopes`
was replaced by `present` and `missing`; it does not prescribe a downstream
migration procedure. Review consumers before upgrading. The
[migration checklist](apply-placeholder-migration.md) offers further context.
