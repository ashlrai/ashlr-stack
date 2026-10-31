# Inspecting a `stack apply` result

Run these checks in the same project directory as the apply. This guide
describes the current source CLI; check `stack apply --help` and the
[changelog](../CHANGELOG.md) for the version you use. Keep the apply output:
the later inspection commands describe current state, not a replay of its
wiring summary.

## 1. Read the apply output

Compare the printed recipe and provider list with the saved
`.stack/recipes/<recipe-id>.toml`. Apply attempts the providers in order and
reports individual failures. `Some providers failed` means the apply failed;
inspect the rollback messages as well. On partial failure, rollback is
best-effort and can leave upstream resources or local state behind. In a
headless run it is attempted by default; `--noRollback` keeps successful adds.
See [apply troubleshooting](apply-troubleshooting.md) before retrying.

After at least one provider succeeds, apply attempts wiring for the **whole
recipe**, including failed providers and even after a rollback attempt. For
example, the changelog shows this output when `OPENAI_API_KEY` is missing:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

`missing 1` identifies a missing secret name: obtain the real value through
the provider and use `phantom add OPENAI_API_KEY` in a trusted terminal. The
wiring step does not create placeholders. A missing name alone does not fail
apply, so the final `applied` message is not proof of complete wiring.

When the vault cannot be read, the same recipe can instead show:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

`skipped` means the inventory is unknown for those providers, not that their
secrets are present or absent. Zero counts describe only the names checked.
Unknown providers can also be skipped. A `phantom-wire failed` warning means
wiring may have stopped partway through. No wiring summary is printed with
`--noWire`, which skips both the vault check and webhook stubs; wiring is also
not attempted if no provider succeeds. In each case, the output does not
establish complete wiring. Check `phantom status --json` and `phantom list
--json` in the project when the inventory is unreadable; resolve errors before
interpreting it. These commands inspect metadata and names, not secret values.

## 2. Inspect current configuration and health

```sh
stack list --json
stack status --json
stack info <service> --json
stack doctor --json
```

Compare `stack list`'s configured services, resource IDs, secret names and MCP
entries with the recipe and apply output. Replace `<service>` with a configured
service name for `stack info`; its `secrets[].in_vault` is `true`, `false`, or
`null` (unknown when the vault cannot be read). Its health check may contact
the provider and may be unavailable. `stack status` reports configuration and
the vault's total name count, not whether each recipe secret is present. A
`secret_count` of `null`, `secret_count_error`, or `installed_error` indicates
an uncertain probe, not an empty vault.

Apply runs doctor as an informational final check; its findings do not determine
apply success. Review the separate doctor's per-service findings, including
warnings and unchecked services. Neither a listed secret name nor a healthy
check proves the application can use every credential or integration. Verify
the actual provider resources and application behavior independently.

## 3. Inspect webhook examples

If the wiring summary reports webhooks, inspect `.stack/webhooks/` in the
project. The count describes generated files, not deployed or registered
endpoints. These are commented examples without signature verification; they
are not authenticated handlers. Implement and verify the provider's signature
scheme before accepting requests. A repeated apply can overwrite existing
stubs, so preserve custom work first. See [Phantom wiring status](phantom-wiring-status.md)
for details.
