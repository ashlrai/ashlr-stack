import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { scanSource } from "../detect-source.ts";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-scan-"));
  projects.push(dir);
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

test.each(["{broken", "null", "{}"])(
  "malformed or empty package %s does not hide other evidence",
  async (raw) => {
    const cwd = makeProject({ "package.json": raw, "fly.toml": "" });
    expect(await scanSource(cwd)).toEqual([
      { provider: "fly", confidence: "high", signals: ["fly.toml"] },
    ]);
  },
);

test.each([
  [
    "pyproject.toml",
    '[project]\ndependencies = ["supabase-py>=1", "anthropic", "resend"]',
    ["anthropic", "resend", "supabase"],
  ],
  [
    "Cargo.toml",
    '[dependencies]\nasync-openai = "1"\nsentry = "1"\nasync-stripe = "1"',
    ["openai", "sentry", "stripe"],
  ],
  [
    "requirements.txt",
    "# openai\n\nANTHROPIC[extra]>=1\r\nmodal==1\nreplicate~=1\nbraintrust!=1\nunknown",
    ["anthropic", "braintrust", "modal", "replicate"],
  ],
  [
    "go.mod",
    "module example.com/app\nrequire github.com/liushuangls/go-anthropic v1\nrequire github.com/sashabaranov/go-openai v1",
    ["openai", "anthropic"],
  ],
] as const)("scans %s with exact evidence", async (file, content, providers) => {
  const hits = await scanSource(makeProject({ [file]: content }));
  expect(hits.map((hit) => hit.provider)).toEqual([...providers]);
  for (const hit of hits) {
    expect(hit.signals).toHaveLength(1);
    expect(hit.signals[0]).toStartWith(`${file}:`);
  }
});

test("deduplicates dependency evidence and upgrades confidence without losing signals", async () => {
  const hits = await scanSource(
    makeProject({
      "package.json": JSON.stringify({
        dependencies: { "@vercel/kv": "1" },
        devDependencies: { "@vercel/kv": "1" },
      }),
      "vercel.json": "{}",
      ".env.sample": "VERCEL_TOKEN=\nUNKNOWN_NAME=",
      ".env.template": "VERCEL_TOKEN=",
    }),
  );
  expect(hits).toEqual([
    {
      provider: "vercel",
      confidence: "high",
      signals: [
        "package.json:@vercel/kv",
        "vercel.json",
        ".env.sample:VERCEL_TOKEN",
        ".env.template:VERCEL_TOKEN",
      ],
    },
  ]);
});

test("scans a project directory containing spaces and reports relative file paths", async () => {
  const root = makeProject({
    "project with spaces/package.json": JSON.stringify({ dependencies: { openai: "1" } }),
    "project with spaces/supabase/config.toml": "[api]",
    "project with spaces/.env.example": "OPENAI_API_KEY=",
    "project with spaces/vercel.json": "{}",
  });

  expect(await scanSource(join(root, "project with spaces"))).toEqual([
    {
      provider: "openai",
      confidence: "high",
      signals: ["package.json:openai", ".env.example:OPENAI_API_KEY"],
    },
    { provider: "supabase", confidence: "high", signals: ["supabase/config.toml"] },
    { provider: "vercel", confidence: "high", signals: ["vercel.json"] },
  ]);
});

test("finds the same source markers in equivalent paths with and without spaces", async () => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ dependencies: { openai: "1" } }),
    "requirements.txt": "modal==1",
    "pyproject.toml": '[project]\ndependencies = ["resend"]',
    "go.mod": "module example.com/app\nrequire github.com/stripe/stripe-go/v76 v76.0.0",
    "Cargo.toml": '[dependencies]\nsentry = "1"',
    "supabase/config.toml": "[api]",
    ".github/workflows/ci.yml": "name: CI",
    ".env.example": "ANTHROPIC_API_KEY=",
  };
  const root = makeProject(
    Object.fromEntries(
      ["project", "parent with spaces/project with spaces"].flatMap((dir) =>
        Object.entries(files).map(([path, content]) => [join(dir, path), content]),
      ),
    ),
  );

  const plain = await scanSource(join(root, "project"));
  const spaced = await scanSource(join(root, "parent with spaces", "project with spaces"));
  expect(plain).toEqual([
    {
      provider: "github",
      confidence: "high",
      signals: [".github/workflows", ".github/workflows/ci.yml"],
    },
    { provider: "modal", confidence: "high", signals: ["requirements.txt:modal"] },
    { provider: "openai", confidence: "high", signals: ["package.json:openai"] },
    { provider: "resend", confidence: "high", signals: ["pyproject.toml:resend"] },
    { provider: "sentry", confidence: "high", signals: ["Cargo.toml:sentry"] },
    { provider: "stripe", confidence: "high", signals: ["go.mod:github.com/stripe/stripe-go/v76"] },
    { provider: "supabase", confidence: "high", signals: ["supabase/config.toml"] },
    { provider: "anthropic", confidence: "medium", signals: [".env.example:ANTHROPIC_API_KEY"] },
  ]);
  expect(spaced).toEqual(plain);
});

test("empty project has no detections", async () => {
  expect(await scanSource(makeProject({}))).toEqual([]);
});

test.each([["--json"], ["--yes"]])(
  "scan %s rejects a nonexistent project without creating files",
  async (flag) => {
    const root = makeProject({});
    const home = makeProject({});
    const missing = join(root, "missing", "project");
    const cli = join(import.meta.dir, "..", "..", "..", "cli", "src", "index.ts");
    const proc = Bun.spawn([process.execPath, cli, "scan", flag, "--path", missing], {
      cwd: root,
      env: {
        PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
        HOME: home,
        CI: "1",
        NO_COLOR: "1",
        STACK_TELEMETRY: "0",
        STACK_NO_UPDATE_CHECK: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(code).toBe(1);
    expect(stdout + stderr).toContain(`Path "${missing}" does not exist or is not a directory.`);
    expect(stdout).not.toContain('"hits"');
    expect(stdout).not.toContain("No providers detected");
    expect(existsSync(missing)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  },
  30_000,
);

test.each([
  ["package.json", JSON.stringify({ name: "openai", dependencies: {}, devDependencies: {} })],
  ["requirements.txt", ""],
  ["pyproject.toml", "[project]\ndependencies = []\n"],
  ["go.mod", "module example.com/app\n\ngo 1.22\n"],
  ["Cargo.toml", '[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\n'],
] as const)("empty dependency manifest %s produces no detections", async (file, content) => {
  expect(await scanSource(makeProject({ [file]: content }))).toEqual([]);
});
