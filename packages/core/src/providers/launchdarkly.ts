import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "LAUNCHDARKLY_API_TOKEN";

export default makeApiKeyProvider({
  name: "launchdarkly",
  displayName: "LaunchDarkly",
  category: "featureflags",
  docs: "https://apidocs.launchdarkly.com/",
  secretName: SECRET,
  howTo:
    "Create an API access token at LaunchDarkly → Account settings → Authorization. You will also need your SDK key from LaunchDarkly → Environments.",
  dashboard: "https://app.launchdarkly.com",
  async verify(key) {
    try {
      // GET /api/v2/caller-identity is a lightweight endpoint that returns
      // metadata about the token without requiring any specific permission scope.
      const res = await verifyFetch("https://app.launchdarkly.com/api/v2/caller-identity", {
        headers: {
          Authorization: key,
          Accept: "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { accountId?: string; tokenType?: string };
      return {
        accountId: body.accountId ?? "",
        tokenType: body.tokenType ?? "api",
      };
    } catch {
      return undefined;
    }
  },
  deprovision: {
    description:
      "LaunchDarkly access tokens must be revoked manually at LaunchDarkly → Account settings → Authorization.",
    docsUrl: "https://apidocs.launchdarkly.com/#tag/Access-tokens",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://app.launchdarkly.com/api/v2/caller-identity",
        { headers: { Authorization: key, Accept: "application/json" }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
