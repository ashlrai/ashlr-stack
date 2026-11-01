import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";

const doc = readFileSync(new URL("../docs/phantom-wire-assumptions.md", import.meta.url), "utf8");
const source = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);

describe("Phantom wire assumptions", () => {
  it("keeps the provider table aligned with the generated, commented examples", async () => {
    const file = ts.createSourceFile("phantom-wire.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = file.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((item) => item.name.getText(file) === "WEBHOOK_PROVIDERS");
    const initializer = declaration?.initializer;
    expect(initializer && ts.isNewExpression(initializer)).toBe(true);
    if (!initializer || !ts.isNewExpression(initializer)) throw new Error("Missing provider set");
    const array = initializer.arguments?.[0];
    if (!array || !ts.isArrayLiteralExpression(array)) throw new Error("Missing provider list");
    const providers = array.elements.map((element) => {
      if (!ts.isStringLiteral(element)) throw new Error("Provider must be a string literal");
      return element.text;
    });
    expect(providers.length).toBeGreaterThan(0);

    const rows = [...doc.matchAll(/^\| (\w+) \| `([^`]+)` \| `([^`]+)` \|$/gm)];
    expect(rows.map((row) => row[1])).toEqual(providers);
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "examples",
          query: "",
          createdAt: "",
          providers: providers.map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      for (const [index, path] of result.webhooks.entries()) {
        const stub = readFileSync(path, "utf8");
        expect(stub.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
        expect(stub).toContain(`req.headers.get("${rows[index][2]}")`);
        expect(stub).toContain(`phantom reveal ${rows[index][3]}`);
        expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  it("distinguishes active wiring from both unsigned trust boundaries", () => {
    expect(doc).toContain("## Implemented behavior");
    expect(doc).toContain("## Signature-verification TODO and trust limits");
    expect(doc).toContain("not implemented verification");
    expect(doc).toContain("accepts any non-empty header");
    expect(doc).toContain("Recipe manifests are also unsigned");
    expect(doc).toContain("../packages/core/src/ai/phantom-wire.ts#L117");
  });
});
