import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Source-level provider detection. Reads package.json / requirements.txt /
 * pyproject.toml / go.mod / Cargo.toml plus framework config files and
 * reports which curated providers the project *already uses*.
 *
 * This is the backbone of `stack scan` and zero-config onboarding. It runs on
 * any repo — committed .stack.toml or not — and returns provider names plus
 * evidence strings for auditing.
 */

export type DetectionConfidence = "high" | "medium" | "low";

export interface SourceDetection {
  provider: string;
  confidence: DetectionConfidence;
  signals: string[];
}

export interface SourceScanOptions {
  /** Skip detection of providers that require hitting the network. Default: true. */
  offlineOnly?: boolean;
}

interface DepRule {
  provider: string;
  /** Exact match or prefix on the dep name. */
  matches: (dep: string) => boolean;
  confidence: DetectionConfidence;
}

const JS_RULES: DepRule[] = [
  { provider: "supabase", matches: (d) => d.startsWith("@supabase/"), confidence: "high" },
  { provider: "neon", matches: (d) => d.startsWith("@neondatabase/"), confidence: "high" },
  {
    provider: "vercel",
    matches: (d) =>
      d === "@vercel/analytics" || d === "@vercel/speed-insights" || d === "@vercel/kv",
    confidence: "medium",
  },
  { provider: "sentry", matches: (d) => d.startsWith("@sentry/"), confidence: "high" },
  {
    provider: "posthog",
    matches: (d) => d === "posthog-js" || d === "posthog-node",
    confidence: "high",
  },
  { provider: "openai", matches: (d) => d === "openai", confidence: "high" },
  { provider: "anthropic", matches: (d) => d === "@anthropic-ai/sdk", confidence: "high" },
  {
    provider: "stripe",
    matches: (d) => d === "stripe" || d === "@stripe/stripe-js",
    confidence: "high",
  },
  { provider: "clerk", matches: (d) => d.startsWith("@clerk/"), confidence: "high" },
  { provider: "resend", matches: (d) => d === "resend", confidence: "high" },
  {
    provider: "upstash",
    matches: (d) => d.startsWith("@upstash/"),
    confidence: "high",
  },
  { provider: "linear", matches: (d) => d === "@linear/sdk", confidence: "high" },
  {
    provider: "cloudflare",
    matches: (d) => d === "wrangler" || d.startsWith("@cloudflare/"),
    confidence: "high",
  },
  {
    provider: "turso",
    matches: (d) => d === "@libsql/client" || d === "@libsql/kysely-libsql",
    confidence: "high",
  },
  {
    provider: "convex",
    matches: (d) => d === "convex" || d.startsWith("@convex-dev/"),
    confidence: "high",
  },
  {
    provider: "firebase",
    matches: (d) => d === "firebase" || d === "firebase-admin" || d.startsWith("@firebase/"),
    confidence: "high",
  },
  {
    provider: "render",
    // No canonical npm package; rely on config files & env detection.
    matches: () => false,
    confidence: "low",
  },
  {
    provider: "replicate",
    matches: (d) => d === "replicate",
    confidence: "high",
  },
  {
    provider: "braintrust",
    matches: (d) => d === "braintrust" || d === "@braintrust/sdk",
    confidence: "high",
  },
  {
    provider: "modal",
    // Modal is Python-first; the dep lives in requirements.txt.
    matches: () => false,
    confidence: "low",
  },
];

const PY_RULES: DepRule[] = [
  {
    provider: "supabase",
    matches: (d) => d === "supabase" || d === "supabase-py",
    confidence: "high",
  },
  { provider: "openai", matches: (d) => d === "openai", confidence: "high" },
  { provider: "anthropic", matches: (d) => d === "anthropic", confidence: "high" },
  { provider: "sentry", matches: (d) => d === "sentry-sdk", confidence: "high" },
  { provider: "stripe", matches: (d) => d === "stripe", confidence: "high" },
  { provider: "posthog", matches: (d) => d === "posthog", confidence: "high" },
  { provider: "resend", matches: (d) => d === "resend", confidence: "high" },
  { provider: "modal", matches: (d) => d === "modal", confidence: "high" },
  { provider: "replicate", matches: (d) => d === "replicate", confidence: "high" },
  { provider: "braintrust", matches: (d) => d === "braintrust", confidence: "high" },
];

const GO_RULES: DepRule[] = [
  {
    provider: "supabase",
    matches: (d) => d.startsWith("github.com/supabase-community/"),
    confidence: "high",
  },
  {
    provider: "openai",
    matches: (d) => d === "github.com/sashabaranov/go-openai",
    confidence: "high",
  },
  {
    provider: "anthropic",
    matches: (d) => d.startsWith("github.com/liushuangls/go-anthropic"),
    confidence: "medium",
  },
  {
    provider: "sentry",
    matches: (d) => d === "github.com/getsentry/sentry-go",
    confidence: "high",
  },
  {
    provider: "stripe",
    matches: (d) => d.startsWith("github.com/stripe/stripe-go"),
    confidence: "high",
  },
];

const RUST_RULES: DepRule[] = [
  {
    provider: "openai",
    matches: (d) => d === "async-openai" || d === "openai",
    confidence: "high",
  },
  { provider: "sentry", matches: (d) => d === "sentry", confidence: "high" },
  { provider: "stripe", matches: (d) => d === "async-stripe", confidence: "high" },
];

export async function scanSource(
  cwd: string,
  _opts: SourceScanOptions = {},
): Promise<SourceDetection[]> {
  const hits = new Map<string, SourceDetection>();

  const add = (provider: string, signal: string, confidence: DetectionConfidence) => {
    const existing = hits.get(provider);
    if (!existing) {
      hits.set(provider, { provider, confidence, signals: [signal] });
      return;
    }
    if (!existing.signals.includes(signal)) existing.signals.push(signal);
    existing.confidence = rankUp(existing.confidence, confidence);
  };

  await scanPackageJson(cwd, add);
  await scanPython(cwd, add);
  await scanGoMod(cwd, add);
  await scanCargoToml(cwd, add);
  await scanConfigFiles(cwd, add);
  await scanEnvExample(cwd, add);

  return Array.from(hits.values()).sort((a, b) => {
    const order: Record<DetectionConfidence, number> = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence] || a.provider.localeCompare(b.provider);
  });
}

function rankUp(a: DetectionConfidence, b: DetectionConfidence): DetectionConfidence {
  const order: DetectionConfidence[] = ["low", "medium", "high"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

async function scanPackageJson(
  cwd: string,
  add: (p: string, s: string, c: DetectionConfidence) => void,
): Promise<void> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const dep of Object.keys(allDeps)) {
      for (const rule of JS_RULES) {
        if (rule.matches(dep)) {
          add(rule.provider, `package.json:${dep}`, rule.confidence);
        }
      }
    }
  } catch {
    /* malformed package.json — skip */
  }
}

async function scanPython(
  cwd: string,
  add: (p: string, s: string, c: DetectionConfidence) => void,
): Promise<void> {
  const reqPath = join(cwd, "requirements.txt");
  if (existsSync(reqPath)) {
    const text = await readFile(reqPath, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const pkg = line
        .split(/[=<>!~\[]/)[0]
        .trim()
        .toLowerCase();
      if (!pkg || pkg.startsWith("#")) continue;
      for (const rule of PY_RULES) {
        if (rule.matches(pkg)) add(rule.provider, `requirements.txt:${pkg}`, rule.confidence);
      }
    }
  }
  const pyprojPath = join(cwd, "pyproject.toml");
  if (existsSync(pyprojPath)) {
    const text = await readFile(pyprojPath, "utf-8");
    // Cheap string matching — the TOML module is fine but overkill here.
    for (const rule of PY_RULES) {
      for (const sample of candidatePyprojectNames(rule)) {
        if (new RegExp(`["'\\s]${escapeRegExp(sample)}["'\\s=><~]`).test(text)) {
          add(rule.provider, `pyproject.toml:${sample}`, rule.confidence);
        }
      }
    }
  }
}

function candidatePyprojectNames(rule: DepRule): string[] {
  // The rule matches on lowercased dep names; reverse-derive a few
  // canonical package names to scan pyproject text for.
  const samples = [
    "supabase",
    "supabase-py",
    "openai",
    "anthropic",
    "sentry-sdk",
    "stripe",
    "posthog",
    "resend",
  ];
  return samples.filter((s) => rule.matches(s));
}

async function scanGoMod(
  cwd: string,
  add: (p: string, s: string, c: DetectionConfidence) => void,
): Promise<void> {
  const path = join(cwd, "go.mod");
  if (!existsSync(path)) return;
  const text = await readFile(path, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("require") && !trimmed.match(/^github\.com/)) continue;
    const tokens = trimmed.split(/\s+/);
    for (const tok of tokens) {
      for (const rule of GO_RULES) {
        if (rule.matches(tok)) add(rule.provider, `go.mod:${tok}`, rule.confidence);
      }
    }
  }
}

async function scanCargoToml(
  cwd: string,
  add: (p: string, s: string, c: DetectionConfidence) => void,
): Promise<void> {
  const path = join(cwd, "Cargo.toml");
  if (!existsSync(path)) return;
  const text = await readFile(path, "utf-8");
  for (const rule of RUST_RULES) {
    for (const sample of ["openai", "async-openai", "sentry", "async-stripe"]) {
      if (!rule.matches(sample)) continue;
      if (new RegExp(`^${escapeRegExp(sample)}\\s*=`, "m").test(text)) {
        add(rule.provider, `Cargo.toml:${sample}`, rule.confidence);
      }
    }
  }
}

async function scanConfigFiles(
  cwd: string,
  add: (p: string, s: string, c: DetectionConfidence) => void,
): Promise<void> {
  const files: Array<[string, string, DetectionConfidence]> = [
    ["vercel.json", "vercel", "high"],
    [".vercel", "vercel", "medium"],
    ["fly.toml", "fly", "high"],
    ["railway.json", "railway", "high"],
    ["railway.toml", "railway", "high"],
    ["supabase/config.toml", "supabase", "high"],
    ["sentry.properties", "sentry", "high"],
    ["sentry.client.config.ts", "sentry", "high"],
    ["sentry.client.config.js", "sentry", "high"],
    ["sentry.server.config.ts", "sentry", "high"],
    ["sentry.server.config.js", "sentry", "high"],
    ["amplify.yml", "aws", "low"],
    ["wrangler.toml", "cloudflare", "high"],
    ["wrangler.jsonc", "cloudflare", "high"],
    ["wrangler.json", "cloudflare", "high"],
    ["convex/", "convex", "high"],
    ["convex.config.ts", "convex", "high"],
    ["firebase.json", "firebase", "high"],
    [".firebaserc", "firebase", "high"],
    ["render.yaml", "render", "high"],
    [".github/workflows", "github", "medium"],
  ];
  for (const [relpath, provider, confidence] of files) {
    const p = join(cwd, relpath);
    if (existsSync(p)) add(provider, relpath, confidence);
  }

  // GitHub Actions: any YAML file is a decent signal.
  const workflows = join(cwd, ".github", "workflows");
  if (existsSync(workflows)) {
    try {
      const files = readdirSync(workflows);
      for (const f of files) {
        if (f.endsWith(".yml") || f.endsWith(".yaml")) {
          add("github", `.github/workflows/${f}`, "high");
        }
      }
    } catch {
      /* best-effort */
    }
  }
}

async function scanEnvExample(
  cwd: string,
  add: (p: string, s: string, c: DetectionConfidence) => void,
): Promise<void> {
  for (const candidate of [".env.example", ".env.sample", ".env.template"]) {
    const p = join(cwd, candidate);
    if (!existsSync(p)) continue;
    const text = await readFile(p, "utf-8");
    const { parseEnv, detectProvider } = await import("./detect.ts");
    for (const { key } of parseEnv(text)) {
      const provider = detectProvider(key);
      if (provider) add(provider, `${candidate}:${key}`, "medium");
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
