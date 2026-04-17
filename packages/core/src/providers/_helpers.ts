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
