import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { webhookStubFor, wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-caveats.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");
const signatureWarning = "TODO(security): signature verification is NOT implemented here.";

// Folded in from the former phantom-wire-example-trust doc and test.
function assertExampleWarning(provider: string, example: string): void {
  if (!example.includes(signatureWarning)) {
    throw new Error(`${provider} example is missing the signature-verification warning`);
  }
}

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

  it("identifies an example missing its signature-verification warning", () => {
    expect(() => assertExampleWarning("stripe", "// export async function handler() {}"))
      .toThrow("stripe example is missing the signature-verification warning");
  });

  it("places the verification reminder before the success response in each stub", () => {
    for (const provider of ["stripe", "clerk", "supabase", "github"]) {
      const stub = webhookStubFor(provider);
      const reminder = stub.indexOf(signatureWarning);
      const success = stub.indexOf('return new Response("ok", { status: 200 })');
      expect(reminder, `${provider} stub is missing the verification reminder`).toBeGreaterThanOrEqual(0);
      expect(success, `${provider} stub is missing the success response`).toBeGreaterThanOrEqual(0);
      expect(reminder, `${provider} stub returns success before warning about verification`).toBeLessThan(success);
    }
  });

  it("describes the trust behavior of each generated example", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "trust", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      const docText = doc.replace(/\s+/g, " ");
      expect(docText).toContain("illustrative guidance, not implemented verification");
      expect(docText).toContain("No secret is retrieved and no signature is checked.");
      expect(docText).toContain("the secret named in the stub may differ from the catalog names");
      expect(doc).toContain("any non-empty");
      expect(doc).toContain("Recipe manifests have a separate limitation: they are unsigned");
      expect(existsSync(new URL("../packages/core/src/ai/phantom-wire.ts", docUrl))).toBe(true);
      expect(doc).toContain("../packages/core/src/ai/phantom-wire.ts");

      const examples = providers.map((provider, index) => {
        const stub = readFileSync(result.webhooks[index], "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub).toContain(signatureWarning);
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!header || !example) throw new Error(`Incomplete ${provider} example`);
        assertExampleWarning(provider, example);
        const path = join(harness.dir, `${provider}-trust-example.ts`);
        writeFileSync(path, example.replace(/^\/\/ ?/gm, ""));
        return { provider, header, path };
      });
      for (const { provider, header, path } of examples) {
        const exports = await import(path);
        const handler = exports[`handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`];
        expect(typeof handler).toBe("function");
        const missing = new Request("https://example.com", { method: "POST", body: "payload" });
        expect((await handler(missing)).status).toBe(400);
        expect(missing.bodyUsed).toBe(false);
        for (const body of ["payload", "altered"]) {
          const request = new Request("https://example.com", {
            method: "POST",
            headers: { [header]: "forged" },
            body,
          });
          expect((await handler(request)).status).toBe(200);
        }
      }
      expect(harness.callsTo("reveal")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
