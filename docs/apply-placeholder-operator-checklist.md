# Operator checklist: `stack apply` and placeholder secrets

Use this checklist in the project where apply ran. It follows the
[Unreleased](../CHANGELOG.md#unreleased), [0.3.0](../CHANGELOG.md#030-2026-10-31),
and [0.2.1](../CHANGELOG.md#021-2026-10-16) changelog entries. Check the
installed Stack version and `stack apply --help`: the source changelog does
not establish the behavior of an installed release. Keep output in a trusted
environment.

- [ ] **Understand the old result.** Historical wiring attempted to add the
  marker `TODO_STACK_APPLY` for each declared secret, first with `--rotate`
  and then without it. Phantom rejected values in command arguments; the
  attempts failed and the old `envelopes` count was always zero. The 0.2.1
  fix removed these attempts. That count does not prove credentials are present
  or that the vault is empty. Do not use the marker as a secret value.
- [ ] **Review the recipe and provider outcomes.** Apply tries each provider;
  provider failures make apply fail and a partial rollback can leave state
  behind. Wiring is attempted only if at least one provider succeeds, and then
  considers every recipe provider, including failed providers. Provider setup
  may separately store real credentials.
- [ ] **Read the wiring summary.** With a readable vault, the changelog shows
  this example:

  ```text
    secrets in vault 0 · missing 1 · webhooks 0
    (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
  ```

  The list identifies missing **names**. Missing names alone do not fail
  apply, and a present name does not prove a credential works. A successful
  apply is not proof that every required value is present.
- [ ] **Supply every required missing value.** Obtain the actual credential
  from its provider. In a trusted terminal in the project, run
  `phantom add <NAME>`, replacing `<NAME>` with the reported secret name,
  and enter the real value when prompted; do not put the value in command
  arguments. For the example above, the command is `phantom add OPENAI_API_KEY`.
  Verify the resulting name and test the integration without exposing values.
- [ ] **Resolve unknown checks.** An unreadable vault reports providers as
  `skipped`, not missing; zero present and missing counts then cover only
  checked names. Unknown providers can also be skipped. Investigate a
  `phantom-wire failed` warning. `--noWire` skips both name checks and webhook
  stubs, and no wiring summary is printed. Use
  [apply troubleshooting](apply-troubleshooting.md) to resolve inventory
  access and verify the required names; do not infer completeness from an
  absent summary or skipped checks.
- [ ] **Review webhook files and service readiness.** Wiring can create
  webhook stubs for recipe providers even when a provider failed or the vault
  is unreadable. Repeating apply can overwrite existing stubs. Preserve custom
  work before a retry; these commented examples need signature verification
  before deployment. Check provider resources and application behavior
  independently of the inventory.
