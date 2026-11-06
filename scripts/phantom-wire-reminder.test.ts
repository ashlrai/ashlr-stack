import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

describe("generated webhook signature-verification reminder", () => {
  it("keeps the reminder inside every commented handler before any body-dependent action", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "reminder-order",
          query: "",
          createdAt: "",
          providers: providers.map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);

      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!example) throw new Error(`Missing commented handler in ${path}`);
        expect(example.split("\n").every((line) => line.startsWith("//"))).toBe(true);

        const runnable = example.replace(/^\/\/ ?/gm, "");
        const bodyRead = "const body = await req.text();";
        const todo = "// TODO(security): signature verification is NOT implemented here.";
        const reminder = "// parse, trust, or act on the body.";
        const success = 'return new Response("ok", { status: 200 });';
        const bodyEnd = runnable.indexOf(bodyRead) + bodyRead.length;
        const todoStart = runnable.indexOf(todo);
        const reminderEnd = runnable.indexOf(reminder) + reminder.length;
        const successStart = runnable.indexOf(success);
        expect(runnable.indexOf(bodyRead)).toBeGreaterThanOrEqual(0);
        expect(todoStart).toBeGreaterThanOrEqual(bodyEnd);
        expect(runnable.indexOf(reminder)).toBeGreaterThan(todoStart);
        expect(successStart).toBeGreaterThanOrEqual(reminderEnd);

        // Once uncommented, nothing executable may run between reading the
        // untrusted body and the end of the verification reminder.
        const intervening = runnable.slice(bodyEnd, reminderEnd).split("\n");
        expect(intervening.every((line) => !line.trim() || line.trimStart().startsWith("//"))).toBe(
          true,
        );
      }
    } finally {
      harness.cleanup();
    }
  });

  it.each(["available", "unavailable"])("survives Phantom being %s", async (availability) => {
    const providers = [
      ["stripe", "stripe.webhooks.constructEvent"],
      ["clerk", "new Webhook(secret).verify(body, headers)"],
      ["supabase", "x-supabase-signature"],
      ["github", "x-hub-signature-256"],
    ];
    const harness = setupFakePhantom();
    try {
      if (availability === "unavailable") {
        writeFileSync(join(harness.dir, "phantom"), "#!/usr/bin/env bash\nexit 1\n");
      }
      const result = await wirePhantomForRecipe(
        {
          id: "reminder",
          query: "",
          createdAt: "",
          providers: providers.map(([name]) => ({ name })),
        },
        { cwd: harness.dir },
      );

      expect(result.webhooks).toEqual(
        providers.map(([name]) => join(harness.dir, ".stack/webhooks", `${name}.ts`)),
      );
      for (const [index, [provider, hint]] of providers.entries()) {
        const stub = readFileSync(result.webhooks[index], "utf-8");
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!example) throw new Error(`Missing ${provider} webhook example`);

        expect(example.split("\n").every((line) => line.startsWith("//"))).toBe(true);
        expect(example).toContain("//   // TODO(security): signature verification is NOT implemented here.");
        expect(example).toContain("unauthenticated, attacker-controlled input");
        expect(example).toContain(`forge a ${provider} webhook`);
        expect(example).toContain(hint);

        // The instruction must remain in the handler after the raw body is
        // read and before the success response, including after uncommenting.
        const runnable = example.replace(/^\/\/ ?/gm, "");
        const bodyRead = runnable.indexOf("const body = await req.text();");
        const success = runnable.indexOf('return new Response("ok", { status: 200 });');
        expect(bodyRead).toBeGreaterThanOrEqual(0);
        expect(success).toBeGreaterThan(bodyRead);
        const reminder = runnable.slice(bodyRead, success);
        expect(reminder).toContain(
          "// Verify over the exact raw body bytes with the webhook secret\n" +
            `  // (\`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET\`) and compare in\n` +
            "  // constant time; reject missing or invalid signatures, and only then\n" +
            "  // parse, trust, or act on the body.",
        );
      }
    } finally {
      harness.cleanup();
    }
  });
});
