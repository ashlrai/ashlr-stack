import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readVault, setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

test.each([
  [{}, [], ["openai:OPENAI_API_KEY", "stripe:STRIPE_SECRET_KEY"]],
  [
    { OPENAI_API_KEY: "existing-test-value" },
    ["openai:OPENAI_API_KEY"],
    ["stripe:STRIPE_SECRET_KEY"],
  ],
])(
  "apply wiring never tries placeholder writes with inventory %j",
  async (initial, present, missing) => {
    const phantom = setupFakePhantom(initial);
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "placeholder-regression",
          query: "ai and payments",
          createdAt: "2026-10-17T00:00:00.000Z",
          providers: [{ name: "openai" }, { name: "stripe" }],
        },
        { cwd: phantom.dir },
      );

      expect(result.present).toEqual(present);
      expect(result.missing).toEqual(missing);
      expect(result.skipped).toEqual([]);
      expect(result.webhooks).toEqual([join(phantom.dir, ".stack/webhooks/stripe.ts")]);
      expect(existsSync(result.webhooks[0])).toBe(true);
      expect(phantom.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
      // Catch both the old --rotate attempt and its fallback, even if Phantom
      // rejects them and leaves the vault unchanged.
      expect(phantom.callsTo("add")).toEqual([]);
      expect(phantom.calls().flatMap((call) => call.args)).not.toContain("TODO_STACK_APPLY");
      expect(await readVault(phantom.dir)).toEqual(initial);
    } finally {
      phantom.cleanup();
    }
  },
  30_000,
);
