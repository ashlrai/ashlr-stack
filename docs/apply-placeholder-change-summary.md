# `stack apply` placeholder change

The [0.2.1 bug fix in CHANGELOG.md](../CHANGELOG.md#021-2026-10-16)
records why `stack apply` stopped trying to write placeholder secrets.

Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate` for
each declared secret, then tried again without `--rotate`. Both attempts
failed: Phantom Secrets has no `--rotate` option and refuses values in
command arguments. No placeholder was stored, and the reported `envelopes`
count was always zero. These commands are historical, not instructions to
run.

Now wiring checks existing secret names with `phantom list --json`; it never
writes to the vault or fills missing values. With a readable vault, it reports
present and missing names, along with webhook counts; if the vault is
unreadable, it reports providers as skipped instead of identifying missing
names. `WireResult.present` and `WireResult.missing` replace
`WireResult.envelopes`. Provider setup may separately store real values. For
each required missing secret, run `phantom add <NAME>` in a trusted terminal
and enter the real value when prompted.
