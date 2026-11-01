# Reader guide: the `stack apply` changelog entry

Find the fix in [CHANGELOG.md, 0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16),
under **Bug fixes**: the first bullet is **`stack apply` stops attempting to
write placeholder secrets.** The 0.2.2 release note says that 0.2.1 was tagged
but did not reach npm, and that 0.2.2 supersedes it. The Unreleased and 0.3.0
entries add operational context; check the version you actually run.

## What changed and why it matters

Previously, wiring tried `phantom add <KEY> TODO_STACK_APPLY --rotate`, then
tried without `--rotate`, for each declared secret. Phantom rejected values in
arguments and did not support `--rotate`, so every call failed and the
reported `envelopes` count was always zero. The fix removed these attempts;
wiring checks names instead of writing to the vault or filling missing values.
Provider setup is separate and may still store real credentials. Consumers of
the wiring result should use `present` and `missing` in place of `envelopes`.

This matters because an apply can finish without all required secrets: missing
names alone do not fail it, though provider failures do. After at least one
provider succeeds, wiring checks names for the whole recipe, including failed
providers. Review both the provider outcome and the wiring report before
depending on the resulting setup.

## Reading the report

With a readable vault, the changelog gives this example for a missing
`OPENAI_API_KEY` and no webhooks:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

Supply each required missing value through Phantom: run
`phantom add OPENAI_API_KEY` for this example in a trusted terminal and enter
the real value there. Do not put a secret value in command arguments.

If the vault is unreadable, the same recipe instead reports:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

The zero counts cover only checked names; they do not prove that no secrets
are missing. Resolve the skipped check before relying on the inventory. Unknown
providers can also be skipped. Wiring can create webhook stubs for recipe
providers even if they failed or the vault is unreadable; `--noWire` skips
both the name checks and the stubs. See [apply troubleshooting](apply-troubleshooting.md)
for help investigating skipped checks.
