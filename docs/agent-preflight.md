# Phantom agent preflight for `stack exec` and `stack doctor`

`stack exec -- <cmd>` runs `<cmd>` under `phantom exec`, so env vars holding
`phm_` placeholders reach providers as real keys only through Phantom's local
proxy. Put placeholders in `.env`, never raw keys, and start tools like this:

```bash
stack exec -- npm run dev
# or directly
phantom exec -- npm run dev
```

## Opt-in preflight

Set `STACK_PHANTOM_PREFLIGHT` to have `stack exec` run
`phantom agent doctor --json --strict` first. It is off by default.

| Value | Behavior |
|---|---|
| unset, `0` | No preflight. |
| `1`, `true`, `on` | Stop on `blocked`; warn and continue on `degraded` or `unknown`. |
| `strict` | Stop on anything but `ready`. |

The preflight follows phantom-secrets
[docs/agent-preflight-contract.md](https://github.com/ashlrai/phantom-secrets/blob/main/docs/agent-preflight-contract.md)
(schema version 1, exit codes 0 ready, 2 degraded, 1 blocked, 3 could not
evaluate). It reads only project files and environment variables: no vault
open, no keychain access. Stack prints the verdict and, when blocked, the
critical check ids. It never prints secret names or values.

If `phantom` is missing, or is a version without `agent doctor --json`, the
preflight prints a one-line warning and `stack exec` continues. Run
`phantom agent doctor` for the full report with fix commands.

## In `stack doctor`

With the same variable set, `stack doctor` (this project only, not `--all`)
adds the preflight: a line in the human output, and a `phantom_preflight`
object in `--json` with `verdict`, `blocked_by` (check ids) and `refuse`. A
refusal under the table above makes doctor exit 1; a warning does not.
