import { type ServiceEntry, type StackConfig, readConfig, writeConfig } from "./config.ts";
import { StackError } from "./errors.ts";
import { mergeMcpEntry, removeMcpEntry } from "./mcp-writer.ts";
import { addSecret, assertPhantomInstalled, removeSecret } from "./phantom.ts";
import type { LogEvent, ProviderContext } from "./providers/_base.ts";
import { getProvider } from "./providers/index.ts";

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

  // Provision succeeded: from here on, any failure must roll back atomically.
  // Track what has been written so the catch block can undo exactly that.
  const writtenSecrets: string[] = [];
  let writtenMcp: string | undefined;

  try {
    const materialized = await provider.materialize(ctx, resource, auth);

    for (const [key, value] of Object.entries(materialized.secrets)) {
      await addSecret(key, value, cwd);
      writtenSecrets.push(key);
    }
    if (materialized.mcp) {
      await mergeMcpEntry(materialized.mcp, cwd);
      writtenMcp = materialized.mcp.name;
    }

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
    // --- Atomic rollback ---
    // 1. Remove any Phantom secrets already written.
    for (const key of writtenSecrets) {
      try {
        await removeSecret(key, cwd);
      } catch {
        /* best-effort */
      }
    }
    // 2. Remove the MCP entry if it was written.
    if (writtenMcp) {
      try {
        await removeMcpEntry(writtenMcp, cwd);
      } catch {
        /* best-effort */
      }
    }
    // 3. Tear down the upstream resource (if provider supports it).
    const failStep = writtenSecrets.length > 0 ? "MCP/config write" : "materialize";
    if (provider.deprovision) {
      await provider.deprovision(ctx, auth, resource.id);
      throw new StackError(
        "ADD_SERVICE_ROLLED_BACK",
        `Rolled back ${provider.displayName} after failure at step "${failStep}". ` +
          `Upstream resource ${resource.id} has been torn down. ` +
          `Original error: ${(err as Error).message}`,
      );
    }
    // No deprovision support — warn and direct to manual cleanup.
    ctx.log({
      level: "warn",
      msg: `[stack] Partial failure adding ${provider.displayName}. Upstream resource ID: ${resource.id}. This provider does not support automatic teardown — please delete it manually, then run \`stack doctor --fix\` to resync local state.`,
      data: { provider: provider.name, resourceId: resource.id },
    });
    throw new StackError(
      "ADD_SERVICE_PARTIAL_FAILURE",
      `Adding ${provider.displayName} failed at step "${failStep}" after the upstream resource was created. ` +
        `Resource ID: ${resource.id}. ` +
        `Clean it up manually on the ${provider.displayName} dashboard, then run \`stack doctor --fix\`.`,
    );
    // .stack.toml is intentionally NOT written — the add was not atomic.
  }
}
