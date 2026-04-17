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
}
