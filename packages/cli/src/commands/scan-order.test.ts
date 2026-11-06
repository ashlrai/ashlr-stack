import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));

test("repeated CLI scans preserve result ordering at each confidence threshold", () => {
  const project = mkdtempSync(join(tmpdir(), "stack-scan-order-"));
  try {
    // Deliberately insert dependencies out of provider order and give Stripe
    // evidence from two sources. The output must be ordered after aggregation.
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        dependencies: {
          stripe: "1",
          "@vercel/analytics": "1",
          openai: "1",
          "@supabase/supabase-js": "1",
        },
      }),
    );
    writeFileSync(join(project, ".env.example"), "STRIPE_SECRET_KEY=\nRESEND_API_KEY=\n");
    writeFileSync(join(project, "amplify.yml"), "version: 1\n");

    const allHits = [
      { provider: "openai", confidence: "high", sources: ["package.json:openai"] },
      {
        provider: "stripe",
        confidence: "high",
        sources: ["package.json:stripe", ".env.example:STRIPE_SECRET_KEY"],
      },
      {
        provider: "supabase",
        confidence: "high",
        sources: ["package.json:@supabase/supabase-js"],
      },
      { provider: "resend", confidence: "medium", sources: [".env.example:RESEND_API_KEY"] },
      { provider: "vercel", confidence: "medium", sources: ["package.json:@vercel/analytics"] },
      { provider: "aws", confidence: "low", sources: ["amplify.yml"] },
    ];

    for (const [confidence, expected] of [
      ["low", allHits],
      ["medium", allHits.slice(0, 5)],
      ["high", allHits.slice(0, 3)],
    ] as const) {
      let firstOutput = "";
      for (let run = 0; run < 3; run++) {
        const result = spawnSync(
          "bun",
          [CLI_ENTRY, "scan", "--json", "--confidence", confidence, "--path", project],
          { encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, timeout: 15_000 },
        );
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toEqual({ hits: expected });
        if (run === 0) firstOutput = result.stdout;
        else expect(result.stdout).toBe(firstOutput);
      }
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}, 60_000);
