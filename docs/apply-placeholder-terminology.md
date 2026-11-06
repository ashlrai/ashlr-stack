# `stack apply` placeholder terminology

This glossary distinguishes the historical placeholder from the secret-name
inventory reported by current apply wiring. It follows the 0.1.0 apply entry
and the 0.2.1 bug fix in both the [root changelog](../CHANGELOG.md) and its
[site copy](../packages/site/src/data/CHANGELOG.md). Check the changelog for
the version you use.

| Term | Meaning |
| --- | --- |
| `TODO_STACK_APPLY` | A literal dummy value that old wiring attempted to add for each declared secret. It was not a credential or a secret name. The calls failed; the placeholder was not successfully stored by those attempts. |
| Secret name | An identifier such as `OPENAI_API_KEY`, not the credential value. Wiring compares declared names with Phantom's inventory; finding a name does not validate its value. |
| `envelopes` | The old `WireResult` count, which was always zero because the placeholder-add calls failed. The fix replaced `WireResult.envelopes` with `present` and `missing`. |
| `present` / `missing` | Results of comparing declared secret names with a readable Phantom inventory. A missing name alone does not fail apply; it still needs a real value if required. |
| `skipped` | Providers whose secret names could not be classified, including when the vault cannot be read. Skipped does not mean missing or present. |

Historically, wiring attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`,
then retried without `--rotate`. Phantom Secrets refuses values in command
arguments and has no `--rotate` option, so every call failed. The 0.2.1 fix
removed these attempts: wiring no longer writes to the vault or fills missing
values. Provider setup is separate and may store real credentials through its
own workflow.

After at least one provider succeeds, wiring checks the whole recipe, including
failed providers, and can create webhook stubs even if the vault is unreadable.
Provider failures still fail apply. Supply each required missing value by
running `phantom add <NAME>` in a trusted terminal and entering the real value;
replace `<NAME>` with the reported name. `--noWire` skips both the inventory
check and the stubs.

For the release timeline, including publication of the fix, see the
[changelog timeline](changelog-placeholder-timeline.md). For output examples
and recovery, see the [placeholder FAQ](apply-placeholder-faq.md).
