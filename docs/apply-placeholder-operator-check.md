# Operator check: historical `stack apply` placeholder issue

Use this check on a previous apply's output and the project where it ran. The
[0.2.1 changelog fix](../CHANGELOG.md#021-2026-10-16) records the historical
issue; the 0.3.0 and Unreleased entries describe current behavior. The 0.2.1
npm publish failed and 0.2.2 superseded it. Check the installed version and its
`stack apply --help`; a source changelog alone does not establish what is
installed. Keep logs and vault output within your trusted environment.

1. **Look for the old signal.** Historical wiring attempted to add the marker
   `TODO_STACK_APPLY` for each declared secret, first with an unsupported
   `--rotate` option and then without it. Phantom rejected values in command
   arguments, so the calls failed and the old `envelopes` count was always 0.
   An old zero count is a sign of the failed attempt, not proof of stored
   credentials or of an empty vault. Do not create placeholder values.
2. **Read the current wiring result, if present.** For a readable vault, the
   changelog gives this example:

   ```text
     secrets in vault 0 · missing 1 · webhooks 0
     (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
   ```

   `not in Phantom` identifies a missing name, not a stored placeholder.
   Obtain each required value from its provider and run `phantom add <NAME>`
   in a trusted terminal, replacing `<NAME>` with the reported name and
   entering the real value when prompted. Do not put the value in arguments.
   A present name does not establish that its value works. Provider setup may
   separately have stored real credentials.
3. **Treat skipped checks as unknown.** The same recipe with an unreadable
   inventory can report:

   ```text
     secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
     (phantom-wire skipped: openai)
   ```

   These zero counts cover checked names only; they do not prove the vault is
   empty or complete. Unknown providers are also skipped. Resolve inventory
   access using [apply troubleshooting](apply-troubleshooting.md) before
   deciding which names are missing. A `phantom-wire failed` warning also
   requires investigation; it is not a successful inventory check.
4. **Check the scope and outcome.** Wiring runs only after at least one
   provider succeeds, and then checks the whole recipe, including failed or
   rolled-back providers. `--noWire` skips the inventory check and webhook
   stubs, with no wiring summary. Missing names alone do not fail apply;
   provider failures do. Verify required credentials and services separately.

Current wiring does not write placeholders or fill missing values. It can
create commented webhook stubs even for failed providers or when the vault is
unreadable, and a repeat can overwrite them. Inspect provider state and
existing files before rerunning apply; the stubs need signature verification
before use. See [placeholder history](apply-placeholder-history.md) and
[apply troubleshooting](apply-troubleshooting.md) for recovery details.
