import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { webhookStubFor, wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-caveats.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire example caveats", () => {
  it("keeps the caveats and provider table aligned with the generated examples", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "caveats", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      expect(doc).toContain("signature verification is NOT implemented here.");
      expect(doc).toContain("any non-empty value");
      expect(doc).toContain("Recipe manifests have a separate limitation: they are unsigned");

      for (const [index, provider] of providers.entries()) {
        const stub = readFileSync(result.webhooks[index], "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const secret = stub.match(/phantom reveal ([A-Z_]+)/)?.[1];
        expect(header).toBeDefined();
        expect(secret).toBeDefined();
        const row = doc.split("\n").find((line) => line.toLowerCase().startsWith(`| ${provider} |`));
        expect(row).toContain(`\`${header}\` | \`${secret}\``);
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
      for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, docUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  });

  it("quotes the security reminder exactly as the generated stub words it", () => {
    const flat = (text: string) =>
      text
        .split("\n")
        .map((line) => line.replace(/^\s*\/\/ ?/, ""))
        .join(" ")
        .replace(/\s+/g, " ");
    const docText = doc.replace(/\s+/g, " ");
    for (const provider of ["stripe", "clerk", "supabase", "github"]) {
      const stub = flat(webhookStubFor(provider));
      // The reminder sentence the doc quotes is taken from the generated stub, not hardcoded.
      const todo = stub.match(/TODO\(security\): [^.]+\./)?.[0];
      expect(todo).toBeDefined();
      expect(docText).toContain(todo as string);
      // The stub's behavior claims: any non-empty header reaches 200, nothing authenticated.
      expect(stub).toContain("accepts any non-empty signature header and returns 200 without authenticating");
      expect(stub).toContain("does not verify signatures");
      expect(stub).toContain("attacker-controlled");
      expect(docText).toContain("any non-empty value for the expected header reaches the 200 response");
      expect(docText).toContain("neither sender nor payload is authenticated");
      expect(docText).toContain("attacker-controlled");
      expect(docText).toContain("Do not deploy or act on this example as-is.");
    }
  });
});
