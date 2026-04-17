import { makeApiKeyProvider } from "./_api-key.ts";

/**
 * Upstash uses HTTP Basic auth with email + Management API key. For v1 we
 * accept a single pasted string in the form "email:token" which becomes the
 * base64 Authorization header. Thicker provisioning (create Redis / Kafka /
 * QStash) lands in a future wave.
 */
export default makeApiKeyProvider({
  name: "upstash",
  displayName: "Upstash",
  category: "database",
  docs: "https://upstash.com/docs/devops/developer-api",
  secretName: "UPSTASH_MANAGEMENT_TOKEN",
  howTo:
    "Grab a Management API key at https://console.upstash.com/account/api; paste as email:token",
  dashboard: "https://console.upstash.com",
  async verify(key) {
    try {
      const basic = Buffer.from(key).toString("base64");
      const res = await fetch("https://api.upstash.com/v2/redis/databases", {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as unknown[];
      return { databases: String(Array.isArray(body) ? body.length : 0) };
    } catch {
      return undefined;
    }
  },
});
