# `stack apply` and placeholder secrets

## History

The current changelog annotates the 0.1.0 entry in the
[source](../CHANGELOG.md#010--2026-04-19-superseded-by-011) and
[site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011):
wiring historically attempted a `TODO_STACK_APPLY` placeholder for each declared
secret. Those calls failed; they did not create usable credentials.

The 0.2.1 bug fix in the [source](../CHANGELOG.md#021-2026-10-16) and
[site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) removed those attempts.
Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`, then
retried without `--rotate`, for every declared secret. Phantom rejected values
in command arguments and had no `--rotate`, so every call failed and the
reported `envelopes` count was always zero. These commands are historical; do
not run them. The fix replaced `WireResult.envelopes` with `present` and
`missing`.

The [0.2.2 release entry](../CHANGELOG.md#022-2026-10-25) says 0.2.1 was
tagged but its npm publish failed; 0.2.2 superseded it and shipped the 0.2.1
changes. The [0.3.0 entry](../CHANGELOG.md#030-2026-10-31) reiterates that
wiring checks secret names without storing placeholders, and reports an
unreadable vault as skipped rather than missing. The
[Unreleased entry](../CHANGELOG.md#unreleased) clarifies that, after at least
one provider succeeds, wiring covers every provider in the recipe, including
failed providers.

Do not add placeholder values yourself: they are not credentials and can prevent
a real value from being stored under the same name. Release notes describe source
history; check the installed version before assuming its behavior.

## Current behavior

`stack apply <recipe-id>` provisions the recipe's providers in order using the
`stack add` pipeline. Provider setup can store real credentials through its
own workflow. Once at least one provider succeeds, apply attempts wiring for
**every provider in the recipe**, including failed providers and providers
whose successful setup was subsequently rolled back.

Wiring reads secret names and metadata with `phantom list --json`; it does not
read secret values, write to the vault, or fill missing values. For known
providers it compares the inventory with the secret names declared in the
provider catalog and reports `secrets in vault`, `missing`, and `webhooks`.
The counts describe recipe provider/secret entries, not a validation of their
values. A missing name alone does not fail apply. Obtain each required value
from its provider and run `phantom add <NAME>` in a trusted terminal, entering
the real value there. Provider failures still make apply fail, even if wiring
is successful.

If the inventory cannot be read, wiring lists the providers as skipped rather
than identifying their secrets as missing. For example, with an OpenAI-only
recipe and an unreadable inventory, apply reports:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

The zero counts do not establish that the vault is empty or that no secrets
are missing. Unknown providers are also skipped. A wiring error is reported as
a warning and does not itself fail apply; inspect any partial files before
retrying. `stack doctor` runs afterward as an informational check and does not
determine apply's success.

Wiring also creates commented webhook examples for Stripe, Clerk, Supabase,
and GitHub under `.stack/webhooks/`, even when the inventory is unreadable or
the provider failed. Repeated wiring overwrites an existing stub. These
examples do not implement signature verification and must be completed before
use. `--noWire` skips both the inventory check and webhook stubs; provider
setup still runs and may store real credentials. Apply still requires Phantom.

For the exact changelog entry that removed the attempts, see the
[placeholder-secret changelog timeline](changelog-placeholder-timeline.md).
For definitions of the historical and current terms, see
[placeholder terminology](apply-placeholder-terminology.md).
For prerequisites, rollback, and recovery, see
[Troubleshooting `stack apply`](apply-troubleshooting.md).
