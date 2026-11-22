# `stack apply` placeholder terminology

This glossary explains the words used by the `stack apply` entries in the
[root changelog](../CHANGELOG.md) and its
[site copy](../packages/site/src/data/CHANGELOG.md): the historical
`TODO_STACK_APPLY` placeholder, the secret-name inventory reported by current
apply wiring, and example results. It describes current source and the
checked-in changelog entries, not a deployed site or an installed version.
Other commands' `--apply` options have their own meanings. Check the changelog
and `stack apply --help` for the version you use.

## Glossary

| Term | Meaning |
| --- | --- |
| Recipe / provider | A recipe is a saved selection of providers, typically produced by `stack recommend --save`. `stack apply [recipe-id]` runs the `stack add` pipeline for each provider in it. |
| Provider setup | The provider's `stack add` workflow. It may store real credentials through its own workflow and is distinct from the later wiring step. |
| Wiring | The step that checks declared secret names in Phantom and can create webhook stubs. After at least one provider succeeds, it considers every provider in the recipe, including failed providers. |
| Secret name / value | A name such as `OPENAI_API_KEY` identifies a vault entry; its value is the actual credential. Wiring compares declared names with Phantom's inventory and does not fill in values. Finding a name does not validate its value. |
| `TODO_STACK_APPLY` | A literal dummy value that old wiring attempted to add for each declared secret. It was not a credential or a secret name. The calls failed; the placeholder was not successfully stored by those attempts. |
| `envelopes` | The old `WireResult` count of placeholder writes. The 0.2.1 entry says it was always zero because those calls failed. The fix replaced `WireResult.envelopes` with `present` and `missing`; it is not the current present or missing count. |
| `present` / `missing` | `WireResult` arrays of `provider:secret_name` entries found or not found in a readable Phantom inventory. CLI counts are array lengths, not necessarily unique names. A missing name alone does not fail apply; it still needs a real value if required. |
| `skipped` | Providers whose secret names could not be classified, for example because the vault is unreadable or the provider is unknown. Skipped does not mean missing or present. |
| Webhook stub / `webhooks` | A stub is a generated, commented example file, not a registered endpoint or verified handler; the entries name Stripe, Clerk, Supabase and GitHub. `webhooks` is the summary count. Stubs can be created even when the vault is unreadable. See the [stub review](phantom-wire-review.md) for their limitations; signature verification must be implemented before accepting requests. |
| `--noWire` | The opt-out from wiring: it skips both the secret-name check and webhook stubs, and prints no wiring summary. Provider setup still runs. |
| Applied / provider failure | A missing name alone does not fail apply, so an applied recipe does not prove all required secrets are present. Provider failures do fail apply, even though later providers are tried. |

The output label `secrets in vault` refers to the reported present count; it
is not a count of every secret in the vault.

## Old behavior and its replacement

Historically, wiring attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`,
then retried without `--rotate` for each declared secret. Phantom Secrets
refuses values in command arguments and has no `--rotate` option, so every
call failed and the old `envelopes` count was always zero. The 0.2.1 fix
removed these attempts; wiring no longer writes to the vault or fills missing
values. Current wiring reads names with `phantom list --json`. Provider setup
is separate and may already have stored real values.

After at least one provider succeeds, wiring checks the whole recipe, including
failed providers, and can create webhook stubs even if the vault is unreadable.
Provider failures still fail apply. If none succeeds, wiring is not attempted.
For each required missing name, obtain the real value from the provider and run
`phantom add <NAME>` in a trusted terminal, substituting the reported name and
entering the value when prompted. `--noWire` skips both the inventory check and
the stubs. Doctor's final check is informational.

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
`OPENAI_API_KEY` on its `not in Phantom:` line. `applied` is not proof that all
required values exist.

With a Stripe recipe and an unreadable vault, wiring cannot classify its
secret, but can still create the stub:

```json
{"present":[],"missing":[],"webhooks":["<project>/.stack/webhooks/stripe.ts"],"skipped":["stripe"]}
```

Here zero present and missing counts cover only checked names: they do not
prove the secret exists or that the vault is empty or complete. Resolve the
vault problem before interpreting its inventory. A repeated apply can
overwrite stubs; preserve custom work first. A wiring error can leave partial
work behind. See [observing an apply](apply-observation.md) for recovery.

## Changelog wording

The apply entries in the two checked-in changelog files currently match, so there
are **no wording differences between their apply entries**. This comparison does
not establish what a deployed site serves. Within each copy, the entries use
different levels of detail and describe a historical change:

| Entry in both files | Wording and context |
| --- | --- |
| Unreleased → Changed | Explicitly says wiring covers failed recipe providers after at least one success, and stubs can be created with an unreadable vault. |
| 0.3.0 → Changed and fixed / Changed | Uses “existing secret names” and “missing secret names”; the longer entry gives output examples and explains that skipped providers do not establish missing or present values. |
| 0.2.2 → Bug fixes | Describes resolving a missing recipe before initialization and continuing through provider failures, rather than the wiring inventory. |
| 0.2.1 → Bug fixes | Calls the old dummy value a placeholder, describes the failed attempts and replaces `envelopes` with `present` and `missing`. |
| 0.1.0 → AI recommendation layer | Describes the recipe command, wiring and webhook providers; this entry incorporates the later 0.2.1 fix, so it should not be read as a standalone account of the original behavior. |

The shorter phrases “missing secrets,” “missing names” and “missing values”
refer to related but distinct things: wiring reports absent names, while the
user must supply the corresponding real values when required. A readable name
inventory alone does not establish that a credential works.

For the release timeline, including publication of the fix, see the
[changelog timeline](changelog-placeholder-timeline.md). For recovery
questions, see the [placeholder FAQ](apply-placeholder-faq.md).
