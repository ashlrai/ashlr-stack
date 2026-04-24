import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSource } from "../detect-source.ts";

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-scan-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    const parent = join(full, "..");
    mkdirSync(parent, { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("source scanner — JS/TS", () => {
  test("detects Supabase + Sentry + OpenAI from a Next.js package.json", async () => {
    const cwd = makeProject({
      "package.json": JSON.stringify({
        dependencies: {
          next: "15.0.0",
          "@supabase/supabase-js": "^2.45.0",
          "@supabase/ssr": "^0.5.0",
          "@sentry/nextjs": "^7.0.0",
          openai: "^4.0.0",
          "posthog-js": "^1.0.0",
        },
      }),
    });
    const hits = await scanSource(cwd);
    const names = hits.map((h) => h.provider).sort();
    expect(names).toContain("supabase");
    expect(names).toContain("sentry");
    expect(names).toContain("openai");
    expect(names).toContain("posthog");
    const supabase = hits.find((h) => h.provider === "supabase");
    expect(supabase?.confidence).toBe("high");
    expect(supabase?.signals.some((s) => s.includes("@supabase/"))).toBe(true);
  });

  test("devDependencies count too", async () => {
    const cwd = makeProject({
      "package.json": JSON.stringify({
        devDependencies: { "@anthropic-ai/sdk": "^0.20.0" },
      }),
    });
    const hits = await scanSource(cwd);
    expect(hits.some((h) => h.provider === "anthropic")).toBe(true);
  });

  test("detects Cloudflare (wrangler), Turso (@libsql), Convex", async () => {
    const cwd = makeProject({
      "package.json": JSON.stringify({
        dependencies: {
          "@libsql/client": "^0.4.0",
          convex: "^1.10.0",
        },
        devDependencies: {
          wrangler: "^3.0.0",
        },
      }),
    });
    const hits = await scanSource(cwd);
    const names = hits.map((h) => h.provider);
    expect(names).toContain("cloudflare");
    expect(names).toContain("turso");
    expect(names).toContain("convex");
  });
});

describe("source scanner — config files", () => {
  test("fly.toml + vercel.json + supabase/config.toml all get picked up", async () => {
    const cwd = makeProject({
      "fly.toml": "app = 'myapp'",
      "vercel.json": "{}",
      "supabase/config.toml": "[api]\nport = 54321",
    });
    const hits = await scanSource(cwd);
    const names = hits.map((h) => h.provider);
    expect(names).toContain("fly");
    expect(names).toContain("vercel");
    expect(names).toContain("supabase");
  });

  test(".github/workflows/*.yml wires up github", async () => {
    const cwd = makeProject({
      ".github/workflows/ci.yml": "name: CI\non: push",
    });
    const hits = await scanSource(cwd);
    expect(hits.some((h) => h.provider === "github")).toBe(true);
  });

  test("wrangler.toml picks up Cloudflare", async () => {
    const cwd = makeProject({
      "wrangler.toml": 'name = "my-worker"\nmain = "src/index.ts"',
    });
    const hits = await scanSource(cwd);
    expect(hits.some((h) => h.provider === "cloudflare")).toBe(true);
  });
});

describe("source scanner — .env.example", () => {
  test("secret names in .env.example hint at providers", async () => {
    const cwd = makeProject({
      ".env.example": `
OPENAI_API_KEY=
SENTRY_AUTH_TOKEN=
NODE_ENV=development
`.trim(),
    });
    const hits = await scanSource(cwd);
    const names = hits.map((h) => h.provider);
    expect(names).toContain("openai");
    expect(names).toContain("sentry");
  });
});

describe("source scanner — Python + Go", () => {
  test("requirements.txt picks up openai + sentry-sdk", async () => {
    const cwd = makeProject({
      "requirements.txt": "openai==1.0.0\nsentry-sdk>=2.0.0\nflask",
    });
    const hits = await scanSource(cwd);
    const names = hits.map((h) => h.provider);
    expect(names).toContain("openai");
    expect(names).toContain("sentry");
  });

  test("go.mod picks up supabase + stripe", async () => {
    const cwd = makeProject({
      "go.mod": `module example.com/app

go 1.22

require (
\tgithub.com/supabase-community/supabase-go v0.3.0
\tgithub.com/stripe/stripe-go/v76 v76.0.0
)`,
    });
    const hits = await scanSource(cwd);
    const names = hits.map((h) => h.provider);
    expect(names).toContain("supabase");
    expect(names).toContain("stripe");
  });
});
