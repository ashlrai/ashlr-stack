# Copy-paste examples

These `stack` commands exit 0 with no account on the published CLI: `stack providers --json`, `stack recommend "B2B SaaS with auth, AI, and payments" --json`, `stack scan --json`, `stack templates list --json`, `stack onboard --json`, and `stack doctor --ecosystem --json`. The published 0.3.6 CLI and MCP manifests declare Node.js 20 or newer. Check `stack <command> --help` on your install before you rely on a flag.

Agent indexes: [llms.txt](https://stack.ashlr.ai/llms.txt) and [llms-full.txt](https://stack.ashlr.ai/llms-full.txt).

## Read the catalog

No account. Writes nothing.

```bash
npx -y -p @ashlr/stack stack providers --json
npx -y -p @ashlr/stack stack recommend "B2B SaaS with auth, AI, and payments" --json
npx -y -p @ashlr/stack stack scan --json
npx -y -p @ashlr/stack stack templates list --json
```

`stack scan --json` in an empty directory prints `{ "hits": [] }` and leaves the directory empty.

## Install

macOS or Linux:

```bash
curl -fsSL stack.ashlr.ai/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://stack.ashlr.ai/install.ps1 | iex
```

Registry:

```bash
npm i -g @ashlr/stack ashlr-stack-mcp
```

## See which agents would be wired

Plan only. This does not edit config files. Add `--apply` only when the user asked you to write the Phantom gateway entry.

```bash
stack onboard --json
```

## See which Ashlr tools are installed

Read-only. A missing tool is reported. The command does not install anything.

```bash
stack doctor --ecosystem --json
```

## MCP server

Claude Code:

```bash
claude mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp
```

Codex:

```bash
codex mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp
```

Cursor (`~/.cursor/mcp.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "ashlr-stack": {
      "command": "npx",
      "args": ["-y", "-p", "@ashlr/stack", "-p", "ashlr-stack-mcp", "ashlr-stack-mcp"]
    }
  }
}
```

## Commands that write

Do not paste these until the user has named the project and the provider. They can contact a provider or store secrets. Check `phantom status --json` first. The command names are `stack add`, `stack apply`, `stack import`, and `stack onboard --apply`.

Model host overrides: [model-endpoints.md](model-endpoints.md).
