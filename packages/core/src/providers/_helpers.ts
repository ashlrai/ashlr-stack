import { type RetryOptions, fetchWithRetry } from "../http.ts";
import { revealSecret } from "../phantom.ts";
import type { ProviderContext } from "./_base.ts";

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
 * Prompt the user for a credential. When the host supplies `ctx.prompt` (the
 * CLI always does), the request goes through it — the CLI pauses its spinner,
 * runs a @clack prompt, then resumes. This is the ONLY safe way to read a
 * credential while a spinner is running: writing the prompt to stderr directly
 * gets clobbered by the spinner's repaint and `stack add` looks like it hung.
 *
 * Falls back to a bare stderr-prompt + stdin read for non-CLI hosts and tests,
 * where no spinner is competing for the terminal.
 */
export async function promptSecret(
  ctx: ProviderContext,
  req: { message: string; howTo?: string },
): Promise<string> {
  if (ctx.prompt) {
    return (await ctx.prompt({ message: req.message, howTo: req.howTo, secret: true })).trim();
  }
  if (req.howTo) process.stderr.write(`\n  ${req.howTo}\n`);
  process.stderr.write(`  ${req.message}: `);
  return (await readLine()).trim();
}

/**
 * Read a single line from stdin. Used by `promptSecret`'s non-CLI fallback when
 * no host prompt is configured. Resumes stdin, reads until newline, then
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
