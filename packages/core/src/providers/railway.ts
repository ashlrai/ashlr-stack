import { makeApiKeyProvider } from "./_api-key.ts";

export default makeApiKeyProvider({
  name: "railway",
  displayName: "Railway",
  category: "deploy",
  docs: "https://docs.railway.app/reference/public-api",
  secretName: "RAILWAY_TOKEN",
  howTo: "Create a team or personal token at https://railway.app/account/tokens",
  dashboard: "https://railway.app/dashboard",
  async verify(key) {
    try {
      const res = await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: "{ me { id email } }" }),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: { me?: { id?: string; email?: string } } };
      if (!body.data?.me?.id) return undefined;
      return {
        id: body.data.me.id,
        ...(body.data.me.email ? { email: body.data.me.email } : {}),
      };
    } catch {
      return undefined;
    }
  },
});
