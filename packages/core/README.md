# @ashlr/stack-core

> Shared library behind the [Ashlr Stack](https://stack.ashlr.ai) CLI and MCP server. Provider adapters, `.stack.toml` config, Phantom integration, source/env detection.

**You probably don't want to install this directly.** If you want the CLI, install [`@ashlr/stack`](https://www.npmjs.com/package/@ashlr/stack). This package exists so the CLI and the [`ashlr-stack-mcp`](https://www.npmjs.com/package/ashlr-stack-mcp) server can share a single implementation.

## Install

```bash
bun add @ashlr/stack-core
# or
npm i @ashlr/stack-core
```

## Public API

Selected exports — see `src/index.ts` for the full surface.

| Export | Purpose |
| --- | --- |
| `addService(opts)` | End-to-end pipeline: login → provision → materialize → persist secrets + MCP entry |
| `readConfig(cwd)` / `writeConfig(cfg, cwd)` | Read/write `.stack.toml` + `.stack.local.toml` |
| `listProviderNames()` / `getProvider(name)` | Introspect the built-in 23-provider registry |
| `scanSource(opts)` | Detect providers from `package.json`, configs, `.env.example` |
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

// Pipeline: provisions a new Supabase project, writes secrets through Phantom,
// merges the MCP entry, and updates .stack.toml + .stack.local.toml.
await addService({ provider: "supabase", cwd: process.cwd() });

const cfg = await readConfig();
console.log(cfg.services.map((s) => s.name));

// Scan an existing checkout for providers already wired up.
const detections = await scanSource({ cwd: process.cwd() });
console.log(listProviderNames().length); // 23
```

## Links

- Full CLI-level docs — [stack.ashlr.ai/docs/cli](https://stack.ashlr.ai/docs/cli)
- Repo — [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack)

## License

MIT. See [LICENSE](./LICENSE).
