import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFakePhantom } from "../__tests__/_harness.ts";
import { webhookStubFor, wirePhantomForRecipe } from "./phantom-wire.ts";

describe("generated webhook examples", () => {
  for (const [provider, header] of [
    ["stripe", "stripe-signature"],
    ["clerk", "svix-signature"],
    ["supabase", "x-supabase-signature"],
    ["github", "x-hub-signature-256"],
    ["other", "x-webhook-signature"],
  ]) {
    it(`${provider} warns that the example does not authenticate requests`, () => {
      const example = webhookStubFor(provider);
      expect(example).toContain(
        "This entire example is commented out and does not verify signatures.",
      );
      expect(example).toContain("signature verification is NOT implemented here");
      expect(example).toContain(
        "200 without authenticating the request. Implement verification first.",
      );
      expect(example).toContain(`req.headers.get("${header}")`);
      expect(example).toContain(`to this endpoint can forge a ${provider} webhook.`);
      const lines = example.split("\n");
      const handler = lines.findIndex((line) => line.startsWith("// export async function handle"));
      const success = lines.findIndex((line) => line.includes('return new Response("ok"'));
      const warning = lines.findIndex((line) => line.includes("does not verify signatures"));
      expect(warning).toBeGreaterThanOrEqual(0);
      expect(handler).toBeGreaterThan(warning);
      expect(success).toBeGreaterThan(handler);
      expect(lines[success]).toMatch(/^\/\/\s+return new Response/);
      expect(lines.every((line) => line.trim() === "" || line.startsWith("//"))).toBe(true);
    });
  }
});

it("writes the signature warning into each generated webhook file", async () => {
  const harness = setupFakePhantom();
  const dir = mkdtempSync(join(tmpdir(), "wire-webhook-warning-"));
  try {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const result = await wirePhantomForRecipe(
      {
        id: "webhook-examples",
        query: "webhook examples",
        createdAt: "2026-04-18T00:00:00.000Z",
        providers: providers.map((name) => ({ name })),
      },
      { cwd: dir },
    );

    expect(result.webhooks).toEqual(
      providers.map((provider) => join(dir, ".stack", "webhooks", `${provider}.ts`)),
    );
    for (const path of result.webhooks) {
      const example = readFileSync(path, "utf8");
      expect(example).toContain(
        "This entire example is commented out and does not verify signatures.",
      );
      expect(example).toContain("signature verification is NOT implemented here");
      expect(example).toContain(
        "200 without authenticating the request. Implement verification first.",
      );
      expect(example.split("\n").every((line) => line.trim() === "" || line.startsWith("//"))).toBe(
        true,
      );
    }
  } finally {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
