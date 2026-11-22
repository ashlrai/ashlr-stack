# `stack apply` and placeholder secrets

## History

Before 0.2.1, `stack apply` wiring tried to store a `TODO_STACK_APPLY`
placeholder in Phantom for each declared secret. None of those writes ever
succeeded. Wiring now only checks which secret names exist.

The table follows the source changelog, oldest entry first. The site copy
mirrors it byte for byte, including the
[0.1.0 annotation](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011)
and the [0.2.1 fix](../packages/site/src/data/CHANGELOG.md#021-2026-10-16).

| Changelog entry | Recorded change |
| --- | --- |
| [0.1.0 — 2026-04-19](../CHANGELOG.md#010--2026-04-19-superseded-by-011), AI recommendation layer | The apply entry, as annotated in the current changelog, says wiring historically attempted a `TODO_STACK_APPLY` placeholder for each declared secret. Those calls failed; they did not create usable credentials, and the 0.2.1 fix removed those attempts. |
| [0.2.1 — 2026-10-16](../CHANGELOG.md#021-2026-10-16), Bug fixes | **`stack apply` stops attempting to write placeholder secrets.** Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without `--rotate`, for every declared secret. Both attempts failed: Phantom refused values in command arguments and had no `--rotate`, so every call failed and the printed `envelopes` count was always zero. The fix replaced `WireResult.envelopes` with `present` and `missing`. These commands are historical; do not run them. |
| [0.2.2 — 2026-10-25](../CHANGELOG.md#022-2026-10-25) | 0.2.1 was tagged but its npm publish failed; 0.2.2 superseded it and shipped the changes listed under 0.2.1. |
| [0.3.0 — 2026-10-31](../CHANGELOG.md#030-2026-10-31), Changed | Wiring checks secret names; it does not write to the vault or fill missing values. A readable vault yields present and missing names; an unreadable vault yields skipped providers, not a finding that names are missing. Provider setup may separately store real credentials. |
| [Unreleased](../CHANGELOG.md#unreleased), Changed | After at least one provider succeeds, wiring checks names for every provider in the recipe, including failed providers, and can create webhook stubs even if the vault is unreadable. If no provider succeeds, apply does not attempt wiring. Missing names alone do not fail apply; provider failures do. `--noWire` skips both checks and stubs. |

Do not add placeholder values yourself: they are not credentials and can prevent
a real value from being stored under the same name. Release notes describe source
history; check the installed version and its `stack apply --help` before
assuming its behavior.

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
is successful. A successful apply alone does not establish that all required
secrets are present.

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

For interpreting an existing apply result, see the
[migration checklist](apply-placeholder-migration.md).
For the exact changelog entry that removed the attempts and its site mirror, see the
[placeholder-secret changelog timeline](changelog-placeholder-timeline.md).
For definitions of the historical and current terms, see
[placeholder terminology](apply-placeholder-terminology.md).
For prerequisites, rollback, and recovery, see
[Troubleshooting `stack apply`](apply-troubleshooting.md).
