import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const sourceText = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);
const mapUrl = new URL("../docs/phantom-wire-code-map.md", import.meta.url);
const map = readFileSync(mapUrl, "utf8");
const flat = map.replace(/\s+/g, " ");

function entirelyCommented(stub: string): boolean {
  return stub.split("\n").every((line) => !line || line.startsWith("//"));
}

describe("Phantom wire code map", () => {
  it("maps every top-level function exactly once in the active code section", () => {
    const source = ts.createSourceFile("phantom-wire.ts", sourceText, ts.ScriptTarget.Latest, true);
    const functions = source.statements
      .filter(ts.isFunctionDeclaration)
      .map((node) => node.name?.text)
      .filter((name): name is string => name !== undefined)
      .sort();
    const active = map.split("## Active code\n")[1]?.split("## Commented follow-up")[0];
    expect(active).toBeDefined();
    const rows = [...(active ?? "").matchAll(/^\| `([^`]+)` \| ([^\n]+) \|$/gm)];
    const mappedFunctions = rows
      .map((row) => row[1])
      .filter((name) => !["WireResult", "WEBHOOK_PROVIDERS"].includes(name))
      .sort();
    expect(functions.length).toBeGreaterThan(0);
    expect(mappedFunctions).toEqual(functions);
    expect(rows.map((row) => row[1])).toContain("WireResult");
    expect(rows.map((row) => row[1])).toContain("WEBHOOK_PROVIDERS");
  });

  it("identifies the emitted verification TODO as a commented follow-up", () => {
    const todo = "TODO(security): signature verification is NOT implemented here.";
    const followUp = map.split("## Commented follow-up and limitations\n")[1];
    expect(sourceText).toContain(`//   // ${todo}`);
    expect(followUp).toContain(todo);
    expect(followUp).toContain("no verification runs during wiring");
    expect(followUp).toContain("recipe manifests are unsigned");
  });
});

// The comment inventory was folded into the code map; these checks moved here
// unchanged from scripts/phantom-wire-comment-inventory.test.ts.
describe("Phantom wire comment inventory", () => {
  it("links to the source comments it inventories", () => {
    const lines = sourceText.split("\n");
    const links = [...map.matchAll(/phantom-wire\.ts#L(\d+)/g)];
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
    expect(sourceText).toContain("//   // TODO(security): signature verification is NOT implemented here.");
    expect(map).toContain("TODO(security): signature verification is NOT implemented here.");
    expect(map).toContain("This remains a comment even if the outer handler is uncommented");
    expect(map).toContain("catalog name checks do not establish a recipe's origin or integrity");
  });

  it("matches the provider inventory to the generated commented examples", async () => {
    const file = ts.createSourceFile("phantom-wire.ts", sourceText, ts.ScriptTarget.Latest, true);
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
    const rows = [...map.matchAll(/^\| (\w+) \| `([^`]+)` \| `([^`]+)` \| (.+) \|$/gm)];
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
        const warning = stub.indexOf("TODO(security): signature verification is NOT implemented here.");
        const success = stub.indexOf('return new Response("ok", { status: 200 })');
        expect(warning, `${providers[index]} example is missing the verification warning`).toBeGreaterThanOrEqual(0);
        expect(success, `${providers[index]} example is missing the success response`).toBeGreaterThanOrEqual(0);
        expect(warning, `${providers[index]} example returns success before the warning`).toBeLessThan(success);
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  it("describes the TODO in each generated, entirely commented handler", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "comment-context", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        expect(entirelyCommented(stub)).toBe(true);
        for (const line of [
          "//   const body = await req.text();",
          '//   return new Response("ok", { status: 200 });',
        ]) {
          expect(stub).toContain(line);
          expect(entirelyCommented(stub.replace(line, line.slice(2)))).toBe(false);
        }
        const handler = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        expect(handler).toBeDefined();
        if (!handler) throw new Error(`Missing handler in ${path}`);
        const body = handler.indexOf("const body = await req.text();");
        const todo = handler.indexOf("TODO(security): signature verification is NOT implemented here.");
        const reminder = handler.indexOf("Verify over the exact raw body bytes with the webhook secret");
        const success = handler.indexOf('return new Response("ok", { status: 200 })');
        expect(body).toBeGreaterThanOrEqual(0);
        expect(todo).toBeGreaterThan(body);
        expect(reminder).toBeGreaterThan(todo);
        expect(success).toBeGreaterThan(reminder);
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(flat).toContain("Every line of the generated example is commented out.");
      expect(flat).toContain("the TODO remains a comment");
      expect(flat).toContain("any non-empty header reaches the 200");
      expect(flat).toContain("does not retrieve a webhook secret or validate its value");
      for (const [, link] of map.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, mapUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  });
});
