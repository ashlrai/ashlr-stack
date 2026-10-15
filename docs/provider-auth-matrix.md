# Provider Auth Matrix

Living reference for every curated provider. Update as each provider lands. Ops work (registering OAuth apps, privacy-policy URLs, scopes) lives here so it doesn't get lost in code comments.

The table below mirrors the provider registry in `packages/core/src/providers/`
(39 providers). `Auth kind` is each provider's `authKind`; `Deprovision` says
whether the provider implements `deprovision`, which `stack add` uses to roll
back a resource it created when a later step fails.

Only Supabase (`oauth_pkce`) and GitHub (`oauth_device`) have an OAuth flow,
and both use it only when an OAuth client ID is configured (see below);
otherwise they fall back to a pasted token. GitHub requests the scopes
`repo,read:org,read:user`. Every other provider uses a pasted PAT or API key.

| Provider | Category | Auth kind | Deprovision | API docs |
|----------|----------|-----------|-------------|----------|
| anthropic | ai | api_key | no | https://docs.anthropic.com/en/api |
| auth0 | auth | api_key | no | https://auth0.com/docs/api/management/v2 |
| aws | cloud | api_key | no | https://docs.aws.amazon.com/iam/ |
| braintrust | ai | api_key | no | https://www.braintrust.dev/docs |
| clerk | auth | api_key | no | https://clerk.com/docs |
| cloudflare | deploy | pat | no | https://developers.cloudflare.com/api |
| convex | database | api_key | no | https://docs.convex.dev |
| datadog | observability | api_key | no | https://docs.datadoghq.com/api/latest/ |
| deepseek | ai | api_key | no | https://api-docs.deepseek.com |
| digitalocean | cloud | api_key | no | https://docs.digitalocean.com/reference/api/api-reference/ |
| firebase | database | api_key | no | https://firebase.google.com/docs/admin/setup |
| fly | deploy | api_key | no | https://fly.io/docs/machines/api |
| gcp | cloud | api_key | no | https://cloud.google.com/docs/authentication/getting-started |
| github | code | oauth_device | no | https://docs.github.com/en/rest |
| grafana | observability | api_key | no | https://grafana.com/docs/grafana/latest/developers/http_api/ |
| hetzner | cloud | api_key | no | https://docs.hetzner.cloud/ |
| launchdarkly | featureflags | api_key | no | https://apidocs.launchdarkly.com/ |
| linear | tickets | api_key | no | https://developers.linear.app/docs |
| mailgun | email | api_key | no | https://documentation.mailgun.com/docs/mailgun/api-reference/ |
| mixpanel | analytics | api_key | no | https://developer.mixpanel.com/reference/overview |
| modal | deploy | api_key | no | https://modal.com/docs |
| neon | database | pat | yes | https://neon.tech/docs/reference/api-reference |
| openai | ai | api_key | no | https://platform.openai.com/docs/api-reference |
| plausible | analytics | api_key | no | https://plausible.io/docs/stats-api |
| posthog | analytics | api_key | no | https://posthog.com/docs/api |
| postmark | email | api_key | no | https://postmarkapp.com/developer/api/overview |
| railway | deploy | api_key | no | https://docs.railway.app/reference/public-api |
| render | deploy | api_key | no | https://api-docs.render.com |
| replicate | ai | api_key | no | https://replicate.com/docs/reference/http |
| resend | email | api_key | no | https://resend.com/docs |
| sendgrid | email | api_key | no | https://docs.sendgrid.com/api-reference |
| sentry | errors | pat | no | https://docs.sentry.io/api/ |
| stripe | payments | api_key | no | https://docs.stripe.com/api |
| supabase | database | oauth_pkce | yes | https://supabase.com/docs/reference/api/introduction |
| turso | database | pat | yes | https://docs.turso.tech |
| upstash | database | api_key | no | https://upstash.com/docs/devops/developer-api |
| vercel | deploy | pat | yes | https://vercel.com/docs/rest-api |
| workos | auth | api_key | no | https://workos.com/docs/reference/api |
| xai | ai | api_key | no | https://docs.x.ai/api |

## OAuth app registration checklist

For each provider requiring an OAuth app, Ashlr registers a single "Ashlr Stack" application at `https://stack.ashlr.ai`:

1. **Homepage**: `https://stack.ashlr.ai`
2. **Redirect URL**: `http://127.0.0.1:8787/callback`. The PKCE loopback server (`packages/core/src/oauth.ts`) listens on port 8787 first and falls back to a random OS-assigned port only when 8787 is in use.
3. **Privacy policy URL**: `https://ashlr.ai/privacy`
4. **Terms of service URL**: `https://ashlr.ai/terms`
5. **Logo**: Ashlr Stack mark
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
