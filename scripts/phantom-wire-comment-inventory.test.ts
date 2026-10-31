import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const source = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);
const inventory = readFileSync(
  new URL("../docs/phantom-wire-comment-inventory.md", import.meta.url),
  "utf8",
);

describe("Phantom wire comment inventory", () => {
  it("links to the source comments it inventories", () => {
    const lines = source.split("\n");
    const links = [...inventory.matchAll(/phantom-wire\.ts#L(\d+)/g)];
    expect(links).toHaveLength(7);
    const anchors = [
      "/**",
      "export interface WireResult",
      "/**",
      "if (err instanceof",
      "/**",
      "/**",
      "async function writeWebhookStub",
    ];
    links.forEach((link, index) => expect(lines[Number(link[1]) - 1]).toContain(anchors[index]));
    expect(source).toContain("//   // TODO(security): signature verification is NOT implemented here.");
    expect(inventory).toContain("TODO(security): signature verification is NOT implemented here.");
    expect(inventory).toContain("This remains a comment even if the outer handler is uncommented");
    expect(inventory).toContain("catalog name checks do not establish a recipe's origin or integrity");
  });

  it("matches the provider inventory to the generated commented examples", async () => {
    const file = ts.createSourceFile("phantom-wire.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = file.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((item) => item.name.getText(file) === "WEBHOOK_PROVIDERS");
    const init = declaration?.initializer;
    if (!init || !ts.isNewExpression(init)) throw new Error("Missing webhook provider set");
    const array = init.arguments?.[0];
    if (!array || !ts.isArrayLiteralExpression(array)) throw new Error("Missing provider list");
    const providers = array.elements.map((element) => {
      if (!ts.isStringLiteral(element)) throw new Error("Provider must be a string literal");
      return element.text;
    });
    const rows = [...inventory.matchAll(/^\| (\w+) \| `([^`]+)` \| `([^`]+)` \| (.+) \|$/gm)];
    expect(providers.length).toBeGreaterThan(0);
    expect(rows.map((row) => row[1])).toEqual(providers);

    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "inventory", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      for (const [index, path] of result.webhooks.entries()) {
        const stub = readFileSync(path, "utf8");
        const [, , header, secret, hints] = rows[index];
        expect(stub.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
        expect(stub).toContain(`req.headers.get("${header}")`);
        expect(stub).toContain(`phantom reveal ${secret}`);
        for (const match of hints.matchAll(/`([^`]+)`/g)) expect(stub).toContain(match[1]);
        expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
