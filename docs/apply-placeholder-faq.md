# FAQ: `stack apply` and placeholder secrets

This describes the behavior in the [0.2.1 apply fix](../CHANGELOG.md#021-2026-10-16)
and the [0.3.0 apply notes](../CHANGELOG.md#030-2026-10-31). The 0.2.1 fix
was tagged but its npm publish failed; 0.2.2 superseded it, and 0.3.0 and
Unreleased clarify the behavior. Check the installed version and its
`stack apply --help`: this repository's changelog does not establish which
version is installed.

It covers the current behavior, how to recognize and remediate the old
attempts, and an upgrade questionnaire for an apply already run in a project.

## Does apply put placeholder values in Phantom?

No. After at least one provider succeeds, apply's wiring step checks the
recipe's declared secret names against `phantom list --json`. It does not
write to the vault or fill missing values. Provider setup is separate and may
store real credentials through its own workflow.

The 0.2.1 fix removed older attempts to add a placeholder for every declared
secret. Those calls failed; they did not create usable credentials. The
wiring step now checks names instead. For core consumers, the reported
`WireResult.envelopes` field was replaced by `present` and `missing`.
See the [history](apply-placeholder-history.md).

## How can I recognize the old behavior?

Historical wiring attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`, then
retried without `--rotate`. According to the [0.2.1 changelog](../CHANGELOG.md#021-2026-10-16),
Phantom has no `--rotate` option and rejects values passed in command
arguments, so every call failed. The attempted option did not rotate secrets.
The old `envelopes` count was always 0. The marker and count identify the
historical behavior; the changelog does not establish the state of an
individual vault or prescribe a migration of existing secrets. Do not run
either historical command.

## What must I supply for a missing name?

A secret name identifies a credential; it is not the credential itself. A
placeholder cannot authenticate to a provider and may occupy a name needed for
the real value. With a readable vault, an OpenAI-only recipe missing
`OPENAI_API_KEY` can report:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

This reports a missing name, not a stored placeholder. For every **required**
missing name, obtain the real value from the provider. In a trusted terminal,
run `phantom add <NAME>`, replacing `<NAME>` with the reported name, and enter
the real value when prompted. For this example, run `phantom add OPENAI_API_KEY`.
Do not put the value in command arguments or use a dummy value. Names already
stored by provider setup do not need to be added again merely because of this
change.

## Does a successful apply mean the secrets are ready?

No. Missing names alone do not fail apply; provider failures do. So an applied
recipe does not prove that all required secrets are present, and a present
name does not prove its value works; verify credentials and services
separately. Wiring checks names for the whole recipe, including failed
providers and providers whose setup was rolled back.

## What if the vault cannot be read?

The same recipe can instead report:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

The zero counts cover checked names only; they do not prove the vault is empty
or complete. Unknown providers are also skipped. Resolve the inventory problem
before deciding which names are missing; see
[apply troubleshooting](apply-troubleshooting.md).

## What else does wiring do, and can I skip it?

Wiring can create commented webhook stubs for supported recipe providers,
including failed providers and when the vault is unreadable. These examples
are not authenticated handlers, do not verify signatures, and repeated wiring
can overwrite them. `--noWire` skips both the vault check and webhook stubs and
prints no wiring summary. Provider setup still runs and may store real
credentials; apply still requires Phantom. If no provider succeeds, wiring is
not attempted.

## Upgrade questionnaire

Use the saved output of an apply already run in the project, the recipe and
provider state to answer each question. Record the affected provider or secret
**name**, the evidence and the next action; do not record secret values in the
checklist or share them in logs.

| Question | Leave open when | Next action |
| --- | --- | --- |
| Did every provider succeed? | A provider failed, rollback needs review, or its outcome is unknown. | Investigate the provider and inspect remaining local and upstream state before retrying. |
| Are required secrets present? | `not in Phantom` lists a required name, or the inventory was not checked. | Supply real values for required missing names; resolve an unchecked inventory before deciding what is missing. |
| Was the inventory checked? | Output lists `phantom-wire skipped`, reports `phantom-wire failed`, has no wiring summary because `--noWire` was used, or no provider succeeded. | Investigate the skipped or failed check and inspect the vault in the project; unknown providers are also skipped. |
| Do stored credentials work? | Only name presence or a successful apply has been observed. | Verify provider access and application behavior separately. |
| Are webhook handlers ready? | A generated stub is needed but has not been implemented and verified. | Review the stub and implement provider-specific signature verification before accepting requests. |
| Do consumers of the core result need an update? | They still depend on `WireResult.envelopes`. | Adapt them to `present` and `missing` and review their interpretation of skipped providers. |

Do not rerun apply solely to inspect it: it can provision resources and change
files. Inspect provider state and existing webhook files first. See
[observing an apply](apply-observation.md) and
[troubleshooting](apply-troubleshooting.md) for inspection and recovery, and
the [migration checklist](apply-placeholder-migration.md) for more detail.
