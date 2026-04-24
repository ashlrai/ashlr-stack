/**
 * Ashlr Stack telemetry endpoint.
 *
 * Accepts POST /v1/events from the Stack CLI when a user has explicitly
 * opted in (see docs/PRIVACY.md). Expected payload shape mirrors
 * TelemetryEvent in packages/core/src/telemetry.ts exactly:
 *
 *   {
 *     type: "command" | "error",
 *     command: string,
 *     exitCode: number,
 *     durationMs: number,
 *     runId: string,       // per-process uuid
 *     installId: string,   // per-machine uuid
 *     stackVersion: string,
 *     platform: string
 *   }
 *
 * v0.1 behaviour:
 * - Validate shape, reject anything else with 400 (no payload echoed back).
 * - Log the accepted event to Workers Logs. No persistent storage.
 * - No client IP stored. Cloudflare's edge sees it; we don't forward it.
 * - Return 202 with empty body.
 *
 * Everything is fire-and-forget from the CLI side, so we never block long.
 */

type Env = Record<string, never>;

const ALLOWED_TYPES = new Set(["command", "error"]);
// Top-level keys we accept. Anything extra on the payload is rejected to
// avoid silently accepting PII the client shouldn't be sending.
const REQUIRED_KEYS = [
  "type",
  "command",
  "exitCode",
  "durationMs",
  "runId",
  "installId",
  "stackVersion",
  "platform",
] as const;

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function validateEvent(body: unknown): string | null {
  if (!body || typeof body !== "object") return "body must be an object";
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== REQUIRED_KEYS.length) return "unexpected key count";
  for (const key of REQUIRED_KEYS) {
    if (!(key in obj)) return `missing key: ${key}`;
  }
  if (typeof obj.type !== "string" || !ALLOWED_TYPES.has(obj.type)) return "bad type";
  if (typeof obj.command !== "string" || obj.command.length > 64) return "bad command";
  if (typeof obj.exitCode !== "number" || !Number.isInteger(obj.exitCode)) return "bad exitCode";
  if (typeof obj.durationMs !== "number" || obj.durationMs < 0 || obj.durationMs > 3_600_000) {
    return "bad durationMs";
  }
  if (!isUuid(obj.runId)) return "bad runId";
  if (!isUuid(obj.installId)) return "bad installId";
  if (typeof obj.stackVersion !== "string" || obj.stackVersion.length > 32) {
    return "bad stackVersion";
  }
  if (typeof obj.platform !== "string" || obj.platform.length > 16) return "bad platform";
  return null;
}

const CORS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(req: Request, _env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }

    if (url.pathname !== "/v1/events" || req.method !== "POST") {
      return new Response("not found", { status: 404, headers: CORS });
    }

    // Cap body size to avoid accidental upload of large diffs / logs.
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > 2048) {
      return new Response("payload too large", { status: 413, headers: CORS });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("bad json", { status: 400, headers: CORS });
    }

    const err = validateEvent(body);
    if (err) {
      return new Response(`invalid event: ${err}`, { status: 400, headers: CORS });
    }

    // Logging only — no persistent storage in v0.1. Cloudflare Workers Logs
    // retains for 3 days on free tier, which is aligned with docs/PRIVACY.md.
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        ...(body as Record<string, unknown>),
      }),
    );

    return new Response(null, { status: 202, headers: CORS });
  },
};
