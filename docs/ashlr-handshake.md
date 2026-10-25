# Ashlr companion handshake (v1)

`stack --ashlr-handshake` prints one JSON object and exits 0. `phm companions`,
`phm doctor` or an agent can call it instead of parsing `--help`. The same
contract is implemented by `locus --ashlr-handshake` and
`ashlr-plugin --ashlr-handshake`.

```json
{
  "kind": "ashlr.handshake",
  "schema_version": 1,
  "name": "ashlr-stack",
  "command": "stack",
  "version": "0.2.2",
  "protocols": { "ashlr.handshake": 1, "phantom.agent.preflight": 1 },
  "capabilities": ["provision-services", "store-credentials-in-phantom", "mcp-server", "agent-onboard", "agent-preflight", "doctor-json"],
  "health": { "status": "ok", "checks": [{ "id": "phantom-on-path", "status": "ok" }, { "id": "stack-config", "status": "absent" }] },
  "edits": [".stack.toml", ".stack.local.toml", ".mcp.json", ".cursor/mcp.json", "~/.claude.json", "~/.codex/config.toml", "~/.cursor/mcp.json", "~/.gemini/settings.json"],
  "receipts": []
}
```

Rules every implementation follows:

- **Fast and local:** no network, no vault or keychain, and no secret values or project contents in the output.
- **Stable shape:** `kind` and `schema_version` identify the contract. New fields may be added in v1; renames or removals bump `schema_version`.
- **Ids:** `capabilities` and check `id`s are kebab-case. `protocols` maps a protocol name to the version spoken.
- **Health:** `health.status` is `ok`, `degraded` (works, something it relies on is missing) or `unknown`. A check status is `ok`, `missing` (counts against health) or `absent` (informational, such as no `.stack.toml` in this directory).
- **Edits:** paths the CLI may write. `~/` is the home directory; other paths are relative to the project.
- **Receipts:** receipt kinds the CLI emits (none yet; reserved for receipt.v1).

## Reading other tools: `stack doctor --ecosystem`

`stack doctor --ecosystem` (add `--json` for `{ "ecosystem": [...] }`) runs
`<command> --ashlr-handshake --json` for `phm`, `phantom`, `locus`, `lexicon`,
`mdopener-mcp` and `ashlr-plugin`, and shows each tool's name, version and
capabilities. Each probe has a 2 second timeout, and its environment is only
PATH, HOME, USER, locale and TMPDIR, so no token reaches another tool. A tool
that is not installed is `missing`; one that does not answer v1 in time is
`no-handshake`. Neither fails the run, and no `.stack.toml` is needed.

When locus answers with health other than `ok` and lists the `doctor-fix`
capability, a "Next steps" block suggests `locus doctor --fix` (a dry run;
`--apply` makes the repairs). `--json` carries the same lines in
`next_steps`. The suggestion keys on the capability only, never on the
version, so a locus that does not advertise `doctor-fix` gets none, and a
healthy locus gets nothing extra.

## Conformance kit

The machine-readable v1 contract is `contract/ashlr-handshake.v1.json` in this
repo, with its sha256 in `contract/ashlr-handshake.v1.json.sha256`. It lists
the required fields and their types, the health enums, the kebab-case id rule,
and the **gated capabilities**: capabilities another tool acts on, each with the
argv it must accept.

| Capability | Argv the tool must accept | Expectation |
|---|---|---|
| `doctor-fix` | `doctor --fix --json` | read-only preview, exit 0 or 1, stdout JSON with `mode` and `plan` |

Each implementation (stack, locus, lexicon, mdopener-mcp, ashlr-plugin) vendors
the contract file and one small test that:

1. checks the vendored file against the pinned sha256 (no network fetch in CI),
2. runs its own `--ashlr-handshake --json` and validates it against the contract,
3. for every gated capability it advertises, runs the mapped argv in a throwaway
   HOME and checks the exit code and output shape.

`packages/cli/src/lib/handshake-conformance.ts` is a dependency-free reference
checker that TypeScript repos can vendor as is. Stack's own test also checks
that `stack doctor --ecosystem --fix` runs exactly the contract's `doctor-fix`
argv, so the consumer cannot drift from the contract either.

`stack doctor --ecosystem` applies the same check at run time. A tool that
answers v1 but drifts from the contract is shown as `!!   <name> <version> ...
(contract drift: N problems)`, with up to three short problems in `--json`
(`contract: "drift"`, `contract_problems`) and a Next steps line to upgrade it.
A conforming tool gets `contract: "ok"`. A drifting tool is never run by
`stack doctor --ecosystem --fix`, even if it lists `doctor-fix`, because Stack
cannot trust it to honor the contract's argv. Drift is informational and never
fails the run. The CLI bundles a byte-identical copy of the contract
(`packages/cli/src/lib/handshake-contract.v1.json`), checked by a test.

Changing the contract: edit the JSON (and its bundled copy) (new optional fields and new gated
capabilities stay v1; renames or removals bump `schema_version`), update the
`.sha256` file and the pin in `handshake-conformance.test.ts`, then re-vendor
the file and pin in each tool.
