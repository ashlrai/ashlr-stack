# Verify real values after `stack apply`

Use this checklist in the project and environment where apply ran. The
[0.3.0 changelog entry](../CHANGELOG.md#030-2026-10-31) describes the source
behavior below; check the installed version and `stack apply --help` before
assuming it applies to your installation. Keep evidence in a trusted location:
record names, resource IDs, results and owners, never secret values or raw
credential-bearing logs.

- [ ] **Reconcile the run.** Compare the saved recipe and printed provider list
  with the intended project, environment and provider accounts. Review each
  provider's result and the final apply outcome. Provider failures fail apply;
  missing secret names alone do not. For partial failure, inspect rollback
  messages, project configuration and upstream resources: rollback is best
  effort and does not delete upstream resources. See
  [troubleshooting](apply-troubleshooting.md) before retrying.
- [ ] **Determine whether wiring actually checked the inventory.** After at
  least one provider succeeds, wiring checks declared names for the whole
  recipe, including failed providers. `--noWire` skips the inventory check and
  webhook stubs; no successful provider means no wiring attempt. A
  `phantom-wire failed` warning leaves the result uncertain. Skipped providers
  mean unknown inventory, not missing or present values; an unreadable vault
  or an unknown provider can cause a skip. Zero missing among checked names is
  not proof that skipped providers are complete. Resolve access or catalog
  issues and inspect `phantom status --json` and `phantom list --json` in the
  intended project; these show metadata and names, not values.
- [ ] **Supply each required missing value.** Compare the reported missing names
  with provider requirements for this environment, including any relevant
  names for failed providers. Obtain the real credential from its provider. In
  a trusted terminal run `phantom add <NAME>`, replacing `<NAME>` with the
  reported secret name, and enter the real value when prompted. Keep the value
  out of command arguments, files and logs. Wiring does not fill missing values;
  provider setup may separately have stored real credentials. Do not add
  placeholder values. For an existing name with a suspected bad value, use the
  approved Phantom and provider recovery process; do not assume add overwrites
  it. Recheck the inventory after changes.
- [ ] **Verify the credential and integration.** A name in Phantom only proves
  name presence. Run `stack doctor --json` separately and review each service's
  result, including warnings and unchecked services. Apply's final doctor is
  informational and does not determine apply success. Independently confirm
  the intended provider account, resource, permissions and environment, then
  exercise a provider-supported, non-destructive operation through the actual
  application or deployment identity. Record pass, failure or unknown and the
  owner for every required integration; do not mark unchecked services ready.
  A successful doctor check alone does not prove the application can use every
  credential.
- [ ] **Review webhook readiness.** Inspect `.stack/webhooks/` if stubs were
  generated. Wiring can create stubs for failed providers or when the vault is
  unreadable. The count is files generated, not endpoints deployed or verified.
  Stubs are commented examples and do not authenticate requests; implement and
  test provider-specific signature verification before accepting traffic.
  Preserve changes before retrying apply, which can overwrite stubs.
- [ ] **Close only with evidence.** Resolve or explicitly track each missing,
  skipped, failed or unchecked item with an owner and follow-up. Confirm the
  required integrations work in the intended environment before declaring the
  apply ready. Do not rerun apply just to inspect state: it can provision
  resources and change files. See [observing an apply](apply-observation.md)
  for further inspection commands.
