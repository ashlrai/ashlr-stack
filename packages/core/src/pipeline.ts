import { type ServiceEntry, type StackConfig, readConfig, writeConfig } from "./config.ts";
import { type DryRunAddServiceOpts, dryRunAddService } from "./dry-run.ts";
import { StackError } from "./errors.ts";
import { mergeMcpEntry, removeMcpEntry } from "./mcp-writer.ts";
import { addSecret, assertPhantomInstalled, removeSecret } from "./phantom.ts";
import type { AuthHandle, LogEvent, ProviderContext, Resource } from "./providers/_base.ts";
import { getProvider } from "./providers/index.ts";
import {
  ProvisionSchemaValidationError,
  validateProvisionResponse,
} from "./provision-schema.ts";

/** Default wall-clock timeout for each provider step (login / provision / materialize). */
const DEFAULT_STEP_TIMEOUT_MS = 30_000;

/**
 * Race a promise against a wall-clock timeout driven by an AbortController.
 * If the timeout fires first, the controller is aborted (so providers that
 * accept a signal can observe it) and a StackError with code PROVISION_TIMEOUT
 * is thrown. The promise itself is NOT cancelled — JS has no cooperative
 * cancellation — but the pipeline stops waiting for it.
 */
async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  controller: AbortController,
  fn: () => Promise<T>,
): Promise<T> {
  // Infinity means disabled — run the fn directly with no race.
  if (!isFinite(timeoutMs)) {
    return fn();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new StackError(
          "PROVISION_TIMEOUT",
          `Provider step "${label}" did not complete within ${timeoutMs / 1000}s. ` +
            `The pipeline has been aborted. Check your network / API status and retry.`,
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AddServiceOpts {
  providerName: string;
  cwd?: string;
  interactive?: boolean;
  existingResourceId?: string;
  hints?: Record<string, unknown>;
  log?: (event: LogEvent) => void;
  /** If false, skip persisting to .stack.toml (used by dry-run / preview). */
  persist?: boolean;
  /**
   * Wall-clock timeout in milliseconds applied to each provider step
   * (login, provision, materialize) independently. Defaults to 30 000 ms.
   * Set to 0 to disable (not recommended in production).
   */
  timeoutMs?: number;
  /**
   * When true, skip all upstream API calls, secret writes, MCP edits, and
   * config writes. Returns a synthetic but realistic result from the dry-run
   * engine instead. No Phantom installation required.
   */
  dryRun?: boolean;
  /**
   * When true (and dryRun is also true), attach a cost estimate to the result
   * from the static cost registry (Moat 2 groundwork — will be replaced by
   * live provider MCP calls in a future release).
   */
  costEstimate?: boolean;
}

export interface AddServiceResult {
  providerName: string;
  resourceId: string;
  displayName: string;
  secretCount: number;
  mcpWired: boolean;
  entry: ServiceEntry;
  /** Present only when the call was made with dryRun: true */
  dryRun?: true;
}

/**
 * Full add-service pipeline: login → provision → materialize → write secrets
 * → merge .mcp.json → update .stack.toml. Used by both `stack add` and
 * `stack templates apply` so behaviour stays in lockstep.
 *
 * When `opts.dryRun` is true the function short-circuits into the dry-run
 * engine: no upstream API calls, no Phantom writes, no MCP or config changes.
 * Returns a result whose shape is compatible with the real path so callers
 * can render it uniformly.
 */
export async function addService(opts: AddServiceOpts): Promise<AddServiceResult> {
  // --- Dry-run short-circuit ---
  if (opts.dryRun) {
    const dryOpts: DryRunAddServiceOpts = {
      providerName: opts.providerName,
      existingResourceId: opts.existingResourceId,
      hints: opts.hints,
      costEstimate: opts.costEstimate,
    };
    const dryResult = await dryRunAddService(dryOpts);
    // Return a shape that satisfies AddServiceResult — entry is synthesised so
    // callers that only inspect providerName/resourceId/displayName/counts work.
    return {
      providerName: dryResult.providerName,
      resourceId: dryResult.resourceId,
      displayName: dryResult.displayName,
      secretCount: dryResult.secretCount,
      mcpWired: dryResult.mcpWired,
      dryRun: true,
      entry: {
        provider: dryResult.providerName,
        resource_id: dryResult.resourceId,
        secrets: Object.keys(dryResult.report.secrets),
        mcp: dryResult.report.mcpEntry?.name,
        meta: dryResult.report.resource.meta,
        created_at: new Date().toISOString(),
        created_by: "stack add --dry-run",
      },
    };
  }

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

  const timeoutMs =
    opts.timeoutMs === 0 ? Number.POSITIVE_INFINITY : (opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);

  // One AbortController per pipeline run — aborted on any step timeout so that
  // providers accepting a signal (future-proof) can self-cancel.
  const controller = new AbortController();

  const ctx: ProviderContext = {
    cwd,
    interactive: opts.interactive ?? process.stdout.isTTY === true,
    log: opts.log ?? (() => {}),
    hints: opts.hints,
    signal: controller.signal,
  };

  // --- login ---
  let auth: AuthHandle;
  try {
    auth = await withTimeout("login", timeoutMs, controller, () => provider.login(ctx));
  } catch (err) {
    // login timed out or failed — no upstream resource was created, nothing to roll back.
    throw err;
  }

  // --- provision ---
  let resource: Resource;
  try {
    resource = await withTimeout("provision", timeoutMs, controller, () =>
      provider.provision(ctx, auth, {
        existingResourceId: opts.existingResourceId,
        hints: opts.hints,
      }),
    );
  } catch (err) {
    // provision timed out or failed before an upstream resource was confirmed —
    // if it's a timeout and the provider has deprovision, attempt best-effort rollback.
    if (
      err instanceof StackError &&
      err.code === "PROVISION_TIMEOUT" &&
      provider.deprovision &&
      opts.existingResourceId
    ) {
      try {
        await provider.deprovision(ctx, auth, opts.existingResourceId);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }

  // --- Schema validation (M: Provision Response Schema Validation Enforcement) ---
  // Validate the raw resource returned by provider.provision() against the
  // registered JSON Schema for this provider. Catches malformed API responses
  // before they propagate into materialize() or .stack.toml.
  try {
    const validated = validateProvisionResponse(provider.name, resource);
    // Merge validated fields back into resource (coerced id/displayName/region/meta)
    resource = validated;
  } catch (err) {
    if (err instanceof ProvisionSchemaValidationError) {
      // Attempt best-effort deprovision since the resource was already created
      if (provider.deprovision) {
        try {
          await provider.deprovision(ctx, auth, resource.id);
        } catch {
          /* best-effort */
        }
      }
      throw new StackError(
        "PROVISION_SCHEMA_MISMATCH",
        `Provider "${provider.name}" returned a malformed provision response: ${err.message}`,
        { cause: err },
      );
    }
    throw err;
  }

  // Provision succeeded: from here on, any failure must roll back atomically.
  // Track what has been written so the catch block can undo exactly that.
  const writtenSecrets: string[] = [];
  let writtenMcp: string | undefined;

  try {
    const materialized = await withTimeout("materialize", timeoutMs, controller, () =>
      provider.materialize(ctx, resource, auth),
    );

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

    // Timeout errors: rollback (secrets/MCP) already done above — re-throw
    // the original PROVISION_TIMEOUT so the caller sees the real error code.
    // Deprovision is still attempted below before we re-throw.
    const isTimeout =
      err instanceof StackError && err.code === "PROVISION_TIMEOUT";

    if (provider.deprovision) {
      // If deprovision itself throws, we still want to surface the original
      // failure AND note that teardown was incomplete — otherwise the caller
      // has no idea whether the upstream resource is still live.
      let teardownErr: Error | undefined;
      try {
        await provider.deprovision(ctx, auth, resource.id);
      } catch (derr) {
        teardownErr = derr as Error;
      }
      const teardownNote = teardownErr
        ? `Attempted automatic teardown but it FAILED (${teardownErr.message}) — resource ${resource.id} may still exist. Clean it up manually on the ${provider.displayName} dashboard.`
        : `Upstream resource ${resource.id} has been torn down.`;
      // For timeout errors, re-throw the original so callers see PROVISION_TIMEOUT.
      if (isTimeout) throw err;
      throw new StackError(
        "ADD_SERVICE_ROLLED_BACK",
        `Rolled back ${provider.displayName} after failure at step "${failStep}". ` +
          `${teardownNote} ` +
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
