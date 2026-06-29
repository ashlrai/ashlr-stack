import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "RAILWAY_TOKEN";

export default makeApiKeyProvider({
  name: "railway",
  displayName: "Railway",
  category: "deploy",
  docs: "https://docs.railway.app/reference/public-api",
  secretName: SECRET,
  howTo: "Create a team or personal token at https://railway.app/account/tokens",
  dashboard: "https://railway.app/dashboard",
  async verify(key) {
    try {
      // GraphQL POST, but it's a read-only `{ me }` query — safe to retry,
      // so we explicitly opt the helper into idempotent semantics.
      const res = await verifyFetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: "{ me { id email } }" }),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: { me?: { id?: string; email?: string } } };
      if (!body.data?.me?.id) return undefined;
      return {
        id: body.data.me.id,
        ...(body.data.me.email ? { email: body.data.me.email } : {}),
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
      const res = await verifyFetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: "{ me { id } }" }),
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { kind: "error", detail: `HTTP ${res.status}` };
      const body = (await res.json()) as { data?: { me?: { id?: string } } };
      if (!body.data?.me?.id) return { kind: "error", detail: "token invalid or no me.id" };
      return { kind: "ok", latencyMs };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
