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

For each provider requiring an OAuth app, Ashlr needs to register a single "Ashlr Stack" application at `https://stack.ashlr.ai`:

1. Redirect URL: `http://127.0.0.1:PORT/callback` (PKCE loopback, dynamic port)
2. Privacy policy URL: `https://ashlr.ai/privacy`
3. Terms of service URL: `https://ashlr.ai/terms`
4. Logo: Ashlr Stack mark (see `packages/plugin/assets/`)
5. Scopes: minimum required for provision + materialize + healthcheck (never more)

Client IDs/secrets live in a dedicated `.ashlr-stack-oauth` vault in Phantom Cloud, pulled at build time by the CLI. Per-user installs use the embedded public client id only; secrets never ship to users' machines (PKCE flow, no client secret needed for public clients).
