import {
  type ServiceEntry,
  type StackConfig,
  readConfig,
  writeConfig,
} from "./config.ts";
import { StackError } from "./errors.ts";
import { addSecret, assertPhantomInstalled } from "./phantom.ts";
import { mergeMcpEntry } from "./mcp-writer.ts";
import { getProvider } from "./providers/index.ts";
import type { LogEvent, ProviderContext } from "./providers/_base.ts";

export interface AddServiceOpts {
  providerName: string;
  cwd?: string;
  interactive?: boolean;
  existingResourceId?: string;
  hints?: Record<string, unknown>;
  log?: (event: LogEvent) => void;
  /** If false, skip persisting to .stack.toml (used by dry-run / preview). */
  persist?: boolean;
}

export interface AddServiceResult {
  providerName: string;
  resourceId: string;
  displayName: string;
  secretCount: number;
  mcpWired: boolean;
  entry: ServiceEntry;
}

/**
 * Full add-service pipeline: login → provision → materialize → write secrets
 * → merge .mcp.json → update .stack.toml. Used by both `stack add` and
 * `stack templates apply` so behaviour stays in lockstep.
 */
export async function addService(opts: AddServiceOpts): Promise<AddServiceResult> {
  await assertPhantomInstalled();
  const provider = await getProvider(opts.providerName);
  const cwd = opts.cwd ?? process.cwd();
  const config: StackConfig = await readConfig(cwd);

  // Attaching to an existing resource id is always allowed — that's the path
  // `stack doctor --fix` uses to re-run the pipeline for a degraded service.
  if (config.services[provider.name] && !opts.existingResourceId) {
    throw new StackError(
      "SERVICE_ALREADY_ADDED",
      `${provider.displayName} is already in this stack. Pass existingResourceId to re-attach, or remove it first.`,
    );
  }

  const ctx: ProviderContext = {
    cwd,
    interactive: opts.interactive ?? process.stdout.isTTY === true,
    log: opts.log ?? (() => {}),
  };

  const auth = await provider.login(ctx);
  const resource = await provider.provision(ctx, auth, {
    existingResourceId: opts.existingResourceId,
    hints: opts.hints,
  });

  // Provision succeeded: from here on, any failure leaves a dangling upstream
  // resource. Wrap the rest of the pipeline so we can persist a minimal
  // breadcrumb entry to .stack.toml before re-throwing. This is what lets
  // `stack doctor --fix` (or `stack remove`) clean up later — without the
  // breadcrumb, the user has a live resource on the provider side with no
  // local record at all.
  try {
    const materialized = await provider.materialize(ctx, resource, auth);

    for (const [key, value] of Object.entries(materialized.secrets)) {
      await addSecret(key, value, cwd);
    }
    if (materialized.mcp) await mergeMcpEntry(materialized.mcp, cwd);

    const entry: ServiceEntry = {
      provider: provider.name,
      resource_id: resource.id,
      region: resource.region,
      secrets: Object.keys(materialized.secrets),
      mcp: materialized.mcp?.name,
      meta: resource.meta,
      created_at: new Date().toISOString(),
      created_by: "stack add",
    };

    if (opts.persist !== false) {
      config.services[provider.name] = entry;
      await writeConfig(config, cwd);
    }

    return {
      providerName: provider.name,
      resourceId: resource.id,
      displayName: resource.displayName,
      secretCount: Object.keys(materialized.secrets).length,
      mcpWired: Boolean(materialized.mcp),
      entry,
    };
  } catch (err) {
    // Partial-failure breadcrumb: write just enough to .stack.toml that a
    // later `stack doctor --fix` or `stack remove` can find the dangling
    // upstream resource. We intentionally leave `secrets: []` — materialize
    // didn't run to completion, so we don't know which vault keys (if any)
    // were populated. Same goes for `mcp`: we don't know what the MCP entry
    // would have been, so we don't claim to have wired one.
    if (opts.persist !== false) {
      const partial: ServiceEntry = {
        provider: provider.name,
        resource_id: resource.id,
        region: resource.region,
        secrets: [],
        meta: resource.meta,
        created_at: new Date().toISOString(),
        created_by: "stack add (partial)",
      };
      try {
        config.services[provider.name] = partial;
        await writeConfig(config, cwd);
      } catch {
        // If even writing the breadcrumb fails, swallow — the original
        // error below is the user-visible signal; we don't want to mask it
        // with a disk-write failure.
      }
    }
    throw err;
  }
}
