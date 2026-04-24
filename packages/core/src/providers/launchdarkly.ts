import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "launchdarkly",
  displayName: "LaunchDarkly",
  category: "featureflags",
  docs: "https://apidocs.launchdarkly.com/",
  secretName: "LAUNCHDARKLY_API_TOKEN",
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
});
