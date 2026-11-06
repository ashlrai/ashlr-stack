# Upgrade questions: `stack apply` and placeholder secrets

Use these questions with the [changelog](../CHANGELOG.md) and the output of an
apply already run in the project. The 0.2.1 fix was tagged but not published;
0.2.2 superseded it, and 0.3.0 and Unreleased clarify the behavior. Check the
installed version and its `stack apply --help`: the source changelog alone does
not establish what is installed.

## What changed?

Old wiring tried to add `TODO_STACK_APPLY` as a value for every declared
secret. Those calls failed; they did not create usable credentials. The fix
removed the attempts. Wiring no longer writes placeholders or fills missing
values in Phantom. Provider setup is separate and may store real credentials.
For core consumers, `WireResult.envelopes` was replaced by `present` and
`missing`.

After at least one provider succeeds, wiring checks secret names for the whole
recipe, including failed providers, and may create webhook stubs. A missing
name alone does not fail apply; provider failures do. If no provider succeeds,
wiring is not attempted. `--noWire` skips both the inventory check and stubs.

## What must I supply?

For every **required** name reported as missing, obtain the real value from
the provider. In a trusted terminal, run `phantom add <NAME>` with the reported
name substituted and enter the value when prompted. Do not put the value in
command arguments or use a dummy value. For example, for `OPENAI_API_KEY`,
the changelog shows:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

Use `phantom add OPENAI_API_KEY` in the trusted terminal. Names already stored
by provider setup do not need to be added again merely because of this change.
Presence is only a name check; verify the credential and service separately.

## Which questions are still unresolved?

Use the saved output, the recipe, and provider state to answer each question.
Record the affected provider or secret **name**, the evidence, and the next
action; do not record secret values in the checklist or share them in logs.

| Question | Leave open when | Next action |
| --- | --- | --- |
| Did every provider succeed? | A provider failed, rollback needs review, or its outcome is unknown. | Investigate the provider and inspect remaining local and upstream state before retrying. |
| Are required secrets present? | `not in Phantom` lists a required name, or the inventory was not checked. | Supply real values for required missing names; resolve an unchecked inventory before deciding what is missing. |
| Was the inventory checked? | Output lists `phantom-wire skipped`, reports `phantom-wire failed`, has no wiring summary because `--noWire` was used, or no provider succeeded. | Investigate the skipped or failed check and inspect the vault in the project; unknown providers are also skipped. |
| Do stored credentials work? | Only name presence or a successful apply has been observed. | Verify provider access and application behavior separately. |
| Are webhook handlers ready? | A generated stub is needed but has not been implemented and verified. | Review the stub and implement provider-specific signature verification before accepting requests. |
| Do consumers of the core result need an update? | They still depend on `WireResult.envelopes`. | Adapt them to `present` and `missing` and review their interpretation of skipped providers. |

For example, an unreadable vault can produce:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

The zero counts cover checked names only; they do not prove that no secrets
are missing or that the vault is empty. Webhook stubs can still be created for
recipe providers when the vault is unreadable or a provider failed. They are
commented examples, do not verify signatures, and may overwrite existing stubs.

Do not rerun apply solely to inspect it: it can provision resources and change
files. See [observing an apply](apply-observation.md) and
[troubleshooting](apply-troubleshooting.md) for inspection and recovery, and
the [migration checklist](apply-placeholder-migration.md) for more detail.
