# FAQ: `stack apply` and placeholder secrets

This describes the behavior in the [apply changelog entry](../CHANGELOG.md).
Check `stack apply --help` and the changelog for the version you use.

## Does apply put placeholder values in Phantom?

No. After at least one provider succeeds, apply's wiring step checks the
recipe's declared secret names against `phantom list --json`. It does not
write to the vault or fill missing values. Provider setup runs separately and
may already have stored real credentials through its own workflow.

Older wiring attempted to add a placeholder for each declared secret, but
those calls failed: Phantom rejects values in command arguments and did not
support the attempted `--rotate` option. The attempts were removed; they did
not create usable credentials. See the [history](apply-placeholder-history.md).

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
