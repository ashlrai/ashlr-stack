import { makeApiKeyProvider } from "./_api-key.ts";

/**
 * Modal — serverless GPU / sandbox platform for AI workloads. v1 accepts the
 * token + token-secret pair (Modal uses two credentials: a token ID and a
 * token secret, generated via `modal token new`). Users paste them separated
 * by a colon: `<token-id>:<token-secret>`.
 */
export default makeApiKeyProvider({
  name: "modal",
  displayName: "Modal",
  category: "deploy",
  docs: "https://modal.com/docs",
  secretName: "MODAL_TOKEN",
  howTo:
    "Run `modal token new` locally, then paste as `<token-id>:<token-secret>` (or create at https://modal.com/settings/tokens)",
  dashboard: "https://modal.com",
  async verify(key) {
    if (!key.includes(":")) return undefined;
    const [id, secret] = key.split(":");
    if (!id || !secret) return undefined;
    // Modal doesn't expose a public lightweight verify endpoint; we shape-check
    // the token. First real API call (modal deploy) will surface any issue.
    if (!id.startsWith("ak-") && !id.startsWith("as-")) return undefined;
    return { token_id: id };
  },
});
