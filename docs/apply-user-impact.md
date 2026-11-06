# User impact of the `stack apply` wiring change

The [changelog](../CHANGELOG.md) records that the 0.2.1 fix removed attempts
to write placeholder secrets. Those attempts had already failed: Phantom
rejected values in command arguments and did not support `--rotate`. The old
`envelopes` count was always zero, so those attempts did not create usable
secrets. The 0.3.0 and Unreleased entries clarify the current behavior.

After at least one provider succeeds, wiring checks declared secret names for
the entire recipe, including failed providers. It does not write placeholders
or fill in missing values. Provider setup is separate and may store real
credentials. Missing names alone do not fail apply; provider failures do.
Consequently, an applied recipe does not prove that every required secret is
present.

When the vault is readable, wiring reports present and missing names. For an
example with `OPENAI_API_KEY` missing and no webhooks, the changelog shows:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

For each required missing value, run `phantom add <NAME>` in a trusted
terminal, substituting the reported name, and enter the real value. For this
example, run `phantom add OPENAI_API_KEY`. Do not put the value on the command
line.

If the vault cannot be read, wiring reports providers as skipped instead of
identifying missing names. For the same example, the changelog shows:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

Those zero counts cover only checked names; they do not show that no secrets
are missing. Resolve the inventory problem before relying on the counts.
Unknown providers are also skipped. Wiring may create webhook stubs even for
failed providers or when the vault is unreadable; `--noWire` skips both the
secret check and stubs. See the [migration guide](apply-placeholder-migration.md)
for a verification checklist and [troubleshooting](apply-troubleshooting.md)
for skipped checks.

Consumers of the core wiring result must also account for the changelog's
replacement of `WireResult.envelopes` with `present` and `missing`.
