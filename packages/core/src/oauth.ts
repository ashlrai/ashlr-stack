import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { platform } from "node:os";
import { StackError } from "./errors.ts";

/**
 * The deterministic loopback port Stack tries first for OAuth callbacks.
 * Register `http://127.0.0.1:8787/callback` as the redirect URI in your
 * OAuth app (Supabase, GitHub, etc.) so no wildcard matching is needed.
 * Stack falls back to a random OS-assigned port only when 8787 is in use.
 */
export const STACK_OAUTH_PORT = 8787;

/**
 * Minimal OAuth PKCE helper suitable for CLI/desktop OAuth flows. Spins up a
 * localhost loopback server, opens the browser to the provider auth URL,
 * catches the callback, then exchanges the code for an access token.
 *
 * This helper is transport-only — each provider composes it with its own URLs
 * and scopes.
 */

export interface PkceFlowOptions {
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  scope?: string;
  /** Additional query params for the authorize request. */
  extraAuthParams?: Record<string, string>;
  /** Human-readable label used in console prompts. */
  providerName: string;
  /** Timeout in ms. Defaults to 5 minutes. */
  timeoutMs?: number;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  [key: string]: unknown;
}

export async function runPkceFlow(opts: PkceFlowOptions): Promise<TokenResponse> {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const { code, redirectUri } = await captureCallback({
    state,
    authUrl: opts.authUrl,
    clientId: opts.clientId,
    challenge,
    scope: opts.scope,
    extraAuthParams: opts.extraAuthParams,
    providerName: opts.providerName,
    timeoutMs: opts.timeoutMs ?? 5 * 60 * 1000,
  });

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: opts.clientId,
    code_verifier: verifier,
  });

  const response = await fetch(opts.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new StackError(
      "OAUTH_TOKEN_EXCHANGE_FAILED",
      `${opts.providerName} rejected the token exchange (${response.status}): ${text}`,
    );
  }

  return (await response.json()) as TokenResponse;
}

interface CaptureArgs {
  state: string;
  authUrl: string;
  clientId: string;
  challenge: string;
  scope?: string;
  extraAuthParams?: Record<string, string>;
  providerName: string;
  timeoutMs: number;
}

async function captureCallback(args: CaptureArgs): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    // Bind the port BEFORE registering the request handler. This guarantees
    // `redirectUri` is a completed string by the time any callback request
    // can possibly arrive, eliminating the race where an adversary-replayed
    // callback could land with `redirectUri === ""`.
    const server = createServer();

    const timer = setTimeout(() => {
      server.close();
      reject(new StackError("OAUTH_TIMEOUT", `${args.providerName} auth timed out.`));
    }, args.timeoutMs);
    server.on("close", () => clearTimeout(timer));

    function startListening(preferredPort: number) {
      server.listen(preferredPort, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        server.on("request", (req, res) => {
          if (!req.url) {
            res.writeHead(400).end();
            return;
          }
          const url = new URL(req.url, "http://127.0.0.1");
          if (url.pathname !== "/callback") {
            res.writeHead(404).end();
            return;
          }
          const receivedState = url.searchParams.get("state");
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");
          if (error) {
            res
              .writeHead(400, { "content-type": "text/html" })
              .end(htmlPage("error", args.providerName, error));
            server.close();
            reject(new StackError("OAUTH_DENIED", `${args.providerName} auth denied: ${error}`));
            return;
          }
          if (!code || receivedState !== args.state) {
            res
              .writeHead(400, { "content-type": "text/html" })
              .end(htmlPage("error", args.providerName, "state mismatch"));
            server.close();
            reject(
              new StackError("OAUTH_STATE_MISMATCH", "Auth callback state did not match request."),
            );
            return;
          }
          res
            .writeHead(200, { "content-type": "text/html" })
            .end(htmlPage("ok", args.providerName));
          server.close();
          resolve({ code, redirectUri });
        });

        const params = new URLSearchParams({
          response_type: "code",
          client_id: args.clientId,
          redirect_uri: redirectUri,
          state: args.state,
          code_challenge: args.challenge,
          code_challenge_method: "S256",
          ...(args.scope ? { scope: args.scope } : {}),
          ...(args.extraAuthParams ?? {}),
        });
        const authorizeUrl = `${args.authUrl}?${params.toString()}`;

        console.log(`\n  Opening ${args.providerName} in your browser…`);
        console.log(`  If nothing happens, visit:\n    ${authorizeUrl}\n`);
        openBrowser(authorizeUrl);
      });
    }

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.warn(
          `  [stack] Port ${STACK_OAUTH_PORT} in use, falling back to OS-assigned port.`,
        );
        server.removeAllListeners("error");
        startListening(0);
      } else {
        reject(new StackError("OAUTH_SERVER_ERROR", `OAuth server error: ${err.message}`));
      }
    });

    startListening(STACK_OAUTH_PORT);
  });
}

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* user can still copy the URL manually */
  }
}

function base64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function htmlPage(kind: "ok" | "error", provider: string, detail?: string): string {
  const title = kind === "ok" ? "Sign-in complete" : "Sign-in failed";
  const body =
    kind === "ok"
      ? `You can close this tab and return to your terminal. Stack has finished wiring up ${provider}.`
      : `Something went wrong${detail ? `: ${detail}` : ""}. Return to your terminal for next steps.`;
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>html,body{height:100%;margin:0;font-family:ui-sans-serif,system-ui,-apple-system}main{display:grid;place-items:center;height:100%}section{max-width:420px;padding:32px;border-radius:12px;background:#fafafa;border:1px solid #eee}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#555;line-height:1.5}</style>
<main><section><h1>${title}</h1><p>${body}</p></section></main>`;
}
