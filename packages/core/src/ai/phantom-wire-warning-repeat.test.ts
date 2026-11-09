import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFakePhantom } from "../__tests__/_harness.ts";
import { webhookStubFor, wirePhantomForRecipe } from "./phantom-wire.ts";

const warning = "This entire example is commented out and does not verify signatures.";
const todo = "signature verification is NOT implemented here";

describe("verification warnings on repeated generation", () => {
  it("includes the warning in every interleaved example", () => {
    for (const provider of ["stripe", "clerk", "stripe", "github", "clerk", "other", "other"]) {
      const example = webhookStubFor(provider);
      expect(example).toContain(`webhook handler stub for ${provider}.`);
      expect(example).toContain(warning);
      expect(example).toContain(todo);
    }
  });

  it("writes the warning again when webhook files are regenerated", async () => {
    const harness = setupFakePhantom();
    const dir = mkdtempSync(join(tmpdir(), "wire-warning-repeat-"));
    const providers = ["stripe", "clerk", "supabase", "github"];
    const recipe = {
      id: "repeat-webhooks",
      query: "webhook examples",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: providers.map((name) => ({ name })),
    };
    try {
      for (let generation = 0; generation < 3; generation++) {
        const result = await wirePhantomForRecipe(recipe, { cwd: dir });
        expect(result.webhooks).toEqual(
          providers.map((provider) => join(dir, ".stack", "webhooks", `${provider}.ts`)),
        );
        for (const path of result.webhooks) {
          const example = readFileSync(path, "utf8");
          expect(example).toContain(warning);
          expect(example).toContain(todo);
          // Make the next pass prove it wrote a fresh example, not a stale file.
          writeFileSync(path, "previous generation");
        }
      }
    } finally {
      harness.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
