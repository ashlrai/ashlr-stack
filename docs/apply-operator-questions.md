# Operator questions for a `stack apply` upgrade

Use this worksheet when moving to an installed Stack version that includes the
apply wiring change described in the [changelog](../CHANGELOG.md). Check the
installed version and `stack apply --help` first; a source changelog does not
establish the behavior of an installed release. Answer using the recipe, saved
apply output, project state and provider accounts. Record owners and evidence
for unresolved items, but never record secret values.

## Documented facts

- Wiring no longer creates placeholder secrets or fills missing values. Provider
  setup is separate and may store real credentials through its own workflow.
- After at least one provider succeeds, wiring checks declared secret names for
  every provider in the recipe, including failed providers. A missing name alone
  does not fail apply; provider failures do.
- An unreadable vault is reported as skipped, not as missing. `--noWire` skips
  both the inventory check and webhook stubs. Wiring can create stubs for recipe
  providers even when a provider failed or the vault is unreadable.
- Historically the attempted placeholder writes failed; they were not usable
  credentials. A present name establishes neither credential validity nor
  service readiness.

## Questions to resolve

1. **Which version and projects are affected?** Compare the installed version
   and help with the changelog, identify recipes and environments in use, and
   assign an owner for each upgrade. Do not assume source behavior is deployed.
2. **Did every provider succeed?** Review individual errors and the final apply
   result. For partial failures, inspect local configuration, rollback outcome
   and upstream resources before retrying; rollback may leave upstream resources.
3. **Was the inventory actually checked?** Look for skipped providers, a wiring
   failure, `--noWire`, or a run with no successful provider. An unchecked
   inventory is unknown, not empty. Resolve the vault or provider issue and
   inspect the inventory in the intended project.
4. **Which missing names are required in this environment?** Compare reported
   names with the recipe and provider requirements, including failed providers.
   Obtain each required real value and enter it through `phantom add <NAME>` in a
   trusted terminal, substituting the name and keeping the value out of arguments
   and logs. Do not add placeholders.
5. **Do the credentials and services work?** Verify provider access and the
   application's actual integration separately; name presence or an apply
   success message is insufficient evidence.
6. **Are webhook files safe and ready?** Inspect `.stack/webhooks` and preserve
   local changes before any retry, which may overwrite stubs. Implement and
   verify provider-specific signature validation before accepting requests;
   the generated stubs are commented examples, not authenticated handlers.
7. **Do automation or core consumers need changes?** Review scripts that treat
   apply success or zero missing names as readiness, and core consumers of the
   former `WireResult.envelopes` field. Use `present`, `missing` and `skipped`
   appropriately, and handle unknown inventory separately from missing names.

Do not rerun apply merely to inspect state: it can provision resources and
change files. Use [observing an apply](apply-observation.md) and
[troubleshooting](apply-troubleshooting.md) for inspection and recovery, and
the [upgrade questionnaire](apply-placeholder-upgrade-questions.md) for output
examples and further detail.
