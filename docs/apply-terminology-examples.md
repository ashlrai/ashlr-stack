# `stack apply` terminology, with examples

This guide explains the [apply changelog entry](../CHANGELOG.md) and the
0.2.1 fix it references. It describes current source behavior; check the
changelog and `stack apply --help` for your installed version.

| Term | Meaning |
| --- | --- |
| Recipe | A saved list of providers, typically produced by `stack recommend --save` and applied with `stack apply <recipe-id>`. |
| Provider setup | The `stack add` pipeline run for each recipe provider. It may store real credentials through its own workflow. |
| Wiring | The later step that checks declared secret names in Phantom and creates webhook stubs. After at least one provider succeeds, it considers the entire recipe, including failed providers. |
| Secret name / value | A name such as `OPENAI_API_KEY` identifies a vault entry; its value is the actual credential. A present name does not prove the value works. |
| Placeholder | `TODO_STACK_APPLY` was a dummy **value**, not a secret name or usable credential. |
| `envelopes` | The old `WireResult` count of successful placeholder writes. It was always zero because those calls failed. |
| `present` / `missing` | `WireResult` arrays of `provider:secret_name` entries found or not found in a readable Phantom inventory. CLI counts are array lengths, not necessarily unique names. |
| `skipped` | Providers whose secret names could not be classified, for example because the vault is unreadable or the provider is unknown. Skipped does not mean missing or present. |
| Webhook stub | A generated, commented example file, not a registered endpoint or verified handler. Signature verification must be implemented before accepting requests. |

## Old behavior and its replacement

Old wiring attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`, then
retried without `--rotate` for each declared secret. Phantom rejected values
in arguments and did not support `--rotate`; the calls failed, so the old
`envelopes` count was always zero. The fix removed the attempts and replaced
`WireResult.envelopes` with `present` and `missing` arrays.

Current wiring reads names with `phantom list --json`; it does not write to
the vault or fill missing values. For each required missing name, obtain the
real value from the provider and run `phantom add <NAME>` in a trusted
terminal, substituting the name and entering the value when prompted. Provider
setup is separate and may already have stored real values.

## Read the results

The following are illustrative core `WireResult` values, not JSON emitted by
the CLI. Each assumes the provider reached wiring. Paths in the Stripe example
are shown relative to `<project>`; actual results contain absolute paths.

With an OpenAI recipe and a readable vault containing `OPENAI_API_KEY`:

```json
{"present":["openai:OPENAI_API_KEY"],"missing":[],"webhooks":[],"skipped":[]}
```

With the same recipe and a readable vault without that name:

```json
{"present":[],"missing":["openai:OPENAI_API_KEY"],"webhooks":[],"skipped":[]}
```

The CLI reports `secrets in vault 0 · missing 1 · webhooks 0` and names
`OPENAI_API_KEY` on its `not in Phantom:` line. A missing name alone does not
fail apply; `applied` is not proof that all required values exist.

With a Stripe recipe and an unreadable vault, wiring cannot classify its
secret, but can still create the stub:

```json
{"present":[],"missing":[],"webhooks":["<project>/.stack/webhooks/stripe.ts"],"skipped":["stripe"]}
```

Here zero missing entries does not prove that the secret exists. Resolve the
vault problem before interpreting its inventory. A repeated apply can
overwrite stubs; preserve custom work first. A wiring error can leave partial
work behind. See [observing an apply](apply-observation.md) for recovery.

Apply tries every provider; provider failures fail the run even when another
provider succeeds. If none succeeds, wiring is not attempted. `--noWire`
skips both the secret-name check and webhook stubs, with no wiring summary;
provider setup still runs. Doctor's final check is informational.
