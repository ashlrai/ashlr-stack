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

// Each of the template's own slot spellings, usable inside a provider name
// as a known placeholder.
const SLOT_TOKENS = [
  "${provider}", // the name slot's own spelling
  "${capitalize(provider)}", // the handler-name slot's spelling
  "${webhookSecretKeyFor(provider)}", // the secret-key slot's spelling
  "${signatureHeaderFor(provider)}", // the header slot's spelling
  "${verificationHintFor(provider)}", // the hint slot's spelling
];

// A blank line is a newline with another newline right behind it. Counting
// the `\n`s that run straight into a second `\n` needs no assumptions about
// where the run sits: a run of k consecutive newlines — leading, trailing,
// or interior — always scores k-1 blank lines, and a run of one scores 0.
const blankLines = (s: string) => s.match(/\n(?=\n)/g)?.length ?? 0;

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("ai/phantom-wire known placeholder in a multiline template with blank lines", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-blank-lines-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "blank-lines",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each(SLOT_TOKENS.map((token) => `alpha\n\n${token}\n\nomega`))(
    "preserves the blank lines around the carried token %j at every expansion site",
    (name) => {
      // The name is itself a little multiline template: ordinary text, a
      // blank line, one of the stub's own slot spellings on a line of its
      // own, another blank line, more text. As replacement text the whole
      // thing is data — a resolver would resolve the token away, a
      // whitespace normalizer would collapse the doubled newlines. The
      // template's single pass does neither: the name lands at each of the
      // five expansion sites with token and blank lines intact.
      const stub = webhookStubFor(name);
      const token = name.match(/\$\{[^}]*\}/)?.[0] as string;
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      // The three case-preserving sites carry the name — blank lines and
      // carried token included — byte-for-byte; `capitalize` folds only
      // the name's first letter at the handler site.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
      // `webhookSecretKeyFor(provider)` uppercases the whole name: the
      // letters fold, the newline bytes and the token's `$`/`{`/`}` do
      // not. Both reveal lines hold the folded name, blank runs and all.
      expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

      // The stub template itself contains not one blank line — its comment
      // lines all carry at least `//` — so every blank line in the output
      // is one the name carried. Two blank lines in the name x five
      // expansion sites: substitution preserved all ten, collapsing none
      // and minting none.
      expect(blankLines(webhookStubFor("plain"))).toBe(0);
      expect(blankLines(name)).toBe(2);
      expect(blankLines(stub)).toBe(5 * blankLines(name));

      // The carried token still sits on its own line between the name's
      // two blank lines at every site — in original case at the two
      // verbatim sites plus the handler site (interior text is
      // untouched), uppercased at the two reveal sites.
      expect(count(stub, `\n\n${token}\n\n`)).toBe(3);
      expect(count(stub, `\n\n${token.toUpperCase()}\n\n`)).toBe(2);

      // Five `${...}` spans — one per expansion site — every one the
      // carried token in that site's case, none resolved away or doubled.
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(5);
      for (const t of tokens) expect(t.toLowerCase()).toBe(token.toLowerCase());

      // The remaining slots took their own generic values in the same
      // single pass — the carried token never reached their switch cases.
      expect(stub).toContain('req.headers.get("x-webhook-signature")');
      expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it.each([
    "${provider}\n\nbody", // token on the first line, one blank line after
    "head\n\n\n${provider}\n\n\ntail", // two blank lines on each side
    "one\n\ntwo\n\n${provider}", // stacked blanks, token on the last line
    "\n\n${provider}\n\n", // nothing but blank lines around the token
  ])("preserves the blank lines in %j around the carried token", (name) => {
    // Leading, trailing, and doubled blank runs are the same data. `\n`
    // has no case mapping — `capitalize` and `toUpperCase` both leave
    // every newline byte alone — so each blank line lands once per
    // expansion site and the count scales exactly with the name's.
    const stub = webhookStubFor(name);
    const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
    expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

    // The name's blank lines survive verbatim at the case-preserving
    // sites: `stub for ${name}.` holds every run the name contains.
    // Escaped sequences would show as literal `\` `n` pairs instead.
    expect(blankLines(stub)).toBe(5 * blankLines(name));
    expect(stub).not.toContain("\\n");

    // Still five expansion sites, still one carried `${provider}` token at
    // each — blank lines change nothing about the substitution's arity.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(5);
    for (const t of tokens) expect(t.toLowerCase()).toBe("${provider}");

    // The fixed slots resolved to their generic values in the same pass.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it("skips a blank-line template name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the multiline name matches no catalog
    // provider: it returns in `skipped` byte-for-byte — token, text, and
    // both blank lines intact — gets no stub on disk, and provokes no
    // vault write. The known provider listed beside it wires normally,
    // unaffected by the template-shaped neighbour.
    const name = "alpha\n\n${provider}\n\nomega";
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");
    const result = await wirePhantomForRecipe(recipe(name, "stripe"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);
    expect(blankLines(result.skipped[0] ?? "")).toBe(2);

    // Only stripe's documented stub lands — nothing for the multiline
    // name, and the stub on disk is the same render `webhookStubFor`
    // returns.
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
