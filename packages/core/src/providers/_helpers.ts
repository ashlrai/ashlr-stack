import { type RetryOptions, fetchWithRetry } from "../http.ts";
import { revealSecret } from "../phantom.ts";

/**
 * Shared helpers for every hand-written provider. Before this existed, each
 * provider shipped a byte-for-byte copy of `readLine` and `tryRevealSecret` —
 * one source of truth keeps behaviour consistent.
 */

export async function tryRevealSecret(key: string): Promise<string | undefined> {
  try {
    const value = await revealSecret(key);
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a single line from stdin. Used by every provider's PAT-paste fallback
 * when no OAuth client is configured. Resumes stdin, reads until newline, then
 * pauses stdin so the parent process doesn't hang waiting for EOF.
 */
export async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes("\n")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.split("\n")[0]);
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

/**
 * Build a standard Authorization + content-type + Accept header set for
 * Bearer-token providers. Providers with custom auth header shapes (Anthropic,
 * Upstash, Linear, Supabase PKCE) inline their own.
 */
export function bearerJsonHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Idempotent GET wrapper for the `verify` closures used by api-key providers
 * (and for any other read-only provider call). Thin shim around
 * `fetchWithRetry` that forces `idempotent: true` — callers are always
 * verifying a credential via a read-only endpoint, so retrying transient
 * 429/5xx is always safe. Keeps each provider's `verify` free of retry glue.
 */
export function verifyFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: RetryOptions,
): Promise<Response> {
  return fetchWithRetry(input, init, { ...opts, idempotent: true });
}

/**
 * Redact all but the last `keepLast` characters of a secret for safe display.
 * Always show at least a few asterisks so log lines that include the redacted
 * value still read clearly. Short strings get fully hidden — the suffix alone
 * could be enough to bruteforce a 6-char token.
 *
 * Usage: `ctx.log({ msg: \`token ${scrub(t)} rejected\` })` prints
 * `token ****abcd rejected`, never the raw secret.
 */
export function scrub(value: string, keepLast = 4): string {
  if (!value) return "";
  if (value.length <= keepLast) return "****";
  return `****${value.slice(-keepLast)}`;
}
