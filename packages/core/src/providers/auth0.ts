import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "AUTH0_DOMAIN";

const _base = makeApiKeyProvider({
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

/**
 * Auth0 deprovision — the v1 provision only stores the tenant domain (no Auth0
 * application is auto-created by Stack). Deprovision validates the tenant is
 * still reachable via OIDC discovery, then is a no-op. Actual tenant/application
 * deletion must be done via the Auth0 dashboard.
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new StackError("AUTH0_DEPROVISION_ABORTED", "Auth0 deprovision cancelled.");
  }
  // auth.token is the domain (e.g. "myapp.us.auth0.com")
  const domain = auth.token;
  try {
    const res = await verifyFetch(`https://${domain}/.well-known/openid-configuration`, {
      signal: ctx.signal,
    });
    if (!res.ok) {
      ctx.log({
        level: "warn",
        msg: `Auth0 deprovision: tenant ${domain} (resource ${resourceId}) returned ${res.status}; it may already be deleted or unreachable. Delete manually at https://manage.auth0.com.`,
      });
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new StackError("AUTH0_DEPROVISION_ABORTED", "Auth0 deprovision cancelled.");
    }
    ctx.log({
      level: "warn",
      msg: `Auth0 deprovision could not reach tenant ${domain} for resource ${resourceId}: ${(err as Error).message}. Delete manually at https://manage.auth0.com.`,
    });
  }
  // Domain attachment only — no upstream resource created by Stack.
}

export default { ..._base, deprovision };
