import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { verificationHintFor, webhookStubFor, wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// The wiring check spawns the fake `phantom` shim (bash + python3); keep the
// sibling files' raised timeout.
setDefaultTimeout(30_000);

describe("ai/phantom-wire known placeholder as the entire template", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-known-placeholder-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "known-placeholder",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each([
    "${provider}", // the name slot's own spelling
    "${capitalize(provider)}", // the handler-name slot's spelling
    "${webhookSecretKeyFor(provider)}", // the secret-key slot's spelling
    "${signatureHeaderFor(provider)}", // the header slot's spelling
    "${verificationHintFor(provider)}", // the hint slot's spelling
  ])("emits the replacement value itself at every site for the whole-name token %j", (name) => {
    // The name is exactly one of the template's slot spellings — the
    // placeholder is the entire input, with no ordinary text around it.
    // At each expansion site the emitted output equals the replacement
    // value (the name, in that site's case); the token-shaped value is
    // never fed back through the slots — a second pass would erase or
    // rewrite it, and none runs.
    const stub = webhookStubFor(name);

    // Case-preserving sites: the output is the replacement value
    // byte-for-byte. `capitalize` folds only the first code point, and
    // `$` uppercases to itself, so the handler site is identical too.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handle${name}Webhook(req: Request)`);
    // Both `toUpperCase()` secret-key sites hold the whole-name-uppercased
    // value — the fold happens inside the replacement, proof the value was
    // substituted (an unresolved slot would sit in template case).
    expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

    // Five `${...}` spans — one per expansion site — and every one is the
    // carried token in that site's case, none resolved away or duplicated.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(5);
    for (const token of tokens) expect(token.toLowerCase()).toBe(name.toLowerCase());

    // The remaining slots took their own values in the same single pass:
    // the generic signature header and the fallback hint — the carried
    // token never reached their switch cases either.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it.each([
    ["stripe", "Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance."],
    ["clerk", "Clerk (svix): `new Webhook(secret).verify(body, headers)`."],
    ["supabase", "Supabase: `x-supabase-signature` per Supabase's documented webhook scheme."],
    [
      "github",
      "GitHub: `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body.",
    ],
  ])("renders the %s hint slot as exactly its replacement value", (provider, hint) => {
    // A known provider name is the whole template of the hint slot: the
    // render is exactly the fixed replacement — no wrapper, no leftover
    // `${...}` — and the stub carries that value once, on the TODO line.
    expect(verificationHintFor(provider)).toBe(hint);
    const stub = webhookStubFor(provider);
    expect(stub.split(`//   // ${hint}\n`).length - 1).toBe(1);
    expect(stub).not.toContain("${");
  });

  it("emits the name where the `${provider}` slot stood — output equals the value it resolved to", () => {
    // The name spells the `provider` slot itself, so at the name sites the
    // emitted text is indistinguishable from an unfilled slot. The proof
    // the output is the *replacement value* and not a skipped slot: the
    // two reveal sites carry `${PROVIDER}` — the value uppercased, work
    // only the substitution path does — while the sibling slots resolved
    // to their own real values. A recursive pass would have re-resolved
    // the carried `${provider}` into something else; every occurrence
    // stays the literal value.
    const name = "${provider}";
    const stub = webhookStubFor(name);

    // The slot's replacement IS the name: at all three name sites the
    // rendered text equals the value that was passed in.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`handle${name}Webhook(req: Request)`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub.split("${provider}").length - 1).toBe(3);
    // Folded at the reveal sites — substituted, not left raw. The folded
    // token appears exactly twice, each time inside a `phantom reveal` line.
    expect(stub.split("phantom reveal ${PROVIDER}_WEBHOOK_SECRET").length - 1).toBe(2);
    expect(stub.split("${PROVIDER}").length - 1).toBe(2);

    // Single pass: the header and hint slots took real values; the carried
    // `${provider}` token was never offered back to any slot.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toEqual([
      "${provider}",
      "${PROVIDER}",
      "${provider}",
      "${provider}",
      "${PROVIDER}",
    ]);
  });

  it("skips a whole-name known-placeholder token byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the slot-spelling name matches no
    // catalog provider: it returns in `skipped` byte-for-byte — the entire
    // token intact — gets no stub on disk, and provokes no vault write.
    // The known provider listed beside it wires normally, unaffected by
    // the placeholder-shaped neighbour.
    const name = "${webhookSecretKeyFor(provider)}";
    const stubPath = join(dir, ".stack", "webhooks", "clerk.ts");
    const result = await wirePhantomForRecipe(recipe(name, "clerk"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["clerk:CLERK_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only clerk's documented stub lands — nothing for the placeholder
    // name, and the stub on disk is the same render `webhookStubFor`
    // returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["clerk.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("clerk"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });
});
