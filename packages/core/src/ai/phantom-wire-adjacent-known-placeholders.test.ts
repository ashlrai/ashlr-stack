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

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("ai/phantom-wire adjacent known placeholders in a provider name", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-adjacent-known-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "adjacent-known",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each([
    "${provider}${signatureHeaderFor(provider)}", // pair is the whole name
    "${signatureHeaderFor(provider)}${provider}", // reversed order
    "pay${capitalize(provider)}${webhookSecretKeyFor(provider)}ment", // pair mid-name
    "hook${verificationHintFor(provider)}${provider}line", // hint slot beside the name slot
    "${capitalize(provider)}${signatureHeaderFor(provider)}hook", // pair leads the name
    "pay${webhookSecretKeyFor(provider)}${verificationHintFor(provider)}", // pair ends the name
  ])("keeps the adjacent pair %j flush and in order at every expansion site", (name) => {
    // Each token in the pair spells one of the template's own slots — both
    // are known placeholders — but arriving inside the name they are data.
    // They must land at all five expansion sites flush against each other,
    // in the order the name gave them: nothing spliced between the first
    // token's `}` and the second's `${`, neither token resolved to the value
    // its spelling names, neither reordered.
    const stub = webhookStubFor(name);
    const pair = name.match(/\$\{[^}]*\}\$\{[^}]*\}/)?.[0] as string;
    const first = pair.match(/^\$\{[^}]*\}/)?.[0] as string;
    const second = pair.slice(first.length);

    // The name — pair included — lands byte-for-byte at the three
    // case-preserving sites and whole-name uppercased at both secret-key
    // sites. `capitalize` folds only a leading letter; a `$`-led name is
    // carried unchanged.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handle${name[0].toUpperCase()}${name.slice(1)}Webhook(req: Request)`);
    expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

    // Both values appear in order without extra characters: the flush pair
    // occurs exact-case at the three mixed-case sites and uppercased
    // together at the two secret-key sites — and at each occurrence the
    // second token starts on the very next byte after the first ends.
    for (const [variant, sites] of [
      [pair, 3],
      [pair.toUpperCase(), 2],
    ] as const) {
      const f = variant === pair ? first : first.toUpperCase();
      const s = variant === pair ? second : second.toUpperCase();
      let occurrences = 0;
      for (let at = stub.indexOf(variant); at !== -1; at = stub.indexOf(variant, at + 1)) {
        occurrences++;
        expect(stub.startsWith(f, at)).toBe(true);
        // Zero bytes between the two values: second begins exactly where
        // first ends — no separator inserted, no byte of either eaten.
        expect(stub.startsWith(s, at + f.length)).toBe(true);
      }
      expect(occurrences).toBe(sites);
    }
    // The pair never lands transposed, in either casing.
    expect(stub).not.toContain(second + first);
    expect(stub).not.toContain(second.toUpperCase() + first.toUpperCase());

    // Two tokens per name × five sites: no `${` minted, dropped, or
    // re-expanded into the value its spelling names.
    expect(count(stub, "${")).toBe(10);
    // The template's real slots still take their own known values, once
    // each — the generic signature header at its own site, the fallback
    // hint at its own — never re-spliced into a name site.
    expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
    expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
    expect(stub).not.toContain("WEBHOOK_SECRET_WEBHOOK_SECRET");
  });

  it("keeps a three-token run flush and in order at every expansion site", () => {
    // Adjacency generalizes: three known spellings back-to-back inside the
    // name. The run is data — each site's expansion emits all three tokens
    // in the name's order, the next starting on the byte the previous ends,
    // with no inserted separator and the middle token neither dropped nor
    // reseated.
    const t1 = "${provider}";
    const t2 = "${capitalize(provider)}";
    const t3 = "${signatureHeaderFor(provider)}";
    const name = `${t1}${t2}${t3}trail`;
    const run = t1 + t2 + t3;
    const stub = webhookStubFor(name);

    // The name — run included — lands byte-for-byte at the three
    // case-preserving sites and whole-name uppercased at both secret-key
    // sites. `capitalize` leaves the `$`-led name unchanged.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handle${name}Webhook(req: Request)`);
    expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

    // At every occurrence, in both casings: the three values sit in the
    // name's order, each starting on the byte the previous one ends.
    for (const [variant, sites] of [
      [run, 3],
      [run.toUpperCase(), 2],
    ] as const) {
      const [a, b, c] =
        variant === run ? [t1, t2, t3] : [t1.toUpperCase(), t2.toUpperCase(), t3.toUpperCase()];
      let occurrences = 0;
      for (let at = stub.indexOf(variant); at !== -1; at = stub.indexOf(variant, at + 1)) {
        occurrences++;
        expect(stub.startsWith(a, at)).toBe(true);
        // Zero bytes between values: b begins exactly where a ends, c
        // exactly where b ends — no separator inserted, no byte eaten.
        expect(stub.startsWith(b, at + a.length)).toBe(true);
        expect(stub.startsWith(c, at + a.length + b.length)).toBe(true);
      }
      expect(occurrences).toBe(sites);
    }

    // No reordering: neither adjacent swap nor the reversed run appears,
    // in either casing.
    for (const swapped of [t2 + t1, t3 + t2, t3 + t2 + t1]) {
      expect(stub).not.toContain(swapped);
      expect(stub).not.toContain(swapped.toUpperCase());
    }

    // Three tokens per name × five sites: no `${` minted, dropped, or
    // re-expanded into the value its spelling names.
    expect(count(stub, "${")).toBe(15);
    // The template's real slots still take their own values, once each.
    expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
    expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
  });

  it("skips a pair-carrying name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the name matches no catalog provider:
    // it returns in `skipped` byte-for-byte — both tokens and their flush
    // adjacency intact — gets no stub on disk, and provokes no vault write.
    // The known provider listed beside it wires normally.
    const name = "pay${capitalize(provider)}${webhookSecretKeyFor(provider)}ment";
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");
    const result = await wirePhantomForRecipe(recipe(name, "stripe"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only stripe's documented stub lands — nothing for the pair-carrying
    // name, and the stub on disk is the same render `webhookStubFor`
    // returns, fully substituted.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["stripe.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("stripe"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});

    // The hint is a fixed string: a pair-carrying name never leaks into it.
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });
});
