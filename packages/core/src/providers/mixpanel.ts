import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "mixpanel",
  displayName: "Mixpanel",
  category: "analytics",
  docs: "https://developer.mixpanel.com/reference/overview",
  secretName: "MIXPANEL_PROJECT_TOKEN",
  howTo:
    "Find your project token in Mixpanel → Settings → Project Settings. The API secret is on the same page.",
  dashboard: "https://mixpanel.com",
  async verify(key) {
    // Mixpanel's Ingestion API accepts the project token directly. We send a
    // no-op import request to confirm the token is valid without writing data.
    // POST /import with an empty events array returns 200 on a valid token.
    try {
      const res = await verifyFetch("https://api.mixpanel.com/import?strict=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        },
        body: JSON.stringify([]),
      });
      // 200 = valid token (empty import is fine), 401/403 = invalid
      if (res.status === 200 || res.status === 400) {
        // 400 means "no events" which still confirms the token is valid
        return { project_token: `${key.slice(0, 6)}…` };
      }
      return undefined;
    } catch {
      return undefined;
    }
  },
});
