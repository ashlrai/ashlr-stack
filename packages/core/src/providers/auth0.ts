import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "AUTH0_DOMAIN";

export default makeApiKeyProvider({
  name: "auth0",
  displayName: "Auth0",
  category: "auth",
  docs: "https://auth0.com/docs/api/management/v2",
  secretName: SECRET,
  howTo:
    "Create a Machine-to-Machine app in Auth0 → Applications. You will be prompted for domain, client ID, and client secret.",
  dashboard: "https://manage.auth0.com",
  async verify(key) {
    // `key` here is the domain (e.g. "myapp.us.auth0.com").
    // We hit the OIDC discovery endpoint — no credentials required — to confirm
    // the tenant is reachable. Full M2M credential verification requires an
    // access-token exchange which is deferred to the multi-secret login path.
    try {
      const res = await verifyFetch(`https://${key}/.well-known/openid-configuration`);
      if (!res.ok) return undefined;
      const body = (await res.json()) as { issuer?: string };
      return body.issuer ? { issuer: body.issuer } : undefined;
    } catch {
      return undefined;
    }
  },
  async healthcheck(ctx) {
    const domain = await tryRevealSecret(SECRET);
    if (!domain) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        `https://${domain}/.well-known/openid-configuration`,
        { signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
