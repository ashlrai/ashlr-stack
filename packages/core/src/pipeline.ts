import { resolve } from "node:path";
import { type ServiceEntry, type StackConfig, readConfig, writeConfig } from "./config.ts";
import { StackError } from "./errors.ts";
import { mergeMcpEntry, removeMcpEntry } from "./mcp-writer.ts";
import { assertPhantomInstalled, assertProjectInitialized, removeSecret } from "./phantom.ts";
import type { LogEvent, PromptRequest, ProviderContext } from "./providers/_base.ts";
import {
  beginCredentialStage,
  closeCredentialStage,
  commitOrdinaryCredential,
  commitResourceCredentials,
  credentialPhase,
  ordinaryCredentialPlan,
} from "./providers/_credential-stage.ts";
import { getProvider } from "./providers/index.ts";

export interface AddServiceOpts {
  providerName: string;
  cwd?: string;
  interactive?: boolean;
  existingResourceId?: string;
  hints?: Record<string, unknown>;
  log?: (event: LogEvent) => void;
  /** Host-owned credential prompt. The CLI pauses its spinner around this. */
  prompt?: (req: PromptRequest) => Promise<string>;
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
  // Attachment never grants rollback authority to delete an upstream resource.
  // Capture the request before awaits so a caller cannot change that custody.
  const existingResourceId = opts.existingResourceId;
  const cwd = resolve(opts.cwd ?? process.cwd());
  await assertPhantomInstalled();
  const provider = await getProvider(opts.providerName);
  const config: StackConfig = await readConfig(cwd);

  // Attaching to an existing resource id is always allowed — that's the path
  // `stack doctor --fix` uses to re-run the pipeline for a degraded service.
  if (config.services[provider.name] && !existingResourceId) {
    throw new StackError(
      "SERVICE_ALREADY_ADDED",
      `${provider.displayName} is already in this stack. Pass existingResourceId to re-attach, or remove it first.`,
    );
  }

  // Refuse unreadable/uninitialized project metadata before login, credential
  // verification or provisioning. This observation does not authorize a vault.
  await assertProjectInitialized(cwd);

  const ctx: ProviderContext = {
    cwd,
    interactive: opts.interactive ?? process.stdout.isTTY === true,
    log: opts.log ?? (() => {}),
    prompt: opts.prompt,
  };

  beginCredentialStage(ctx);
  try {
    const auth = await provider.login(ctx).catch((err: unknown) => {
      throw headlessAuthError(err, provider, ctx.interactive);
    });
    credentialPhase(ctx, "provision");
    const resource = await provider.provision(ctx, auth, {
      existingResourceId,
      hints: opts.hints,
    });

    // Provision returned: track local writes for best-effort failure cleanup.
    // Track what has been written so the catch block can undo exactly that.
    const writtenSecrets: string[] = [];
    const criticalSecrets = new Set<string>();
    let writtenMcp: string | undefined;
    let failStep = "resource credential write";

    try {
      credentialPhase(ctx, "critical");
      await commitResourceCredentials(ctx, resource, (key) => {
        writtenSecrets.push(key);
        criticalSecrets.add(key);
      });
      failStep = "materialize";
      credentialPhase(ctx, "materialize");
      const materialized = await provider.materialize(ctx, resource, auth);
      const plan = ordinaryCredentialPlan(ctx, materialized.secrets);
      credentialPhase(ctx, "commit");
      failStep = "secret write";

      for (const [key, value] of plan) {
        await commitOrdinaryCredential(ctx, key, value);
        writtenSecrets.push(key);
      }
      failStep = "MCP write";
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

      failStep = "config write";
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
      // --- Best-effort rollback ---
      // 1. Remove any Phantom secrets already written. Phantom only removes in
      //    an attached terminal, so headless rollback usually keeps them; name
      //    them in the error so the next attempt does not collide unexplained.
      const keptSecrets: string[] = [];
      let keptCriticalCount = 0;
      for (const key of writtenSecrets) {
        let removed = false;
        try {
          removed = await removeSecret(key, cwd);
        } catch {
          /* best-effort */
        }
        if (!removed) {
          if (criticalSecrets.has(key)) keptCriticalCount++;
          else keptSecrets.push(key);
        }
      }
      const keptNote =
        (keptSecrets.length > 0
          ? ` Phantom kept ${keptSecrets.join(", ")}; run \`phantom remove <NAME>\` in a terminal for each before retrying.`
          : "") +
        (keptCriticalCount > 0
          ? ` Phantom kept ${keptCriticalCount} resource credential(s); manual vault reconciliation is required before retrying.`
          : "");
      // 2. Remove the MCP entry if it was written.
      if (writtenMcp) {
        try {
          await removeMcpEntry(writtenMcp, cwd);
        } catch {
          /* best-effort */
        }
      }
      // 3. Tear down the upstream resource (if provider supports it).
      if (existingResourceId) {
        throw new StackError(
          "ADD_SERVICE_PARTIAL_FAILURE",
          `Reattaching ${provider.displayName} failed at step "${failStep}". The requested existing upstream resource was preserved; no automatic upstream teardown was attempted. Original error: ${(err as Error).message}${keptNote}`,
        );
      }
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
        throw new StackError(
          teardownErr ? "ADD_SERVICE_PARTIAL_FAILURE" : "ADD_SERVICE_ROLLED_BACK",
          `${teardownErr ? "Adding" : "Rolled back"} ${provider.displayName} after failure at step "${failStep}". ` +
            `${teardownNote} ` +
            `Original error: ${(err as Error).message}${keptNote}`,
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
          `Clean it up manually on the ${provider.displayName} dashboard, then run \`stack doctor --fix\`.${keptNote}`,
      );
      // .stack.toml is intentionally NOT written — the add was not atomic.
    }
  } finally {
    closeCredentialStage(ctx);
  }
}

/**
 * A provider that needs a pasted key or a browser sign-in cannot get one in
 * a session without a terminal (an agent's MCP call, CI), and Phantom will
 * not hand a stored key back to one either. Say so and name the command a
 * person can run, instead of only "no valid key".
 */
export function headlessAuthError(
  err: unknown,
  provider: { name: string; displayName: string },
  interactive: boolean,
): unknown {
  if (interactive || !(err instanceof StackError) || !err.code.endsWith("_AUTH_REQUIRED")) {
    return err;
  }
  return new StackError(
    err.code,
    `${err.message} ${provider.displayName} needs a credential entered in an interactive terminal, and this session has none (agent or CI). Ask the user to run \`stack add ${provider.name}\` in their own terminal, then retry; nothing was added.`,
    { cause: err },
  );
}
