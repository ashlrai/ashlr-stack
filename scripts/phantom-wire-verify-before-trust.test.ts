import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const PROVIDERS: Array<[provider: string, header: string, handler: string]> = [
  ["stripe", "stripe-signature", "handleStripeWebhook"],
  ["clerk", "svix-signature", "handleClerkWebhook"],
  ["supabase", "x-supabase-signature", "handleSupabaseWebhook"],
  ["github", "x-hub-signature-256", "handleGithubWebhook"],
];

describe("Phantom wire webhook example", () => {
  it("requires signature verification before trusting the body", async () => {
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "verify-before-trust",
          query: "",
          createdAt: "",
          providers: PROVIDERS.map(([name]) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(PROVIDERS.length);

      const examples: Array<{ provider: string; header: string; path: string }> = [];
      for (const [index, [provider, header, handlerName]] of PROVIDERS.entries()) {
        const stub = readFileSync(result.webhooks[index], "utf8");
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!example) throw new Error(`Missing ${provider} webhook example`);

        // The complete executable surface of the uncommented example is five
        // statements: capture the signature header, reject when it is absent,
        // capture the raw body, return a static "ok". A regression that
        // trusts the body early (parse, branch, reflect, dispatch) or quietly
        // implements verification would add a sixth statement and fail here.
        const runnable = example.replace(/^\/\/ ?/gm, "");
        const executable = runnable
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("//"));
        expect(executable).toEqual([
          `export async function ${handlerName}(req: Request): Promise<Response> {`,
          `const signature = req.headers.get("${header}");`,
          'if (!signature) return new Response("Missing signature", { status: 400 });',
          "const body = await req.text();",
          'return new Response("ok", { status: 200 });',
          "}",
        ]);

        // Between the body capture and the success response there is no code
        // at all — only the reminder that signature verification is required
        // first, and only then may the body be parsed, trusted, or acted on.
        const gate = runnable.slice(
          runnable.indexOf("const body = await req.text();"),
          runnable.indexOf('return new Response("ok", { status: 200 });'),
        );
        expect(gate).toContain(
          "TODO(security): signature verification is NOT implemented here.",
        );
        expect(gate).toContain("unauthenticated, attacker-controlled input");
        expect(gate).toContain("reject missing or invalid signatures, and only then");
        expect(gate).toContain("parse, trust, or act on the body");

        const examplePath = join(harness.dir, `${provider}-verify-before-trust.ts`);
        writeFileSync(examplePath, runnable);
        examples.push({ provider, header, path: examplePath });
      }

      // Run each uncommented example. Without the signature header it
      // returns 400 before the body is read; with any non-empty header the
      // body is read but never trusted — malformed JSON and a forged,
      // well-formed event both get the same static "ok".
      for (const { provider, header, path } of examples) {
        const handlerName = `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`;
        const handler: unknown = (await import(path))[handlerName];
        if (typeof handler !== "function") throw new Error(`Missing ${handlerName}`);

        const unsigned = new Request("https://example.com", { method: "POST", body: "{}" });
        const rejected: Response = await handler(unsigned);
        expect(rejected.status).toBe(400);
        expect(unsigned.bodyUsed).toBe(false);

        for (const body of [
          "not json {{{",
          JSON.stringify({ type: "charge.succeeded", data: { forged: true } }),
        ]) {
          const request = new Request("https://example.com", {
            method: "POST",
            headers: { [header]: "t=1,v1=forged" },
            body,
          });
          const response: Response = await handler(request);
          expect(response.status).toBe(200);
          expect(await response.text()).toBe("ok");
        }
      }

      // Wiring satisfies the example's requirements by inspection only: it
      // never reveals the webhook secret and never writes to the vault.
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
