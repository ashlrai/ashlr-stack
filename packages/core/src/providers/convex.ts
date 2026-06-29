import { StackError } from "../errors.ts";
import type { AuthHandle, ConflictCheckOpts, ProviderContext, ResourceConflictCheckConfig } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret } from "./_helpers.ts";

const SECRET = "CONVEX_DEPLOY_KEY";

/**
 * Convex — reactive backend with subscriptions + scheduled functions. v1 uses
 * a deploy key (users create one at https://dashboard.convex.dev → Project
 * Settings → Deploy Keys). Creating Convex deployments programmatically
 * requires their deploy CLI with a browser flow — out of scope for v1.
 */
const _base = makeApiKeyProvider({
  name: "convex",
  displayName: "Convex",
  category: "database",
  docs: "https://docs.convex.dev",
  secretName: SECRET,
  howTo: "Create a deploy key at https://dashboard.convex.dev (Project → Settings → Deploy Keys).",
  dashboard: "https://dashboard.convex.dev",
  async verify(key) {
    // Convex deploy keys have the shape prod:<team>:<project>|<token>. No
    // public validate-only endpoint, so we do a shape check and defer real
    // validation to first CLI use (convex deploy / npx convex dev).
    if (!key.includes(":") || !key.includes("|")) return undefined;
    const [prefix] = key.split("|");
    const parts = prefix.split(":");
    if (parts.length < 3) return undefined;
    return { environment: parts[0], team: parts[1], project: parts[2] };
  },
  async healthcheck(_ctx) {
    // Convex has no public verify endpoint; shape-check is the best we can do.
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    const isValid = (() => {
      if (!key.includes(":") || !key.includes("|")) return false;
      const [prefix] = key.split("|");
      return prefix.split(":").length >= 3;
    })();
    const latencyMs = Date.now() - start;
    return isValid
      ? { kind: "ok", latencyMs, detail: "structural check only — full validation occurs on first deploy" }
      : { kind: "error", detail: "deploy key shape invalid; expected <env>:<team>:<project>|<token>" };
  },
});

/**
 * Convex deprovision — the v1 provision only stores a deploy key (no Convex
 * deployment is auto-created by Stack). Deprovision validates the stored key
 * is structurally sound, then is a no-op. Actual deployment deletion must be
 * done via the Convex dashboard.
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new StackError("CONVEX_DEPROVISION_ABORTED", "Convex deprovision cancelled.");
  }
  // Validate the stored deploy key is still structurally valid.
  const key = auth.token;
  const isValid = key.includes(":") && key.includes("|") && (() => {
    const [prefix] = key.split("|");
    return prefix.split(":").length >= 3;
  })();
  if (!isValid) {
    throw new StackError(
      "CONVEX_DEPROVISION_FAILED",
      `Convex deploy key for resource ${resourceId} is malformed (expected <env>:<team>:<project>|<token>). ` +
        `Delete manually at https://dashboard.convex.dev.`,
    );
  }
  // Deploy-key attachment only — no upstream resource created by Stack.
}

/**
 * Convex conflict check — the deploy key encodes the project slug as
 * `<env>:<team>:<project>|<token>`. We extract the project name and compare
 * to the desired name. No public list endpoint exists, so this is a local
 * structural check only.
 */
async function checkConflict(
  auth: AuthHandle,
  opts: ConflictCheckOpts,
): Promise<ResourceConflictCheckConfig> {
  const now = new Date().toISOString();
  const desiredName = opts.desiredName;
  try {
    if (!desiredName) {
      return {
        requestedName: "(auto)",
        exists: false,
        action: "ok",
        message: "No desired name specified; auto-naming will avoid conflicts.",
        checkedAt: now,
      };
    }
    // Extract project name from deploy key shape: <env>:<team>:<project>|<token>
    const key = auth.token;
    if (!key.includes(":") || !key.includes("|")) {
      return {
        requestedName: desiredName,
        exists: undefined,
        action: "unreachable",
        message: "Convex deploy key is malformed; skipping conflict check.",
        checkedAt: now,
      };
    }
    const [prefix] = key.split("|");
    const parts = prefix.split(":");
    if (parts.length < 3) {
      return {
        requestedName: desiredName,
        exists: undefined,
        action: "unreachable",
        message: "Convex deploy key missing project component; skipping conflict check.",
        checkedAt: now,
      };
    }
    const projectName = parts[2];
    if (projectName === desiredName) {
      return {
        requestedName: desiredName,
        exists: true,
        existingResourceId: projectName,
        existingDisplayName: projectName,
        suggestedUniqueName: desiredName,
        action: "attach",
        message: `Convex project "${desiredName}" matches the deploy key. Attaching to existing deployment.`,
        checkedAt: now,
      };
    }
    return {
      requestedName: desiredName,
      exists: false,
      action: "ok",
      message: `Convex deploy key project "${projectName}" does not match "${desiredName}"; safe to proceed.`,
      checkedAt: now,
    };
  } catch {
    return {
      requestedName: desiredName ?? "(auto)",
      exists: undefined,
      action: "unreachable",
      message: "Convex conflict check failed; proceeding with provision.",
      checkedAt: now,
    };
  }
}

export default { ..._base, deprovision, checkConflict };
