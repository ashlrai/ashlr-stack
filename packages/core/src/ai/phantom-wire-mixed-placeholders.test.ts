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

// A `${...}` token that spells none of the template's slots. Already
// uppercase, so even the `toUpperCase()` secret-key sites hold identical
// bytes — any difference it shows is the renderer's, not the fold's.
const UNKNOWN = "${HOOK_URL}";

describe("ai/phantom-wire a name mixing a known and an unknown placeholder", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-mixed-placeholders-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "mixed-placeholders",
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
  ])(
    "expands every known slot to the name while the unknown token in it stays literal: %j",
    (slot) => {
      // The name carries two `${...}` tokens separated by ordinary text:
      // one spelling a real template slot (a known placeholder), one
      // spelling nothing (unknown). The template's known placeholders
      // still expand — each slot emits the whole name once — while both
      // tokens inside the emitted name arrive unchanged: the known one is
      // never offered a second pass, and the unknown one has no expansion
      // to begin with.
      const name = `pre${slot}mid${UNKNOWN}post`;
      const stub = webhookStubFor(name);

      // The `${provider}` and `${capitalize(provider)}` slots expanded to
      // the full name — both tokens included — byte-for-byte at the three
      // case-preserving sites; `capitalize` folds only the leading `p`.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handlePre${slot}mid${UNKNOWN}postWebhook(req: Request)`);
      // The `webhookSecretKeyFor(provider)` slot expanded too: both reveal
      // lines hold the whole-name-uppercased replacement — the carried
      // known token folded with it, the already-uppercase unknown token
      // byte-identical.
      expect(
        count(stub, `phantom reveal PRE${slot.toUpperCase()}MID${UNKNOWN}POST_WEBHOOK_SECRET`),
      ).toBe(2);

      // Census: two tokens per name × five expansion sites, exactly half
      // the known spelling and half the unknown — none resolved away,
      // emptied, or minted into extra copies.
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(10);
      expect(tokens.filter((t) => t.toLowerCase() === slot.toLowerCase())).toHaveLength(5);
      expect(tokens.filter((t) => t === UNKNOWN)).toHaveLength(5);

      // Order and seating per site: at each of the five sites the emitted
      // name keeps the known token before `mid` and the unknown token
      // after it — the unknown placeholder remains exactly where the name
      // put it, never transposed or reseated beside injected text.
      expect(stub.match(/pre\$\{[^}]*\}mid\$\{HOOK_URL\}post/gi)).toHaveLength(5);

      // Single pass: a re-resolve of the carried known token would double
      // the flanking text or drop the unknown token; neither happened.
      expect(stub).not.toMatch(/prepre|midmid|postpost/i);

      // The remaining known slots took their own generic values in the
      // same pass — expansion ran everywhere it was defined.
      expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
      expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it.each([
    ["${provider}", UNKNOWN], // known spelling leads, unknown follows
    [UNKNOWN, "${provider}"], // unknown leads, known spelling follows
  ])(
    "keeps the flush pair %j + %j adjacent and in order at every expansion site",
    (known, unknown) => {
      // The whole name is the two tokens back-to-back: a known slot
      // spelling flush against an unknown one. The known placeholder in
      // the template expands — the slots emit the pair as the replacement
      // — while the pair itself stays data: in order, nothing spliced
      // between the first token's `}` and the second's `${`, the unknown
      // token unchanged.
      const name = `${known}${unknown}`;
      const other = `${unknown}${known}`;
      const stub = webhookStubFor(name);

      // The `$`-led name is carried byte-for-byte at the three
      // case-preserving sites (`capitalize` leaves it) and whole-name
      // uppercased at both secret-key sites.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${name}Webhook(req: Request)`);
      expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

      // The flush pair occurs exact-case at the three mixed-case sites
      // and uppercased together at the two reveal sites — at each site
      // the second token starts on the very byte the first ends.
      expect(stub.match(/\$\{[^}]*\}\$\{[^}]*\}/g)).toHaveLength(5);
      expect(count(stub, name)).toBe(3);
      expect(count(stub, name.toUpperCase())).toBe(2);

      // The transposed order never lands, in either casing.
      expect(stub).not.toContain(other);
      expect(stub).not.toContain(other.toUpperCase());

      // Census: five occurrences of each token — the known spelling and
      // the unknown one — and nothing else placeholder-shaped.
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(10);
      expect(tokens.filter((t) => t.toLowerCase() === known.toLowerCase())).toHaveLength(5);
      expect(tokens.filter((t) => t.toLowerCase() === unknown.toLowerCase())).toHaveLength(5);

      // The template's real slots still take their own known values.
      expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
      expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it("skips a mixed-token name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the mixed-token name matches no
    // catalog provider: it returns in `skipped` byte-for-byte — the
    // known-spelling token, the unknown token and the text between them
    // intact — gets no stub on disk, and provokes no vault write. The
    // known provider listed beside it wires normally: every one of its
    // placeholders expands, unaffected by the placeholder-shaped
    // neighbour.
    const name = "pay${provider}load${HOOK_URL}end";
    const stubPath = join(dir, ".stack", "webhooks", "clerk.ts");
    const result = await wirePhantomForRecipe(recipe(name, "clerk"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["clerk:CLERK_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only clerk's documented stub lands — fully expanded, no `${...}`
    // left — and nothing is written under the mixed-token name.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["clerk.ts"]);
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toBe(webhookStubFor("clerk"));
    expect(stub).not.toContain("${");
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object — a token-carrying name provokes
    // no write.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });
});
