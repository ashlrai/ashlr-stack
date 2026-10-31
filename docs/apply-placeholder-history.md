# `stack apply` and placeholder secrets

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

## Historical behavior

Before the change recorded in the [0.2.1 changelog](../CHANGELOG.md), wiring
attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without
`--rotate`, for every declared secret. Phantom Secrets rejects secret values
in command arguments and does not support `--rotate`, so those attempts
failed; the old `envelopes` count was always zero. They did not create usable
credentials. The fix removed the attempts and replaced `WireResult.envelopes`
with `present` and `missing`. Do not add placeholder values yourself: they
are not credentials and can prevent a real value from being stored under the
same name.

For prerequisites, rollback, and recovery, see
[Troubleshooting `stack apply`](apply-troubleshooting.md).
