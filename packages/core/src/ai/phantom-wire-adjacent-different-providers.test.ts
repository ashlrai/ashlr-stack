import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { verificationHintFor, webhookStubFor, wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

setDefaultTimeout(30_000);

// Each known provider's own values for the stub's placeholders.
const OWN = {
  stripe: { header: "stripe-signature", secret: "STRIPE_WEBHOOK_SECRET", cap: "Stripe" },
  clerk: { header: "svix-signature", secret: "CLERK_WEBHOOK_SECRET", cap: "Clerk" },
  supabase: { header: "x-supabase-signature", secret: "SUPABASE_WEBHOOK_SECRET", cap: "Supabase" },
  github: { header: "x-hub-signature-256", secret: "GITHUB_WEBHOOK_SECRET", cap: "Github" },
} as const;
type Known = keyof typeof OWN;
const KNOWN = Object.keys(OWN) as Known[];

/** Assert a stub carries this provider's values and none of the others'. */
function expectOwnValuesOnly(stub: string, provider: Known) {
  const own = OWN[provider];
  expect(stub).toContain(`webhook handler stub for ${provider}.`);
  expect(stub).toContain(`export async function handle${own.cap}Webhook(`);
  expect(stub).toContain(`req.headers.get("${own.header}")`);
  expect(stub).toContain(verificationHintFor(provider));
  expect(stub.split(`phantom reveal ${own.secret}`).length - 1).toBe(2);
  for (const other of KNOWN.filter((k) => k !== provider)) {
    expect(stub).not.toContain(OWN[other].header);
    expect(stub).not.toContain(OWN[other].secret);
    expect(stub).not.toContain(`handle${OWN[other].cap}Webhook`);
    expect(stub).not.toContain(verificationHintFor(other));
  }
}

describe("ai/phantom-wire adjacent different known providers", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-adjacent-different-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(KNOWN)("renders %s with only its own values", (provider) => {
    expectOwnValuesOnly(webhookStubFor(provider), provider);
  });

  it("gives each adjacent provider its own stub, secrets and result slot, in order", async () => {
    const recipe: Recipe = {
      id: "adjacent-different",
      query: "q",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: KNOWN.map((name) => ({ name })),
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: dir });

    // Webhook paths follow recipe order, one per provider.
    expect(result.webhooks).toEqual(KNOWN.map((p) => join(dir, ".stack", "webhooks", `${p}.ts`)));
    // Every reported secret is prefixed by its own provider, grouped in order.
    const order = [...result.present, ...result.missing].map((e) => e.split(":")[0]);
    const firstSeen = [...new Set(order)];
    expect(firstSeen).toEqual(KNOWN.filter((p) => firstSeen.includes(p)));
    expect(result.skipped).toEqual([]);

    // Each file on disk carries its own provider's values only.
    for (const [i, provider] of KNOWN.entries()) {
      expectOwnValuesOnly(readFileSync(result.webhooks[i] as string, "utf-8"), provider);
    }
    // Wiring only reads the vault.
    expect(harness.callsTo("add")).toEqual([]);
  });
});
