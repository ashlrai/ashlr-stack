import { makeApiKeyProvider } from "./_api-key.ts";

/**
 * Render — managed deploys for web services, static sites, private services.
 * v1 accepts a user API key (create at https://dashboard.render.com/u/settings).
 * Verification hits /v1/owners.
 */
export default makeApiKeyProvider({
  name: "render",
  displayName: "Render",
  category: "deploy",
  docs: "https://api-docs.render.com",
  secretName: "RENDER_API_KEY",
  howTo: "Create an API key at https://dashboard.render.com/u/settings",
  dashboard: "https://dashboard.render.com",
  async verify(key) {
    try {
      const res = await fetch("https://api.render.com/v1/owners", {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as Array<{ owner?: { id?: string; name?: string } }>;
      const first = body[0]?.owner;
      if (!first?.id) return undefined;
      return { id: first.id, name: first.name ?? "" };
    } catch {
      return undefined;
    }
  },
});
