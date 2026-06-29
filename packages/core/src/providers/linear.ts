import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "LINEAR_API_KEY";

/**
 * Linear — v1 uses a personal API key (users create one at
 * https://linear.app/settings/api). OAuth is deferred to when we register the
 * Ashlr Stack app with Linear (see provider-auth-matrix.md).
 */
export default makeApiKeyProvider({
  name: "linear",
  displayName: "Linear",
  category: "tickets",
  docs: "https://developers.linear.app/docs",
  secretName: SECRET,
  howTo: "Create a personal API key at https://linear.app/settings/api",
  dashboard: "https://linear.app",
  mcp: {
    name: "linear",
    type: "stdio",
    command: "npx",
    args: ["-y", "mcp-linear"],
    env: { LINEAR_API_KEY: "$(phantom reveal LINEAR_API_KEY)" },
  },
  async verify(key) {
    try {
      // GraphQL POST but a read-only `{ viewer }` query — opt-in idempotent.
      const res = await verifyFetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: key },
        body: JSON.stringify({ query: "{ viewer { id name email } }" }),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as {
        data?: { viewer?: { id: string; name: string; email: string } };
      };
      if (!body.data?.viewer?.id) return undefined;
      return {
        id: body.data.viewer.id,
        name: body.data.viewer.name,
        email: body.data.viewer.email,
      };
    } catch {
      return undefined;
    }
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: key },
        body: JSON.stringify({ query: "{ viewer { id } }" }),
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { kind: "error", detail: `HTTP ${res.status}` };
      const body = (await res.json()) as { data?: { viewer?: { id?: string } } };
      if (!body.data?.viewer?.id) return { kind: "error", detail: "token invalid or no viewer.id" };
      return { kind: "ok", latencyMs };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
