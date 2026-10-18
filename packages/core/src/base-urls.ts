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

/** Anthropic API root; Stack appends `/v1/...`. */
export function anthropicBaseUrl(env: Env = process.env): string {
  return clean(env.ANTHROPIC_BASE_URL) ?? DEFAULT_ANTHROPIC_BASE_URL;
}

/** OpenAI API root including `/v1`, the same convention as the OpenAI SDKs. */
export function openaiBaseUrl(env: Env = process.env): string {
  return clean(env.OPENAI_BASE_URL) ?? DEFAULT_OPENAI_BASE_URL;
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
