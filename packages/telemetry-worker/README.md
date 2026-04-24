# Ashlr Stack — Telemetry Worker

Cloudflare Worker that accepts opt-in usage events from the Stack CLI
(`POST /v1/events`). See [`docs/PRIVACY.md`](../../docs/PRIVACY.md) for the
full data-handling policy.

## Endpoints

- `POST /v1/events` — accepts a single event. Strict schema validation; extra
  keys are rejected with 400. Returns 202 on success.
- `GET /healthz` — 200 OK.

## Deploy

```bash
cd packages/telemetry-worker
wrangler deploy
```

First deploy goes to `ashlr-stack-telemetry.<subdomain>.workers.dev`. To bind
the production domain, uncomment the `[[routes]]` block in `wrangler.toml`
and ensure the `ashlr.ai` zone is active on the Cloudflare account.

The CLI reads `STACK_TELEMETRY_ENDPOINT` (or a persisted `config.endpoint`)
before posting. Until you set one, `emit` is a no-op.

## What this stores

Nothing on disk. Events are written to Cloudflare Workers Logs (3-day
retention on the free tier). No IP, cookies, or headers beyond the request
itself are retained.
