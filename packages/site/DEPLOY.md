# Deploying stack.ashlr.ai

The site is a static Astro build — any edge CDN can host it. Two paths shipped:

- **Vercel** (recommended) — zero-config Astro support, best-in-class perf, GitHub-push-to-deploy, custom domain in one click.
- **Cloudflare Pages** (alternative) — free custom domain, same edge story, matches the "infra-first" vibe of the rest of the Ashlr stack.

Pick one. The `.github/workflows/deploy-site.yml` workflow runs Vercel by default; flip the `USE_VERCEL` repo variable to `false` to switch.

---

## Path A — Vercel (fastest)

### One-time setup

1. **Push the monorepo to GitHub** (if you haven't):
   ```bash
   gh repo create ashlrai/ashlr-stack --public --source=. --push
   ```

2. **Create a Vercel project**:
   - Go to [vercel.com/new](https://vercel.com/new) → Import the `ashlrai/ashlr-stack` repo.
   - Set **Root Directory** to `packages/site`.
   - Framework preset: **Astro** (Vercel auto-detects).
   - Build command: `bun run build` (from `vercel.json`).
   - Output: `dist` (from `vercel.json`).
   - Click **Deploy**.

3. **Add the custom domain**:
   - Project → Settings → Domains → Add `stack.ashlr.ai`.
   - Vercel shows you a CNAME target (e.g., `cname.vercel-dns.com`).
   - In your DNS provider for `ashlr.ai`, add:
     ```
     stack   CNAME   cname.vercel-dns.com.
     ```
   - Vercel issues the TLS cert automatically via Let's Encrypt within a few minutes.

4. **Wire up CI** (optional but recommended):
   - Vercel auto-deploys on every push to `main` by default — nothing else needed.
   - If you want the GitHub Action in this repo (`.github/workflows/deploy-site.yml`) to be authoritative instead, add these repo secrets:
     - `VERCEL_TOKEN` (create at [vercel.com/account/tokens](https://vercel.com/account/tokens))
     - `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (from `.vercel/project.json` after running `vercel link` locally).

### Deploy manually

```bash
cd packages/site
npx vercel --prod
```

---

## Path B — Cloudflare Pages

### One-time setup

1. **Push to GitHub** (same as above).

2. **Create a Cloudflare Pages project**:
   - Cloudflare dashboard → Pages → **Create a project** → **Connect to Git** → pick `ashlrai/ashlr-stack`.
   - Build settings:
     - **Framework preset**: Astro
     - **Build command**: `cd packages/site && bun install && bun run build`
     - **Build output directory**: `packages/site/dist`
     - **Root directory**: leave as `/`
     - **Node version / env vars**: none required.

3. **Add the custom domain**:
   - Project → Custom domains → **Set up a custom domain** → enter `stack.ashlr.ai`.
   - Cloudflare configures the CNAME for you if `ashlr.ai` is on Cloudflare DNS. Otherwise, add:
     ```
     stack   CNAME   ashlr-stack.pages.dev.
     ```
   - TLS auto-issues.

4. **Flip the GitHub Action**:
   - In your repo, set variable `USE_VERCEL` to `false` (Settings → Secrets and variables → Actions → Variables).
   - Uncomment the `deploy-cloudflare` job in `.github/workflows/deploy-site.yml` and delete the Vercel job.
   - Add secrets: `CLOUDFLARE_API_TOKEN` (scope: Pages:Edit) and `CLOUDFLARE_ACCOUNT_ID`.

### Deploy manually

```bash
cd packages/site
bun run build
bunx wrangler pages deploy dist --project-name=ashlr-stack
```

---

## DNS quick-reference

Whichever host you pick, the record at `ashlr.ai` is a single CNAME:

| Record type | Name    | Value                              | Notes                          |
|-------------|---------|------------------------------------|--------------------------------|
| CNAME       | `stack` | `cname.vercel-dns.com.`            | Vercel                         |
| CNAME       | `stack` | `<project>.pages.dev.`             | Cloudflare Pages               |

TTL: 300–3600 seconds is fine. TLS is handled by the host — don't put a proxy in front unless you know what you're doing.

---

## Post-deploy checklist

Hit these URLs once `stack.ashlr.ai` resolves:

- [ ] `https://stack.ashlr.ai/` — homepage renders, hero terminal animates
- [ ] `https://stack.ashlr.ai/docs` — docs index loads, sidebar present
- [ ] `https://stack.ashlr.ai/sitemap-index.xml` — returns XML
- [ ] `https://stack.ashlr.ai/robots.txt` — returns plain text with `Sitemap:` line
- [ ] `https://stack.ashlr.ai/llms.txt` — returns the LLM-discoverability summary
- [ ] `https://stack.ashlr.ai/manifest.webmanifest` — returns valid JSON
- [ ] OG preview at [opengraph.xyz/url/https%3A%2F%2Fstack.ashlr.ai](https://www.opengraph.xyz/url/https%3A%2F%2Fstack.ashlr.ai) — shows ▲ stack card
- [ ] [search.google.com/test/rich-results](https://search.google.com/test/rich-results) — validates the three JSON-LD schemas
- [ ] Submit sitemap at [search.google.com/search-console](https://search.google.com/search-console) once the domain is verified

---

## What Stack will one day do for itself

Ironic note for the changelog: the product being documented on this site *is* the tool that wires up this kind of deploy. Once `stack add vercel` + `stack add cloudflare` are battle-tested, this very site's deploy becomes:

```bash
stack init --template ashlr-stack-site
stack add vercel             # OAuth → create project → link stack.ashlr.ai
stack sync --platform vercel # push any env Phantom holds
git push                     # Vercel auto-deploys
```

Dogfood ships in v0.2.
