import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

describe("Phantom wire example reading note", () => {
  it("points to the source and describes the generated verification reminder", async () => {
    const docUrl = new URL("../docs/phantom-wire-example-reading.md", import.meta.url);
    const doc = readFileSync(docUrl, "utf8");
    const sourceLink = doc.match(/\]\((\.\.\/packages\/core\/src\/ai\/phantom-wire\.ts)\)/)?.[1];
    expect(sourceLink).toBeDefined();
    if (!sourceLink) throw new Error("Missing source link");
    expect(existsSync(new URL(sourceLink, docUrl))).toBe(true);
    const source = readFileSync(new URL(sourceLink, docUrl), "utf8");
    expect(source).toContain("function webhookStubFor(");
    expect(source).toContain("function verificationHintFor(");

    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "reading", query: "", createdAt: "", providers: [{ name: "stripe" }] },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(1);
      const stub = readFileSync(result.webhooks[0], "utf8");
      const reminder = doc.match(/^> (TODO\(security\): .+)$/m)?.[1];
      expect(reminder).toBeDefined();
      expect(reminder).toBe("TODO(security): signature verification is NOT implemented here.");
      expect(stub).toContain(`//   // ${reminder}`);
      expect(stub).toContain("//   const body = await req.text();\n//   // TODO(security):");
      expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
      expect(doc).toContain("any non-empty signature header");
      expect(doc).toContain("unauthenticated, attacker-controlled input");
      expect(doc).toContain("not executable verification");
    } finally {
      harness.cleanup();
    }
  });
});
