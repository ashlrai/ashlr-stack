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
