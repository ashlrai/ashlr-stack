# @ashlr/stack-core

> Shared library behind the [Ashlr Stack](https://stack.ashlr.ai) CLI and MCP server. Provider adapters, `.stack.toml` config, Phantom integration, source/env detection.

This package shares source between the [`@ashlr/stack`](https://www.npmjs.com/package/@ashlr/stack) CLI and [`ashlr-stack-mcp`](https://www.npmjs.com/package/ashlr-stack-mcp) server. Its exports point at TypeScript source. The examples below describe workspace use; installing the package does not by itself establish Node-only execution support.

## Use in this workspace

From the repository root, prepare the workspace dependencies with Bun 1.2+:

```bash
bun install
```

Use the selected CLI/MCP artifact and its documented runtime when installing
those products. Verify installed versions, package contents and runtime
requirements separately.

## Public API

Selected exports — see `src/index.ts` for the full surface.

| Export | Purpose |
| --- | --- |
| `addService({ providerName, ... })` | Attempt login → create/attach → materialize → named-secret/MCP/config writes; inspect failures and partial state |
| `readConfig(cwd)` / `writeConfig(cfg, cwd)` | Read/write `.stack.toml` + `.stack.local.toml` |
| `listProviderNames()` / `getProvider(name)` | Introspect the built-in 39-provider registry (`getProvider` is async) |
| `scanSource(cwd)` | Detect providers from `package.json`, configs, `.env.example` |
| `detectProvider(envName)` | Map an env-var name back to a known provider |
| `parseEnv(text)` | Parse `.env`-style text into `{ key, value }` pairs |

### Example

```ts
import {
  addService,
  readConfig,
  listProviderNames,
  scanSource,
} from "@ashlr/stack-core";

// With explicit user approval for provider and credential effects, attempt
// Supabase setup, named-secret/MCP writes, and split-config persistence.
await addService({ providerName: "supabase", cwd: process.cwd() });

const cfg = await readConfig();
console.log(Object.keys(cfg.services));

// Scan an existing checkout for providers already wired up.
const detections = await scanSource(process.cwd());
console.log(detections);
console.log(listProviderNames().length); // 39 in this source snapshot
```

The setup path can contact providers and write credentials, MCP entries and
split config. It handles values in memory; writes and rollback are not an
atomic transaction. Examples describe reviewed source and require the selected
artifact, runtime, project directory, user authorization and provider access.
A package installation does not establish those later steps.

## Links

- Full CLI-level docs — [stack.ashlr.ai/docs/cli](https://stack.ashlr.ai/docs/cli)
- Repo — [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack)

## License

MIT. See [LICENSE](../../LICENSE).
