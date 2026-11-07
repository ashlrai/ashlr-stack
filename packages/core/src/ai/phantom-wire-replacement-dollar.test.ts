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

describe("ai/phantom-wire $-substitution patterns in replacement text", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-dollar-replacement-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "dollar-replacement",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  /**
   * The stub a literal renderer must produce for `name`. The provider name
   * is replacement text: `$1`, `$$`, `$&`, `` $` `` and `$'` are directives
   * to `String.prototype.replace` — a `.replace`-based renderer would splice
   * a capture group in for `$1`, collapse `$$` to one dollar, inject the
   * matched slot for `$&`, or inject the template text around the match for
   * `` $` ``/`$'`. Template literals have no substitution pattern at all, so
   * the `$` bytes must arrive as inert data.
   *
   * The oracle renders a sentinel name — the same letters with each `$x`
   * swapped for NUL, a byte with no special meaning in either syntax — then
   * substitutes each NUL back to its pattern through a replacer FUNCTION,
   * whose return value is also exempt from `$`-pattern interpretation.
   * Whole-stub equality against this oracle catches every replace-semantics
   * failure anywhere in the output, not just at the five expansion sites.
   */
  const literalRender = (name: string): string => {
    const patterns = [...name.matchAll(/\$./g)].map((m) => m[0]);
    const sentinel = name.replaceAll(/\$./g, "\u0000");
    // Each expansion site replays the name's pattern sequence in order, so
    // the i-th NUL maps to patterns[i mod patterns.length].
    let i = 0;
    return webhookStubFor(sentinel).replaceAll("\u0000", () => patterns[i++ % patterns.length]);
  };

  it.each(["svc$1pay", "$1", "pay$1", "a$1$2$9z"])(
    "inserts the $1-carrying name %j literally at every site — the characters, not a capture group",
    (name) => {
      const stub = webhookStubFor(name);
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      // The decisive differential: byte-for-byte equal to the sentinel
      // render — the `$`-pattern bytes behaved exactly like inert data at
      // every expansion site and everywhere between them.
      expect(stub).toBe(literalRender(name));

      // The characters appear literally in the result: the name at the
      // three case-preserving sites, first-letter-folded at the handler
      // site, whole-name-folded at both reveal sites.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
      expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

      // Dollar census: only the `$` the name itself carries, times the five
      // sites — none dropped by a `$$` collapse or minted by a splice — and
      // every `$1` still seated inside the name's own bytes.
      expect(count(stub, "$")).toBe(count(name, "$") * 5);
      expect(count(stub, "$1")).toBe(count(name, "$1") * 5);
      expect(stub).not.toContain("${");

      // The sibling slots resolved to their own values in the same pass —
      // the pattern never reached their switch cases.
      expect(stub).toContain('req.headers.get("x-webhook-signature")');
      expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it.each(["svc$$pay", "svc$&pay", "svc$`pay", "svc$'pay"])(
    "inserts the replace-directive name %j literally at every site",
    (name) => {
      // Same scenario for the rest of the replace-pattern family: `$$`
      // collapses to `$`, `$&` splices the match, `` $` ``/`$'` splice the
      // template text flanking the match. All are `toUpperCase`-invariant,
      // so the sentinel differential applies unchanged.
      const stub = webhookStubFor(name);
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      expect(stub).toBe(literalRender(name));

      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
      expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

      // Two `$` for `$$`, one for the rest — all carried, never resolved.
      expect(count(stub, "$")).toBe(count(name, "$") * 5);
      expect(stub).not.toContain("${");

      expect(stub).toContain('req.headers.get("x-webhook-signature")');
      expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it("inserts the named-capture pattern `$<ref>` literally, folding only its letters at the reveal sites", () => {
    // `$<name>` splices a named capture group under replace semantics. Its
    // letters fold with the rest of the name at the `toUpperCase()` sites,
    // so the differential oracle does not apply — assert the sites and the
    // census directly.
    const name = "svc$<ref>pay";
    const stub = webhookStubFor(name);

    expect(count(stub, "svc$<ref>pay")).toBe(2); // title + forge
    expect(stub).toContain("handleSvc$<ref>payWebhook(req: Request)");
    expect(count(stub, "phantom reveal SVC$<REF>PAY_WEBHOOK_SECRET")).toBe(2);
    expect(count(stub, "$")).toBe(5);
    expect(stub).not.toContain("${");

    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it("skips a $1-carrying name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the `$1` name matches no catalog
    // provider: it returns in `skipped` byte-for-byte — the capture-group
    // spelling intact — gets no stub on disk, and provokes no vault write.
    // The known provider listed beside it wires normally, unaffected by the
    // replace-pattern-shaped neighbour.
    const name = "svc$1pay";
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");
    const result = await wirePhantomForRecipe(recipe(name, "stripe"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only stripe's documented stub lands — nothing for the `$1` name, and
    // the stub on disk is the same render `webhookStubFor` returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["stripe.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("stripe"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });
});
