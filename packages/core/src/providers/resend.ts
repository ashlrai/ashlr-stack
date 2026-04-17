import { makeApiKeyProvider } from "./_api-key.ts";

export default makeApiKeyProvider({
  name: "resend",
  displayName: "Resend",
  category: "email",
  docs: "https://resend.com/docs",
  secretName: "RESEND_API_KEY",
  howTo: "Create a key at https://resend.com/api-keys",
  dashboard: "https://resend.com",
  async verify(key) {
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return { domains: String(body.data?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
});
