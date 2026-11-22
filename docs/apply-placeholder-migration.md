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
output, [the placeholder FAQ](apply-placeholder-faq.md) for more detail, and
the [migration questions](#migration-questions) below for questions about the
former behavior.

## Migration questions

Each answer is limited to what the [changelog](../CHANGELOG.md) records. The
changelog describes the code across releases, not the state of an individual
vault, project or installed copy, and 0.2.1 was tagged without reaching npm.

### What did the former wiring attempt?

For every declared secret, wiring ran
`phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without
`--rotate`. The [0.2.1 entry](../CHANGELOG.md#021-2026-10-16) records this as
the behavior its fix removed, and the
[0.1.0 apply entry](../CHANGELOG.md#010--2026-04-19-superseded-by-011) is
annotated with the same history.

### Did the attempts ever write a placeholder to the vault?

No. Phantom Secrets refuses secret values in command arguments and has no
`--rotate` option, so every call failed and the printed `envelopes` count was
always 0. The changelog records failed attempts, not stored placeholders;
they did not create usable credentials.

### Did the attempts rotate or overwrite stored secrets?

No. There was no `--rotate` option to invoke, every call failed regardless of
which form ran, and the changelog also records that Phantom never replaces a
stored name. The attempted option rotated nothing.

### What did the `envelopes` count report?

Always 0, because every placeholder call failed. The fix replaced
`WireResult.envelopes` with `present` and `missing`, which report checked
secret names rather than attempted writes.

### Which release removed the attempts?

The removal is recorded under [0.2.1](../CHANGELOG.md#021-2026-10-16), but
0.2.1's npm publish failed, so nothing from it reached npm.
[0.2.2](../CHANGELOG.md#022-2026-10-25) superseded it and ships everything
listed under 0.2.1. The later entries,
[0.3.0](../CHANGELOG.md#030-2026-10-31) and
[Unreleased](../CHANGELOG.md#unreleased), describe only the name-checking
wiring, with the missing-secret example output and the unreadable-vault case.

### How do I tell which wiring my installed copy runs?

Compare the installed version against the release entries above. `stack
--version` reports the running version, and on releases that have it
`stack upgrade --json` prints `current` and `latest` while installing
nothing. `stack apply --help` shows whether the installed copy accepts
flags such as `--noWire`. This repository's changelog does not establish what
is installed.

### Did provider setup write placeholders too?

The changelog does not say that. It notes provider setup may store real values
through its own workflow, separately from wiring. The placeholder attempts
belonged to the wiring step, which now checks names against
`phantom list --json` and never writes to the vault or fills missing values.

### Must I delete placeholder values apply left behind?

The changelog prescribes no cleanup of existing secrets. Every recorded call
failed, so it describes no apply-written placeholders to remove. Whether your
vault holds one is not answered there; run `phantom list --json` to look. What
it prescribes runs the other direction: supply each required *missing* value
yourself.

### Why does apply succeed while secrets are missing?

A missing name alone does not fail apply; provider failures do. Read the
`secrets in vault N · missing M · webhooks K` line and the `not in Phantom:`
list rather than the exit status. To supply a missing secret, run
`phantom add <NAME>` in a trusted terminal and enter the real value when
prompted. Never pass it as a command argument; apply writes nothing for you.

### What if the vault is unreadable?

Providers are reported as skipped, not missing, so no names are listed. Fix
vault access and re-run; the changelog does not claim a skipped provider has
its secrets.

### Do I need to re-run `stack apply` to fix old state?

The changelog prescribes no re-run, and records no apply-written vault state
to repair. A re-run is a real operation rather than an inspection: apply
re-runs provider setup for every recipe provider and can create webhook stubs
even when a provider failed or the vault is unreadable. `--noWire` skips both
the name check and the stubs. The recorded remediation is supplying each
required missing value yourself.

### What does the changelog not answer?

- Whether a `TODO_STACK_APPLY` value sits in a particular vault. Every
  recorded call failed, but the changelog does not establish an individual
  vault's contents.
- Whether a historical apply run failed when its placeholder calls failed.
  The changelog records that the calls failed and `envelopes` printed 0, not
  the exit status of those runs.
- Which behavior a given install exhibits. Compare the installed version's
  own changelog and `stack apply --help`; this repository's changelog does
  not establish what is installed.

For where each entry records the removal, see the
[placeholder command history](apply-placeholder-command-history.md) and the
[changelog placeholder timeline](changelog-placeholder-timeline.md).
