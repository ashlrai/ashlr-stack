# Operator checklist: `stack apply` and placeholder secrets

Use this checklist in the project where apply ran, with the previous apply's
output in hand. It follows the [Unreleased](../CHANGELOG.md#unreleased),
[0.3.0](../CHANGELOG.md#030-2026-10-31), and
[0.2.1](../CHANGELOG.md#021-2026-10-16) changelog entries: 0.2.1 records the
historical issue, and the 0.3.0 and Unreleased entries describe current
behavior. The 0.2.1 npm publish failed and
[0.2.2](../CHANGELOG.md#022-2026-10-25) superseded it. Check the installed
Stack version and `stack apply --help`: the source changelog does not
establish the behavior of an installed release. Keep logs, vault output and
other apply output in a trusted environment.

## Checklist

- [ ] **Understand the old result.** Historical wiring attempted to add the
  marker `TODO_STACK_APPLY` for each declared secret, first with an
  unsupported `--rotate` option and then without it. Phantom rejected values
  in command arguments; the attempts failed and the old `envelopes` count was
  always 0. The 0.2.1 fix removed these attempts. An old zero count is a sign
  of the failed attempt, not proof that credentials are present or that the
  vault is empty. Do not create placeholder values.
  Do not use the marker as a secret value.
- [ ] **Review the recipe and provider outcomes.** Apply tries each provider;
  provider failures make apply fail and a partial rollback can leave state
  behind. Wiring is attempted only if at least one provider succeeds, and then
  checks secret names for every recipe provider, including failed providers.
  Missing names alone do not fail apply; provider failures do. Provider setup
  is separate and may store real credentials.
- [ ] **Read the wiring summary.** With a readable vault, the changelog shows
  this example:

  ```text
    secrets in vault 0 · missing 1 · webhooks 0
    (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
  ```

  The list identifies missing **names**, not stored placeholders. A present
  name does not prove a credential works, and a successful apply is not proof
  that every required value is present.
- [ ] **Supply every required missing value.** Obtain the actual credential
  from its provider. In a trusted terminal in the project, run
  `phantom add <NAME>`, replacing `<NAME>` with the reported secret name,
  and enter the real value when prompted; do not put the value in command
  arguments. For the example above, the command is `phantom add OPENAI_API_KEY`.
  Verify the resulting name and test the integration without exposing values.
- [ ] **Resolve unknown checks.** An unreadable vault reports providers as
  `skipped`, not missing. The same recipe with an unreadable inventory can
  report:

  ```text
    secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
    (phantom-wire skipped: openai)
  ```

  The zero present and missing counts then cover only checked names; they do
  not prove the vault is empty or complete. Unknown providers can also be
  skipped. Investigate a `phantom-wire failed` warning; it is not a successful
  inventory check. `--noWire` skips both name checks and webhook stubs, and no
  wiring summary is printed. Use
  [apply troubleshooting](apply-troubleshooting.md) to resolve inventory
  access and verify the required names; do not infer completeness from an
  absent summary or skipped checks.
- [ ] **Review webhook files and service readiness.** Wiring does not write
  placeholders or fill missing values, but it can create commented webhook
  stubs for recipe providers even when a provider failed or the vault is
  unreadable. Repeating apply can overwrite existing stubs. Preserve custom
  work and inspect provider state before a retry; these commented examples
  need signature verification before deployment. Check provider resources and
  application behavior independently of the inventory.

## Migration: stated and unknown

The changelog states the action for required names reported missing: obtain
each real value and run `phantom add <NAME>` in a trusted terminal, entering
the real value when prompted. It does not specify a complete migration
procedure for existing installations. In particular, whether any existing
placeholder values need identification, replacement or cleanup, and the steps
for doing so, are **unknown** from the
changelog. Do not infer that failed historical attempts prove the contents of
an existing vault. Inspect the relevant installation and vault using trusted
procedures before deciding on further action.

For consumers of the core result, the changelog says `WireResult.envelopes`
was replaced by `present` and `missing`; it does not prescribe a downstream
migration procedure. Review consumers before upgrading. The
[migration checklist](apply-placeholder-migration.md) and
[placeholder history](apply-placeholder-history.md) offer further context.
