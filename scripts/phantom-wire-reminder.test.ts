import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

describe("generated webhook verification reminder", () => {
  it("remains a comment when the example is uncommented for every webhook provider", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "reminder", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);

      for (const path of result.webhooks) {
        const lines = readFileSync(path, "utf8").split("\n");
        const body = lines.indexOf("//   const body = await req.text();");
        const success = lines.indexOf('//   return new Response("ok", { status: 200 });');
        expect(body).toBeGreaterThanOrEqual(0);
        expect(success).toBeGreaterThan(body + 1);

        // Inspect the emitted text only: the outer // disables the example,
        // while the inner // keeps each reminder line commented if enabled.
        const reminder = lines.slice(body + 1, success);
        expect(reminder.every((line) => line.startsWith("//   // "))).toBe(true);
        expect(reminder[0]).toContain("TODO(security): signature verification is NOT implemented");
        expect(reminder.join("\n")).toContain("parse, trust, or act on the body.");
      }
    } finally {
      harness.cleanup();
    }
  });
});
