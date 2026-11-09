import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-outputs.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");
const applySource = readFileSync(
  new URL("../packages/cli/src/commands/apply.ts", import.meta.url),
  "utf8",
);

describe("Phantom wire example outputs", () => {
  it("generates identical reminder text when the same recipe is wired twice", async () => {
    const harness = setupFakePhantom({});
    try {
      const recipe = {
        id: "repeat-outputs",
        query: "",
        createdAt: "",
        providers: ["stripe", "clerk", "supabase", "github"].map((name) => ({ name })),
      };
      const first = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      expect(first.webhooks).toHaveLength(recipe.providers.length);
      const reminders = first.webhooks.map((path) => readFileSync(path, "utf8"));

      const second = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      expect(second.webhooks).toEqual(first.webhooks);
      expect(second.webhooks.map((path) => readFileSync(path, "utf8"))).toEqual(reminders);
    } finally {
      harness.cleanup();
    }
  });

  it("keeps the documented outputs aligned with the wiring result and generated examples", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom({ STRIPE_SECRET_KEY: "test-value" });
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "outputs",
          query: "",
          createdAt: "",
          providers: [...providers, "neon", "unknown"].map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );

      // Every WireResult field the doc describes is a real output.
      expect(result.present).toEqual(["stripe:STRIPE_SECRET_KEY"]);
      expect(result.skipped).toEqual(["unknown"]);
      expect(result.webhooks).toHaveLength(providers.length);
      expect(result.missing).toContain("github:GITHUB_TOKEN");
      expect(result.missing).toContain("neon:NEON_API_KEY");
      for (const field of ["`present`", "`missing`", "`webhooks`", "`skipped`"]) {
        expect(doc).toContain(field);
      }
      // The doc's printed-summary example names a genuinely missing secret.
      expect(doc).toContain("not in Phantom: GITHUB_TOKEN");

      // The doc's summary lines quote real CLI output from apply.ts.
      expect(doc).toContain("secrets in vault");
      expect(doc).toContain("not in Phantom:");
      expect(doc).toContain("phantom-wire skipped:");
      expect(doc).toContain("phantom-wire failed");
      for (const line of ["secrets in vault", "not in Phantom:", "phantom-wire skipped:"]) {
        expect(applySource).toContain(line);
      }
      expect(applySource).toContain("phantom-wire failed:");

      // The doc documents the trust boundary without claiming verification.
      expect(doc).toContain("TODO(security): signature verification is NOT implemented here.");
      expect(doc).toContain("signature verification is not implemented");
      expect(doc).toContain("Recipe manifests are unsigned");
      expect(doc).not.toMatch(
        /signature verified|verified signature|request is authenticated|signature verification is implemented/i,
      );

      // The observable responses the doc tabulates are the example's real ones.
      expect(doc).toContain("`Missing signature`, status 400");
      expect(doc).toContain("`ok`, status 200");
      const examples: Array<{ provider: string; header: string; path: string }> = [];
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

        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!example || !header) throw new Error(`Missing ${provider} webhook example`);
        const path = join(harness.dir, `${provider}-outputs-example.ts`);
        // Write every runnable file before importing any: Bun resolves dynamic
        // imports only for paths that exist when the first import runs.
        writeFileSync(path, example.replace(/^\/\/ ?/gm, ""));
        examples.push({ provider, header, path });
      }
      for (const { provider, header, path } of examples) {
        const exports = await import(path);
        const handler: unknown =
          exports[`handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`];
        if (typeof handler !== "function") throw new Error(`Missing ${provider} handler`);

        // Missing/empty header: 400 before the body is read.
        const empty = new Request("https://example.com", { method: "POST", body: "payload" });
        expect((await handler(empty)).status).toBe(400);
        expect(empty.bodyUsed).toBe(false);

        // Non-empty header: 200 after the body read — no comparison ran.
        const forged = new Request("https://example.com", {
          method: "POST",
          headers: { [header]: "forged" },
          body: "payload",
        });
        expect((await handler(forged)).status).toBe(200);

        // Failed body read: the handler rejects with no Response.
        const broken = new Request("https://example.com", {
          method: "POST",
          headers: { [header]: "forged" },
          body: new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new Error("connection lost"));
            },
          }),
        });
        await expect(handler(broken)).rejects.toBeDefined();
      }

      // Wiring observed names only: no secret was stored or retrieved.
      expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
      expect(harness.callsTo("add")).toEqual([]);
      expect(harness.callsTo("reveal")).toEqual([]);

      for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, docUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  });
});
