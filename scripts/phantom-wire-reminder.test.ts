import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

describe("generated webhook signature-verification reminder", () => {
  it.each(["available", "unavailable"])("survives Phantom being %s", async (availability) => {
    const providers = [
      ["stripe", "stripe.webhooks.constructEvent"],
      ["clerk", "new Webhook(secret).verify(body, headers)"],
      ["supabase", "x-supabase-signature"],
      ["github", "x-hub-signature-256"],
    ];
    const harness = setupFakePhantom();
    try {
      if (availability === "unavailable") {
        writeFileSync(join(harness.dir, "phantom"), "#!/usr/bin/env bash\nexit 1\n");
      }
      const result = await wirePhantomForRecipe(
        {
          id: "reminder",
          query: "",
          createdAt: "",
          providers: providers.map(([name]) => ({ name })),
        },
        { cwd: harness.dir },
      );

      expect(result.webhooks).toEqual(
        providers.map(([name]) => join(harness.dir, ".stack/webhooks", `${name}.ts`)),
      );
      for (const [index, [provider, hint]] of providers.entries()) {
        const stub = readFileSync(result.webhooks[index], "utf-8");
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!example) throw new Error(`Missing ${provider} webhook example`);

        expect(example.split("\n").every((line) => line.startsWith("//"))).toBe(true);
        expect(example).toContain("//   // TODO(security): signature verification is NOT implemented here.");
        expect(example).toContain("unauthenticated, attacker-controlled input");
        expect(example).toContain(`forge a ${provider} webhook`);
        expect(example).toContain(hint);
        expect(example).toContain("parse, trust, or act on the body");
      }
    } finally {
      harness.cleanup();
    }
  });
});
