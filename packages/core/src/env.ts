/**
 * OAuth client IDs for the Ashlr-owned apps registered at each provider.
 *
 * These are PUBLIC values — the client secret stays server-side (at the
 * provider, or in Phantom Cloud for confidential flows). The client ID
 * alone is not sensitive; it's sent as a URL query parameter in the
 * browser redirect.
 *
 * Values are baked into the published tarball by
 * `scripts/inject-client-ids.mjs`, which reads the
 * `OAUTH_*_CLIENT_ID` env vars (provided by GitHub Actions secrets at
 * release time) and rewrites this file in-place before `npm publish`.
 * The release workflow restores the file from git after publish, so
 * these defaults stay empty strings in the repo.
 *
 * Provider code resolves the effective client ID with this precedence:
 *   1. `process.env.<PROVIDER>_STACK_CLIENT_ID`  — runtime override
 *   2. `OAUTH_DEFAULTS.<provider>`               — shipped default
 *   3. (none)                                    — fall back to PAT paste
 */

export const OAUTH_DEFAULTS = {
  supabase: "",
  github: "",
} as const;

export type OAuthProviderName = keyof typeof OAUTH_DEFAULTS;

export function resolveOAuthClientId(
  provider: OAuthProviderName,
  envOverride?: string,
): string | undefined {
  const value = envOverride ?? OAUTH_DEFAULTS[provider];
  return value.length > 0 ? value : undefined;
}
