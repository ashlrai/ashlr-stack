# Migrating from `stack apply` placeholder attempts

This guide follows the [changelog](../CHANGELOG.md): the 0.2.1 fix removed
the placeholder attempts, and the 0.3.0 and Unreleased entries clarify the
reported behavior. Check the changelog and `stack apply --help` for the
version you actually use; a source changelog is not proof of an installed
version.

Previously, wiring attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`,
then tried without `--rotate`. Those calls failed: Phantom rejected values in
arguments and did not support that option. The old `envelopes` count was
always zero. Do not rely on those attempts to have created usable secrets.

Now, after at least one provider succeeds, wiring checks the recipe's declared
secret names against Phantom and may create webhook stubs. It does not add
placeholders or fill missing values. Provider setup is separate and may store
real credentials. The wiring result uses `present` and `missing` instead of
`envelopes`; consumers of the core result should update accordingly.

## Verification checklist

Use the output of an apply you have already run. Applying again can provision
resources or change project files; inspect the recipe, provider state and
existing webhook files before deciding to rerun it.

- [ ] Check the provider results and exit status. Provider failures fail
  apply even though it continues to later providers. If at least one succeeds,
  wiring checks the whole recipe, including failed providers and providers
  whose setup was rolled back. If none succeeds, wiring is not attempted.
- [ ] If wiring reports `not in Phantom`, obtain each required value from
  its provider. In a trusted terminal, run `phantom add <NAME>` with the
  reported name substituted, and enter the real value when prompted. Do not
  pass the value as an argument. Missing names alone do not fail apply.
- [ ] If wiring reports `skipped`, resolve the vault inventory problem before
  interpreting the counts. Unknown providers are also skipped. Zero present
  and missing counts describe checked names only; they do not prove the vault
  is empty or complete. See [troubleshooting](apply-troubleshooting.md).
- [ ] If apply reports `phantom-wire failed`, the wiring operation did not
  complete. Investigate the reported error and check both the inventory and
  webhook files; the warning alone does not make apply fail, and files may
  have been written before the error.
- [ ] Confirm required names are present in Phantom, then verify the actual
  credentials and services separately. A present name does not prove that its
  value works, and an applied recipe does not prove that all secrets exist.
- [ ] Review any `.stack/webhooks` stubs for recipe providers. Wiring can
  create them even for failed providers or with an unreadable vault, and may
  overwrite existing stubs. They are commented examples and do not verify
  signatures; implement verification before accepting requests.
- [ ] If `--noWire` was used, account for both the skipped inventory check
  and skipped webhook stubs. No wiring summary is printed; provider setup
  still runs and may store real credentials.

## Updating core consumers

Code consuming `wirePhantomForRecipe` should replace `envelopes` with the
`present` and `missing` arrays, and inspect `skipped` before treating an
inventory as complete. Entries in `present` and `missing` have the form
`provider:SECRET_NAME`; their lengths count declared provider-secret entries,
not unique vault names. Repeated providers can produce repeated entries.
`webhooks` contains paths to generated stubs. With `noWire: true`, all four
arrays are empty: that result means wiring was disabled, not that the vault
was checked. A thrown error means wiring did not complete and may already
have written some stubs.

For example, an OpenAI recipe checked against a readable vault without its key
returns `missing: ["openai:OPENAI_API_KEY"]`, with empty `present`, `skipped`
and `webhooks` arrays. These arrays contain names and paths, never secret
values. Neither `present` nor `missing` is a count of values written.

For a readable vault with `OPENAI_API_KEY` missing and no webhooks, the
changelog shows:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

For the same recipe with an unreadable vault, it shows:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

For this example, use `phantom add OPENAI_API_KEY` in a trusted terminal
when the name is missing; first resolve the skipped check if the vault was
unreadable. See [observing an apply](apply-observation.md) for the rest of the
output and [the placeholder FAQ](apply-placeholder-faq.md) for more detail.
