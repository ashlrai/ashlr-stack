import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const doc = readFileSync(new URL("../docs/phantom-wire-data-flow.md", import.meta.url), "utf8");
const source = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);

describe("Phantom wire data flow", () => {
  it("reads the example body before the signature-verification TODO and success", async () => {
    const harness = setupFakePhantom({});
    try {
      const result = await wirePhantomForRecipe(
        { id: "body-order", query: "", createdAt: "", providers: [{ name: "stripe" }] },
        { cwd: harness.dir },
      );
      const stub = readFileSync(result.webhooks[0]!, "utf8");
      const body = stub.indexOf("const body = await req.text();");
      const verificationTodo = stub.indexOf(
        "TODO(security): signature verification is NOT implemented here.",
      );
      const success = stub.indexOf("status: 200");
      expect(body).toBeGreaterThanOrEqual(0);
      expect(verificationTodo).toBeGreaterThan(body);
      expect(success).toBeGreaterThan(verificationTodo);
      expect(success).toBeGreaterThan(body);
      expect(doc).toContain("reads the body, and returns 200");
    } finally {
      harness.cleanup();
    }
  });

  it("does not present reading a webhook body as sender verification", async () => {
    const harness = setupFakePhantom({});
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "webhook-boundary",
          query: "",
          createdAt: "",
          providers: ["stripe", "clerk", "supabase", "github"].map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(4);
      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        expect(stub).toContain("const body = await req.text();");
        expect(stub).toContain("signature verification is NOT implemented here");
        expect(stub).toContain("is unauthenticated, attacker-controlled input");
        expect(stub).toContain("parse, trust, or act on the body");
        expect(stub).not.toMatch(/(?:reading|read(?:s|ing)?|parsing) (?:the |a )?(?:request )?body (?:verifies|authenticates|confirms) (?:the |its )?(?:sender|request)/i);
      }
    } finally {
      harness.cleanup();
    }
  });

  it("matches the documented inventory example and generated security boundary", async () => {
    const harness = setupFakePhantom({ STRIPE_SECRET_KEY: "test-value" });
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "flow-example",
          query: "",
          createdAt: "",
          providers: [{ name: "stripe" }, { name: "github" }, { name: "unknown" }],
        },
        { cwd: harness.dir },
      );
      expect(result).toEqual({
        present: ["stripe:STRIPE_SECRET_KEY"],
        missing: ["github:GITHUB_TOKEN"],
        skipped: ["unknown"],
        webhooks: [
          join(harness.dir, ".stack/webhooks/stripe.ts"),
          join(harness.dir, ".stack/webhooks/github.ts"),
        ],
      });
      for (const entry of [...result.present, ...result.missing, ...result.skipped]) {
        expect(doc).toContain(`\`${entry}\``);
      }
      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
      }
      expect(doc).toContain("Webhook signature verification is not implemented");
      expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  // Folded in from the former phantom-wire-assumptions doc and test.
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
    expect(doc).toContain("## Webhook output");
    expect(doc).toContain("## Signature-verification TODO and trust limits");
    expect(doc).toContain("not implemented verification");
    expect(doc).toContain("accepts any non-empty header");
    expect(doc).toContain("Recipe manifests are also unsigned");
    expect(doc).toContain("../packages/core/src/ai/phantom-wire.ts#L118");
  });
});
