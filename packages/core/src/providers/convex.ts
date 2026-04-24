import { makeApiKeyProvider } from "./_api-key.ts";

/**
 * Convex — reactive backend with subscriptions + scheduled functions. v1 uses
 * a deploy key (users create one at https://dashboard.convex.dev → Project
 * Settings → Deploy Keys). Creating Convex deployments programmatically
 * requires their deploy CLI with a browser flow — out of scope for v1.
 */
export default makeApiKeyProvider({
  name: "convex",
  displayName: "Convex",
  category: "database",
  docs: "https://docs.convex.dev",
  secretName: "CONVEX_DEPLOY_KEY",
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
});
