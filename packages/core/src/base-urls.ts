/**
 * Model provider base URLs, overridable from the environment.
 *
 * `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` and `OLLAMA_HOST` let a gateway
 * (a LiteLLM proxy, a Phantom proxy, or Ollama on another machine) sit in
 * front of the providers. Unset or blank values give exactly the URLs Stack
 * always used. Values are read when called, not at import.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** Trim whitespace and trailing slashes; `undefined` when nothing is left. */
function clean(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/\/+$/, "").trim();
  return v ? v : undefined;
}

/**
 * A keyed gateway URL must be https, or plain http only to the loopback
 * literals 127.0.0.1 and [::1], so an API key is never sent in clear text
 * across a network. Throws with the variable name only, never the URL (it
 * can carry credentials).
 */
export function assertGatewayUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol === "https:") return value;
  if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]")) {
    return value;
  }
  throw new Error(`${name} must use https, or http only to 127.0.0.1 or [::1]`);
}

/** Anthropic API root; Stack appends `/v1/...`. */
export function anthropicBaseUrl(env: Env = process.env): string {
  const v = clean(env.ANTHROPIC_BASE_URL);
  return v ? assertGatewayUrl("ANTHROPIC_BASE_URL", v) : DEFAULT_ANTHROPIC_BASE_URL;
}

/** OpenAI API root including `/v1`, the same convention as the OpenAI SDKs. */
export function openaiBaseUrl(env: Env = process.env): string {
  const v = clean(env.OPENAI_BASE_URL);
  return v ? assertGatewayUrl("OPENAI_BASE_URL", v) : DEFAULT_OPENAI_BASE_URL;
}

/**
 * Ollama server root. `OLLAMA_HOST` may be `host`, `host:port`, `:port`
 * (localhost) or a full `http://` / `https://` URL, as Ollama itself
 * accepts. A missing scheme becomes `http://`, a missing port 11434.
 */
export function ollamaBaseUrl(env: Env = process.env): string {
  let v = clean(env.OLLAMA_HOST);
  if (!v) return DEFAULT_OLLAMA_BASE_URL;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith(":")) v = `localhost${v}`;
  const slash = v.indexOf("/");
  const authority = slash === -1 ? v : v.slice(0, slash);
  const path = slash === -1 ? "" : v.slice(slash);
  const close = authority.lastIndexOf("]");
  const hasPort =
    close === -1 ? authority.includes(":") : authority.slice(close + 1).startsWith(":");
  return `http://${authority}${hasPort ? "" : ":11434"}${path}`;
}
