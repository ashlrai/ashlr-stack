# Provider Auth Matrix

Living reference for every curated provider. Update as each provider lands. Ops work (registering OAuth apps, privacy-policy URLs, scopes) lives here so it doesn't get lost in code comments.

| Provider | Auth kind | OAuth app needed? | Scopes | Rate limit | Dashboard |
|----------|-----------|-------------------|--------|-----------|-----------|
| supabase | oauth_pkce | Yes — "Ashlr Stack" | `projects:write`, `organizations:read` | 60/min | https://supabase.com/dashboard |
| neon | oauth | Yes | `project:create`, `database:write` | 100/min | https://console.neon.tech |
| vercel | oauth | Yes — or user PAT | `user`, `projects`, `deployments` | 100/min | https://vercel.com/dashboard |
| sentry | oauth | Yes | `project:write`, `org:read` | 40/s | https://sentry.io |
| posthog | pat | No — user pastes PAT | n/a | 240/min | https://app.posthog.com |
| railway | pat | No | n/a | 100/min | https://railway.app |
| fly | pat | No | n/a | 60/min | https://fly.io/dashboard |
| upstash | pat | No | n/a | 100/min | https://console.upstash.com |
| aws | api_key | No — access key pair | IAM policy advised | n/a | https://console.aws.amazon.com |
| gcp | cli_shell | No — `gcloud auth` | n/a | n/a | https://console.cloud.google.com |
| google_analytics | oauth | Yes | `analytics.edit` | 50k/day | https://analytics.google.com |
| openai | api_key | No | n/a | tier-based | https://platform.openai.com |
| anthropic | api_key | No | n/a | tier-based | https://console.anthropic.com |
| xai | api_key | No | n/a | tier-based | https://console.x.ai |
| deepseek | api_key | No | n/a | tier-based | https://platform.deepseek.com |
| stripe | oauth | Yes — Stripe Connect | `read_write` | 100/s | https://dashboard.stripe.com |
| github | oauth_device | Yes | `repo`, `read:org` | 5000/h | https://github.com |
| linear | oauth | Yes | `read`, `write` | 1500/h | https://linear.app |
| resend | pat | No | n/a | 10/s | https://resend.com |
| clerk | pat | No | n/a | n/a | https://dashboard.clerk.com |

## OAuth app registration checklist

For each provider requiring an OAuth app, Ashlr registers a single "Ashlr Stack" application at `https://stack.ashlr.ai`:

1. **Homepage**: `https://stack.ashlr.ai`
2. **Redirect URL**: `http://127.0.0.1:*/callback` (PKCE loopback, any dynamic port) or `http://localhost:*/callback` where wildcards aren't allowed — in that case, register a broad range like `/callback` on ports 49152–65535
3. **Privacy policy URL**: `https://ashlr.ai/privacy`
4. **Terms of service URL**: `https://ashlr.ai/terms`
5. **Logo**: Ashlr Stack mark (see `packages/plugin/assets/`)
6. **Scopes**: minimum required for provision + materialize + healthcheck (never more)

### v0.1 target providers

| Provider | Registration URL | Client ID goes to |
|----------|-----------------|-------------------|
| Supabase | https://supabase.com/dashboard/org/_/oauth-apps | GH secret `OAUTH_SUPABASE_CLIENT_ID` |
| GitHub | https://github.com/settings/applications/new | GH secret `OAUTH_GITHUB_CLIENT_ID` |

### Where the client IDs live

Client IDs are **public values** (they travel in browser redirect URLs; only the client secret needs protection). Stack bakes them into the published npm tarball at release time via `scripts/inject-client-ids.mjs`, which is triggered by `.github/workflows/release.yml` and reads from the `OAUTH_*_CLIENT_ID` GitHub Actions secrets.

The resolution precedence at runtime (see `packages/core/src/env.ts`):

1. `process.env.<PROVIDER>_STACK_CLIENT_ID` — per-user override (e.g. a fork with its own OAuth app)
2. `OAUTH_DEFAULTS.<provider>` — Ashlr-registered default baked in at publish
3. Neither set — provider falls back to interactive PAT paste

Client secrets stay at the provider (PKCE + device flows don't require a client secret on the user side). If a provider requires a confidential flow later (Stripe Connect), the secret would live in an Ashlr-hosted backend, not on user machines.

### To register a new provider

1. Create an OAuth app at the provider using the settings above.
2. Copy the public client ID.
3. Add it as a GitHub Actions secret: `Settings → Secrets and variables → Actions → New repository secret`, name: `OAUTH_<PROVIDER>_CLIENT_ID`.
4. Add the provider key to `OAUTH_DEFAULTS` in `packages/core/src/env.ts` and to `SOURCES` in `scripts/inject-client-ids.mjs`.
5. Update the relevant `packages/core/src/providers/<name>.ts` to call `resolveOAuthClientId(...)`.
6. Cut the next release tag — the workflow injects the ID automatically.
