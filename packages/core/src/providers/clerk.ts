import { makeApiKeyProvider } from "./_api-key.ts";

export default makeApiKeyProvider({
  name: "clerk",
  displayName: "Clerk",
  category: "auth",
  docs: "https://clerk.com/docs",
  secretName: "CLERK_SECRET_KEY",
  howTo: "Grab your secret key from https://dashboard.clerk.com → API Keys",
  dashboard: "https://dashboard.clerk.com",
  async verify(key) {
    try {
      const res = await fetch("https://api.clerk.com/v1/jwks", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      return { verified: "true" };
    } catch {
      return undefined;
    }
  },
});
