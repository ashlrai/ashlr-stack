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

describe("ai/phantom-wire repeated known placeholder in a provider name", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-repeated-known-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "repeated-known",
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
  ])("carries both occurrences of the repeated token %j to every expansion site", (slot) => {
    // The name is ordinary text carrying the SAME template-slot spelling
    // twice — a repeated known placeholder. Both occurrences are data, not
    // slots: unlike a non-global `.replace`, which would touch only the
    // first, every occurrence must be carried with the name to all five
    // expansion sites (three case-preserving, one first-letter-folded, two
    // whole-name-uppercased), and none may resolve to the value its
    // spelling names — there is no second pass.
    const name = `pre${slot}mid${slot}post`;
    const stub = webhookStubFor(name);

    // The name — both repeats included — lands byte-for-byte at the three
    // case-preserving sites and whole-name uppercased at both secret-key
    // sites. `capitalize` folds only the first letter: `pre` → `Pre`.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handlePre${slot}mid${slot}postWebhook(req: Request)`);
    expect(
      count(
        stub,
        `phantom reveal PRE${slot.toUpperCase()}MID${slot.toUpperCase()}POST_WEBHOOK_SECRET`,
      ),
    ).toBe(2);

    // Census: two repeats per site × five sites = ten `${...}` spans, every
    // one the carried token in that site's case — six exact-case at the
    // case-preserving sites, four uppercased at the reveal sites. None
    // resolved away, none dropped, none duplicated.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(10);
    for (const token of tokens) expect(token.toLowerCase()).toBe(slot.toLowerCase());
    expect(count(stub, slot)).toBe(6);
    expect(count(stub, slot.toUpperCase())).toBe(4);

    // Per-occurrence proof: at every occurrence of the token — both repeats,
    // all sites — the immediate left flank is the name's `pre`/`mid` and the
    // right flank the name's `mid`/`post` (the `$` of the sibling token for
    // the first repeat). Each occurrence received identical carry-through;
    // no occurrence was resolved to a value or reseated next to spliced text.
    for (const [variant, sites] of [
      [slot, 3],
      [slot.toUpperCase(), 2],
    ] as const) {
      const contexts: string[] = [];
      for (let at = stub.indexOf(variant); at !== -1; at = stub.indexOf(variant, at + 1)) {
        const left = stub.slice(at - 3, at);
        const right = stub.slice(at + variant.length, at + variant.length + 4);
        contexts.push(`${left}|${right}`.toLowerCase());
      }
      const expected = Array.from({ length: sites }, () => ["pre|mid$", "mid|post"]).flat();
      expect(contexts.sort()).toEqual(expected.sort());
    }

    // A second pass would have re-resolved each carried token into the whole
    // name again, doubling the flanking text; no flank doubles anywhere.
    expect(stub.match(/pre\$\{[^}]*\}mid\$\{[^}]*\}post/gi)).toHaveLength(5);
    expect(stub).not.toMatch(/prepre|midmid|postpost/i);

    // The sibling slots took their own generic values in the same single
    // pass — the repeated token never reached their switch cases either.
    expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
    expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it("emits a repeated `${provider}` token at the name's edges literally at all five sites — line-for-line", () => {
    // The sharpest form: the repeated token spells the name slot itself and
    // sits at BOTH edges of the name, so at the name sites the emitted text
    // is indistinguishable from unfilled slots — and `capitalize`'s fold of
    // the first code point lands on `$`, which uppercases to itself. Exact
    // lines pin every site: both repeats arrived verbatim, once each.
    const name = "${provider}and${provider}";
    const stub = webhookStubFor(name);

    expect(stub).toContain(
      "// Auto-generated by `stack apply` — webhook handler stub for ${provider}and${provider}.\n",
    );
    expect(stub).toContain("//   phantom reveal ${PROVIDER}AND${PROVIDER}_WEBHOOK_SECRET");
    expect(stub).toContain(
      "// export async function handle${provider}and${provider}Webhook(req: Request): Promise<Response> {",
    );
    expect(stub).toContain(
      "//   // to this endpoint can forge a ${provider}and${provider} webhook.",
    );
    expect(stub).toContain(
      "//   // (`phantom reveal ${PROVIDER}AND${PROVIDER}_WEBHOOK_SECRET`) and compare in",
    );

    // Census: ten `${...}` spans — both repeats at each site, in site order:
    // title, reveal, handler, forge (all case-preserving), reveal (folded).
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toEqual([
      "${provider}",
      "${provider}",
      "${PROVIDER}",
      "${PROVIDER}",
      "${provider}",
      "${provider}",
      "${provider}",
      "${provider}",
      "${PROVIDER}",
      "${PROVIDER}",
    ]);
    expect(count(stub, "${provider}")).toBe(6);
    expect(count(stub, "${PROVIDER}")).toBe(4);

    // No re-expansion: a second pass would splice the name into each carried
    // token again, producing `and${provider}and` chains; the `and` flank
    // stays single everywhere.
    expect(stub.match(/\$\{provider\}and\$\{provider\}/g)).toHaveLength(3);
    expect(stub.match(/\$\{PROVIDER\}AND\$\{PROVIDER\}/g)).toHaveLength(2);
    expect(stub).not.toMatch(/andand/i);

    // Sibling slots resolved to their own values, once each.
    expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
    expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
  });

  it("carries three repeats of the same known token — every occurrence at every site", () => {
    // Repeat count generalizes: three occurrences of the same slot spelling
    // each ride along as data — fifteen spans total, nine exact-case, six
    // folded — and every occurrence sits between the name's own flanks.
    const slot = "${signatureHeaderFor(provider)}";
    const name = `a${slot}b${slot}c${slot}d`;
    const stub = webhookStubFor(name);

    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handleA${slot}b${slot}c${slot}dWebhook(req: Request)`);
    expect(
      count(
        stub,
        `phantom reveal A${slot.toUpperCase()}B${slot.toUpperCase()}C${slot.toUpperCase()}D_WEBHOOK_SECRET`,
      ),
    ).toBe(2);

    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(15);
    for (const token of tokens) expect(token.toLowerCase()).toBe(slot.toLowerCase());
    expect(count(stub, slot)).toBe(9);
    expect(count(stub, slot.toUpperCase())).toBe(6);

    // Every occurrence is flanked by the letters the name supplied — `a|b`,
    // `b|c`, `c|d` in order — three of each per case-preserving site, two of
    // each per folded site. None resolved, reordered, or reseated.
    for (const [variant, sites] of [
      [slot, 3],
      [slot.toUpperCase(), 2],
    ] as const) {
      const contexts: string[] = [];
      for (let at = stub.indexOf(variant); at !== -1; at = stub.indexOf(variant, at + 1)) {
        const left = stub.slice(at - 1, at);
        const right = stub.slice(at + variant.length, at + variant.length + 1);
        contexts.push(`${left}|${right}`.toLowerCase());
      }
      const expected = Array.from({ length: sites }, () => ["a|b", "b|c", "c|d"]).flat();
      expect(contexts.sort()).toEqual(expected.sort());
    }

    // A second pass would have re-resolved each carried token into the whole
    // name again, minting extra spans and doubling the flanks; the complete
    // a<tok>b<tok>c<tok>d shape appears exactly once per site and the census
    // above already counted every `${...}` span there is.
    expect(stub.match(/a\$\{[^}]*\}b\$\{[^}]*\}c\$\{[^}]*\}d/gi)).toHaveLength(5);
  });

  it("skips a repeated-placeholder name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the repeated-token name matches no
    // catalog provider: it returns in `skipped` byte-for-byte — both
    // occurrences intact — gets no stub on disk, and provokes no vault
    // write. The known provider listed beside it wires normally, unaffected
    // by the placeholder-shaped neighbour.
    const name = "pre${provider}mid${provider}post";
    const stubPath = join(dir, ".stack", "webhooks", "github.ts");
    const result = await wirePhantomForRecipe(recipe(name, "github"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["github:GITHUB_TOKEN"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only github's documented stub lands — nothing for the repeated-token
    // name, and the stub on disk is the same render `webhookStubFor`
    // returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["github.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("github"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});

    // The hint is a fixed string: a repeated-token name never leaks into it.
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });
});
