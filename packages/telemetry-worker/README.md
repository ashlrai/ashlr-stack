# Ashlr Stack - Telemetry Worker

Cloudflare Worker that accepts opt-in usage events from the Stack CLI
(`POST /v1/events`). See [`docs/PRIVACY.md`](../../docs/PRIVACY.md) for the
full data-handling policy.

## Endpoints

- `POST /v1/events` - accepts a single event. Strict schema validation; extra
  keys are rejected with 400. Returns 202 on success.
- `GET /healthz` - 200 OK.

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

## Part of the Ashlr ecosystem

This worker receives opt-in usage events for Stack, one tool in the [Ashlr ecosystem](https://github.com/ashlrai/ashlr-stack#part-of-the-ashlr-ecosystem). Together these tools aim to be an autonomous, code-first, agent-native software factory, chasing open-source RSI (recursive self-improvement). Agents do the work, and the human acts as a passive board member.

## Contributing

Coding agents maintain this worker through pull requests in [ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack). Humans and agents follow the same [contributor path](https://github.com/ashlrai/ashlr-stack/blob/main/CONTRIBUTING.md#contribute-with-an-agent): fork, install, run the checks, open a PR, and merge through the merge queue once the required CI Gate check passes. Merging does not deploy the worker: no workflow in `.github/workflows/` runs `wrangler deploy`, which needs access to the Cloudflare account. Changes to the event schema also change what [`docs/PRIVACY.md`](../../docs/PRIVACY.md) promises, so update both together.
