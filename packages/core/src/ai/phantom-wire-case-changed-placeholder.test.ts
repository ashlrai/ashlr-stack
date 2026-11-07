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

describe("ai/phantom-wire case-changed placeholder name", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-case-changed-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "case-changed",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each([
    ["${Provider}", "${provider}"], // name slot, first letter up
    ["${CAPITALIZE(provider)}", "${capitalize(provider)}"], // handler slot, callee uppercased
    ["${webhooksecretkeyfor(provider)}", "${webhookSecretKeyFor(provider)}"], // key slot, all lower
    ["${SignatureHeaderFor(Provider)}", "${signatureHeaderFor(provider)}"], // header slot, mixed
    ["${VERIFICATIONHINTFOR(PROVIDER)}", "${verificationHintFor(provider)}"], // hint slot, all caps
  ])(
    "keeps the case-changed spelling %j literal at every site — never normalized to %j",
    (name, slot) => {
      // Placeholder matching is case-sensitive end to end: only the exact
      // spelling names a slot. A whole-name token in any other case is plain
      // data — it reaches all five expansion sites in its own case (or
      // folded at the `toUpperCase()` sites), is never rewritten to the
      // slot's exact spelling, and never resolves into the value the exact
      // spelling would name. The template's real slots take their generic
      // values around it.
      const stub = webhookStubFor(name);

      // The name lands byte-for-byte at the three case-preserving sites and
      // whole-name uppercased at the two secret-key sites; `capitalize`
      // folds only a leading letter and `$` uppercases to itself.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${name}Webhook(req: Request)`);
      expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

      // The exact-case slot spelling appears nowhere: the carried token was
      // emitted verbatim or folded, never recognized and re-emitted in
      // canonical slot case.
      expect(stub).not.toContain(slot);

      // Five `${...}` spans — one per expansion site — every one the
      // carried token in one of the two casings the name legitimately
      // takes; none resolved away, none minted in the slot's own case.
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(5);
      for (const token of tokens) expect(token.toLowerCase()).toBe(name.toLowerCase());

      // Unrelated text renders normally around the carried token: the
      // signature-header and hint slots took the generic values the
      // case-sensitive switches fall through to for a non-provider name.
      expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
      expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it("keeps the ordinary text flanking a case-changed token byte-for-byte at every site", () => {
    // `pre${Provider}post` seats a case-changed `${provider}`-lookalike
    // between unrelated text. The flanks and the token's own case reach
    // every expansion site untouched: the token is never folded to the
    // exact slot spelling and the surrounding `pre`/`post` is never eaten,
    // doubled, or merged into a value.
    const name = "pre${Provider}post";
    const stub = webhookStubFor(name);

    // Case-preserving sites carry the whole name byte-for-byte;
    // `capitalize` folds only the first letter; the two reveal sites fold
    // token and flanks together.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain("handlePre${Provider}postWebhook(req: Request)");
    expect(count(stub, "phantom reveal PRE${PROVIDER}POST_WEBHOOK_SECRET")).toBe(2);

    // Each token still sits between exactly one `pre` and one `post`, in
    // whatever case that site's transform gives them — five sites, five
    // seated occurrences — and never in the all-lowercase spelling an
    // exact-match resolver would have used.
    expect(stub.match(/pre\$\{provider\}post/gi)).toHaveLength(5);
    expect(stub).not.toContain("pre${provider}post");
    // `pre`+token+`post` verbatim at title and forge, `Pre`-folded at the
    // handler site, fully folded at both reveal sites.
    expect(count(stub, "pre${Provider}post")).toBe(2);
    expect(count(stub, "Pre${Provider}post")).toBe(1);
    expect(count(stub, "PRE${PROVIDER}POST")).toBe(2);

    // The remaining slots took their generic values in the same single pass.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it.each(["Stripe", "STRIPE", "sTrIpE"])(
    "misses every case-sensitive lookup for the case-changed provider name %s",
    (name) => {
      // `stripe` is a known provider only in its exact spelling. Changing
      // any letter's case makes every match miss: the signature header and
      // the verification hint fall through to their generic defaults
      // instead of stripe's — the contract is byte equality, not folding.
      const stub = webhookStubFor(name);
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      // The name sites still carry the supplied case verbatim.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);

      // The misses: generic header, generic hint — stripe's own values
      // appear nowhere in the render.
      expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
      expect(stub).not.toContain("stripe-signature");
      expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
      expect(stub).not.toContain("stripe.webhooks.constructEvent");
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));

      // Both reveal sites still spell `STRIPE_WEBHOOK_SECRET` — the default
      // branch's whole-name `toUpperCase()`, not a match on stripe's case.
      // Same bytes, different reason.
      expect(count(stub, "phantom reveal STRIPE_WEBHOOK_SECRET")).toBe(2);
    },
  );

  it("skips a case-changed provider name through wiring while the exact-case twin wires normally", async () => {
    // `Stripe` differs from `stripe` by one letter's case. The catalog
    // lookup and the webhook-provider set are case-sensitive: the variant
    // returns in `skipped` byte-for-byte, writes no stub, provokes no vault
    // write — while the exact-case name beside it wires normally.
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");
    const result = await wirePhantomForRecipe(recipe("Stripe", "stripe"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: ["Stripe"],
    });
    // Byte-for-byte: the skipped name kept its case — not folded to `stripe`.
    expect(result.skipped[0]).toBe("Stripe");

    // Only stripe's documented stub lands — the directory listing holds
    // exactly `stripe.ts` — and the stub on disk is the same render
    // `webhookStubFor` returns. (`existsSync` can't stand in here: on a
    // case-insensitive filesystem `Stripe.ts` resolves to `stripe.ts`, so
    // the listing is the check that no second file was written.)
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["stripe.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("stripe"));

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });

  it("skips a whole-name case-changed token byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the case-changed slot spelling matches
    // no catalog provider: it returns in `skipped` byte-for-byte — its case
    // intact, not normalized to the exact spelling — gets no stub on disk,
    // and provokes no vault write. The known provider listed beside it
    // wires normally, unaffected by the placeholder-shaped neighbour.
    const name = "${Provider}";
    const stubPath = join(dir, ".stack", "webhooks", "github.ts");
    const result = await wirePhantomForRecipe(recipe(name, "github"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["github:GITHUB_TOKEN"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only github's documented stub lands — nothing for the token name —
    // and the stub on disk is the same render `webhookStubFor` returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["github.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("github"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });
});
