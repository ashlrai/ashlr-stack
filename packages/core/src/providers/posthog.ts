import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "POSTHOG_PERSONAL_API_KEY";

const _base = makeApiKeyProvider({
  name: "posthog",
  displayName: "PostHog",
  category: "analytics",
  docs: "https://posthog.com/docs/api",
  secretName: SECRET,
  howTo: "Create a personal API key at https://app.posthog.com/me/settings (scope: all)",
  dashboard: "https://app.posthog.com",
  mcp: {
    name: "posthog",
    type: "sse",
    url: "https://mcp.posthog.com/sse",
    headers: { Authorization: "Bearer $(phantom reveal POSTHOG_PERSONAL_API_KEY)" },
  },
  async verify(key) {
    try {
      const res = await verifyFetch("https://app.posthog.com/api/projects", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { results?: Array<{ id: number; name: string }> };
      return { projects: String(body.results?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://app.posthog.com/api/projects",
        { headers: { Authorization: `Bearer ${key}` }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});

/**
 * PostHog deprovision — deletes a project by numeric id.
 * resourceId is the PostHog project id (numeric string, e.g. "12345").
 * Idempotent: 404 is treated as success (already deleted).
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  try {
    const res = await fetch(`https://app.posthog.com/api/projects/${resourceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: ctx.signal,
    });
    if (res.status === 404) return; // already gone — idempotent
    if (!res.ok) {
      ctx.log({
        level: "warn",
        msg: `PostHog deprovision returned ${res.status} for project ${resourceId}; resource may need manual cleanup at https://app.posthog.com.`,
      });
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new StackError("POSTHOG_DEPROVISION_ABORTED", "PostHog deprovision cancelled.");
    }
    ctx.log({
      level: "warn",
      msg: `PostHog deprovision failed for ${resourceId}: ${(err as Error).message}. Resource may need manual cleanup at https://app.posthog.com.`,
    });
  }
}

export default { ..._base, deprovision };
