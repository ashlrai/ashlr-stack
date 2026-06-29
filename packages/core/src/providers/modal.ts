import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret } from "./_helpers.ts";

const SECRET = "MODAL_TOKEN";

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
  secretName: SECRET,
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
  deprovision: {
    description:
      "Modal tokens must be revoked manually at https://modal.com/settings/tokens or via `modal token revoke`.",
    docsUrl: "https://modal.com/docs/reference/modal.token",
  },
  async healthcheck(_ctx) {
    // Modal has no public unauthenticated verify endpoint; structural shape
    // check is the best we can do without incurring a full CLI round-trip.
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    const isValid =
      key.includes(":") &&
      (() => {
        const [id, secret] = key.split(":");
        return Boolean(id && secret && (id.startsWith("ak-") || id.startsWith("as-")));
      })();
    const latencyMs = Date.now() - start;
    return isValid
      ? { kind: "ok", latencyMs, detail: "structural check only — full validation occurs on first deploy" }
      : { kind: "error", detail: "token shape invalid; expected ak-<id>:<secret> or as-<id>:<secret>" };
  },
});
