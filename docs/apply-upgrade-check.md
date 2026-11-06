# Upgrade check: `stack apply` placeholders

Use this checklist with the [changelog](../CHANGELOG.md), your installed
version and `stack apply --help`, and saved apply output, recipes, automation,
and provider state. The 0.2.1 fix removed the old attempts; 0.2.2 superseded
the unpublished 0.2.1 npm release. A source changelog alone does not establish
the behavior of your installed version. Keep logs and secret names in a trusted
environment; never record secret values in this checklist.

- [ ] **Check for an assumption that apply created secrets.** Search deployment
  scripts and runbooks for `stack apply`, `TODO_STACK_APPLY`, and steps that
  expect placeholder names or values in Phantom. The old wiring tried to add
  the marker but every call failed; the old `envelopes` count was always 0.
  It did not establish usable credentials. Current wiring does not fill missing
  values; provider setup separately may store real credentials.
- [ ] **Check output and result consumers.** Look for automation parsing the
  old `envelopes` summary or `WireResult.envelopes`; core consumers must use
  `present` and `missing` instead and account for `skipped`. Do not treat an
  apply success or a present name as proof that a credential works. Missing
  names alone do not fail apply; provider failures do.
- [ ] **Resolve missing or unchecked names.** Compare required recipe secrets
  with saved wiring output. For each required name reported by `not in Phantom`,
  obtain the real value from its provider and run `phantom add <NAME>` in a
  trusted terminal, substituting the name and entering the value when prompted.
  Do not pass the value as an argument. A skipped or failed wiring check is
  unknown, not evidence that nothing is missing; resolve it using
  [troubleshooting](apply-troubleshooting.md), then verify credentials and
  services separately.
- [ ] **Check the scope of the old run before deciding to retry.** Wiring runs
  only after at least one provider succeeds, then checks the whole recipe,
  including failed providers. `--noWire` skips both the inventory check and
  webhook stubs. Wiring may create stubs even for failed providers or with an
  unreadable vault; inspect existing files and provider state before rerunning
  apply, which can provision resources or change files. Stubs need signature
  verification before use.

Record any dependency found, its affected provider or secret name, and the
corrective action. If the evidence is unavailable, leave the check unresolved.
