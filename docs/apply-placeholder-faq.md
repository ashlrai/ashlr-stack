# FAQ: `stack apply` and placeholder secrets

This describes the behavior in the [0.2.1 apply fix](../CHANGELOG.md#021-2026-10-16)
and the [0.3.0 apply notes](../CHANGELOG.md#030-2026-10-31).
Check `stack apply --help` and the changelog for the version you use.

## Does apply put placeholder values in Phantom?

No. After at least one provider succeeds, apply's wiring step checks the
recipe's declared secret names against `phantom list --json`. It does not
write to the vault or fill missing values. Provider setup runs separately and
may already have stored real credentials through its own workflow.

The 0.2.1 fix removed older attempts to add a placeholder for every declared
secret. Those calls failed; the wiring step now checks names instead. The
reported `WireResult.envelopes` field was replaced by `present` and `missing`.
See the [history](apply-placeholder-history.md).

## Did the historical command rotate secrets?

It attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried
without `--rotate`. According to the [0.2.1 changelog](../CHANGELOG.md#021-2026-10-16),
Phantom has no `--rotate` option and rejects values passed in command
arguments, so every call failed. The attempted option did not rotate secrets;
neither form should be run. The changelog does not establish the state of an
individual vault or prescribe a migration of existing secrets.

## Why do I need to supply a real value?

A secret name identifies a credential; it is not the credential itself. A
placeholder cannot authenticate to a provider and may occupy a name needed for
the real value. Obtain each required missing value from the provider. In a
trusted terminal, run `phantom add <NAME>`, replacing `<NAME>` with the reported
secret name, and enter the real value when prompted. Do not put the value in
the command arguments. For example, use `phantom add OPENAI_API_KEY` for the
name below.

## What does a missing name mean?

With a readable vault, an OpenAI-only recipe missing `OPENAI_API_KEY` can
report:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

This reports a missing name, not a stored placeholder. A missing name alone
does not make apply fail, so an applied recipe does not prove that all required
secrets are present. A present name does not prove its value is valid either.
Provider failures still cause apply to fail. Wiring checks the whole recipe,
including failed providers and providers whose setup was rolled back.

## What if the vault cannot be read?

The same recipe can instead report:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

The zero counts cover only checked names; they do not show that the vault is
empty or that no secrets are missing. Unknown providers are also skipped.
Resolve the inventory problem before interpreting the result; see
[apply troubleshooting](apply-troubleshooting.md).

## What else does wiring do, and can I skip it?

Wiring can create commented webhook stubs for supported recipe providers,
including failed providers and when the vault is unreadable. These examples
are not authenticated handlers and repeated wiring can overwrite them.
`--noWire` skips both the vault check and webhook stubs and prints no wiring
summary. Provider setup still runs and may store real credentials; apply still
requires Phantom. If no provider succeeds, wiring is not attempted.

For interpreting the rest of the output, see [observing an apply](apply-observation.md).
