import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const doc = readFileSync(new URL("../docs/phantom-wire-data-flow.md", import.meta.url), "utf8");

describe("Phantom wire data flow", () => {
  it("reads the example body before returning success", async () => {
    const harness = setupFakePhantom({});
    try {
      const result = await wirePhantomForRecipe(
        { id: "body-order", query: "", createdAt: "", providers: [{ name: "stripe" }] },
        { cwd: harness.dir },
      );
      const stub = readFileSync(result.webhooks[0]!, "utf8");
      const body = stub.indexOf("const body = await req.text();");
      const success = stub.indexOf("status: 200");
      expect(body).toBeGreaterThanOrEqual(0);
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
});
