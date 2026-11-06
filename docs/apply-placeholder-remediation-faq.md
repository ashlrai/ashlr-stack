# FAQ: remediating historical `stack apply` placeholder attempts

This FAQ follows the [0.2.1 fix](../CHANGELOG.md#021-2026-10-16) and the
[0.3.0 examples](../CHANGELOG.md#030-2026-10-31). The 0.2.1 npm publish
failed and 0.2.2 superseded it. Check the installed version and its
`stack apply --help`; this repository's changelog does not establish which
version is installed.

## How can I recognize the old behavior?

Historical wiring attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`
for each declared secret, then tried without `--rotate`. Phantom rejected
values in command arguments and did not support `--rotate`, so every call
failed. The old `envelopes` count was always 0. The marker and count identify
the historical behavior; they do not establish the state of a particular
vault. Do not run either historical command.

## What should I do for a missing secret?

For a readable vault, the changelog gives this example:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

Obtain each required missing value from its provider. In a trusted terminal,
run `phantom add <NAME>`, replacing `<NAME>` with the reported name, and enter
the real value when prompted. For this example, run `phantom add OPENAI_API_KEY`.
Do not put the value in command arguments. A present name does not prove its
value works; verify credentials and services separately.

## Does a successful apply mean the secrets are ready?

No. Missing names alone do not fail apply; provider failures do. After at
least one provider succeeds, wiring checks names for the whole recipe, including
failed providers. Wiring no longer writes placeholders or fills missing values;
provider setup may separately store real credentials.

## What if the inventory was skipped?

For the same recipe with an unreadable vault, the changelog shows:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

The zero counts cover checked names only; they do not prove the vault is empty
or complete. Unknown providers are also skipped. Resolve the inventory issue
before deciding which names are missing; see [apply troubleshooting](apply-troubleshooting.md).
If `--noWire` was used, both the inventory check and webhook stubs were skipped
and no wiring summary was printed. If no provider succeeded, wiring was not
attempted. Wiring may create webhook stubs even when the vault is unreadable.
Inspect provider state and existing webhook files before rerunning apply.
