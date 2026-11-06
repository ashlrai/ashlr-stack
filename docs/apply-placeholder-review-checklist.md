# Review existing placeholders after `stack apply`

Use this checklist for a project that may already have placeholder values in
Phantom. The [changelog](../CHANGELOG.md#021-2026-10-16) records that old
wiring attempted to add `TODO_STACK_APPLY`, but every attempt failed; the old
zero `envelopes` count does not prove what is in the vault. The fix removed
those attempts, and the [current behavior](../CHANGELOG.md#unreleased) checks
names without filling values. Provider setup is separate and may have stored
real credentials. Check the installed version and `stack apply --help`; the
source changelog alone does not establish what is installed.

Keep this review in a trusted environment. Record only the provider or secret
name, status, evidence and next action; do not record or share values in
checklists, tickets, logs or command arguments.

- [ ] **Establish scope.** Use the saved recipe and prior apply output to list
  the required secret names and provider outcomes. Wiring runs only if at
  least one provider succeeds, then checks the whole recipe, including failed
  providers. Missing names alone do not fail apply; provider failures do.
- [ ] **Identify unknowns.** A skipped or failed wiring check, an unreadable
  vault, `--noWire`, or no successful provider leaves some or all names
  unchecked. Unknown providers are also skipped. Resolve access or provider
  issues using [troubleshooting](apply-troubleshooting.md); zero checked
  counts do not prove the vault is complete or empty.
- [ ] **Classify each required name.** Compare the name inventory with the
  recipe and trusted provisioning records. Mark each as missing, present but
  unverified, confirmed placeholder, or verified usable. A present name is
  not evidence of a valid credential, and `not in Phantom` means missing, not
  a stored placeholder. If provenance or validity cannot be established,
  leave the entry unverified and investigate through the provider's approved
  workflow; do not assume a value is a placeholder because of its name or an
  old apply output.
- [ ] **Supply missing credentials.** Obtain each required real credential
  through the provider's normal flow. In a trusted terminal run
  `phantom add <NAME>`, substituting the missing name, and enter the real value
  when prompted. Do not put the value in the command arguments.
- [ ] **Remediate confirmed placeholders deliberately.** Determine which
  services depend on the entry and arrange a safe replacement with the owner.
  Phantom does not overwrite existing names: after the real credential is
  ready and the impact is understood, use `phantom remove <NAME>` in a trusted
  terminal, then `phantom add <NAME>` and enter the real value when prompted.
  Removal leaves the name unavailable until it is re-added; do not remove an
  unverified or working credential merely because it is present. Follow the
  installed Phantom's instructions if its behavior differs.
- [ ] **Verify and close.** Confirm the name is present, then independently
  verify provider access and application behavior without exposing the value.
  Record unresolved names and owners for follow-up. Review webhook stubs if
  applicable: wiring can create them even after provider failures or with an
  unreadable vault; they need signature verification before use.

Do not rerun apply just to inspect the vault: it can provision resources and
change files, including overwriting webhook stubs. See the
[migration guide](apply-placeholder-migration.md) for output examples.
