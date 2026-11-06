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
const newlineCount = (s: string) => count(s, "\n");

// Each of the template's own slot spellings, usable as a provider name that
// spells a known placeholder.
const SLOT_TOKENS = [
  "${provider}", // the name slot's own spelling
  "${capitalize(provider)}", // the handler-name slot's spelling
  "${webhookSecretKeyFor(provider)}", // the secret-key slot's spelling
  "${signatureHeaderFor(provider)}", // the header slot's spelling
  "${verificationHintFor(provider)}", // the hint slot's spelling
];

describe("ai/phantom-wire known placeholder on each of two lines", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-two-line-placeholder-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "two-line-placeholder",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each(SLOT_TOKENS)(
    "carries both occurrences of %j and keeps the newline between them at every site",
    (token) => {
      // The name is exactly two lines, each holding the same known
      // placeholder — the token on the first line, a newline, the token
      // again on the second, no ordinary text. Both occurrences are data:
      // expansion fills the five name-carrying sites with the name itself,
      // so each site receives the pair in the input's own order with the
      // line break between them. A resolver would resolve the tokens away,
      // a sanitizer would strip or escape the 0x0A, line-ending
      // normalization would rewrite it as CRLF. None of that runs.
      const name = `${token}\n${token}`;
      const stub = webhookStubFor(name);
      const flat = webhookStubFor(`${token}${token}`);

      // The three case-preserving sites carry the name byte-for-byte —
      // both tokens and the break between them. `capitalize` folds only
      // the first code point, and `$` uppercases to itself, so the handler
      // site holds the identical bytes.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${name}Webhook(req: Request)`);
      // The two `toUpperCase()` reveal sites carry the folded name; `\n`
      // has no case mapping, so the folded pair sits line-broken there too.
      expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

      // Both occurrences land at every site, each on its own line and in
      // order: the exact-case pair at the three case-preserving sites, the
      // folded pair at both reveal sites.
      expect(count(stub, `${token}\n${token}`)).toBe(3);
      expect(count(stub, `${token.toUpperCase()}\n${token.toUpperCase()}`)).toBe(2);

      // The intervening byte is a real 0x0A — not an escape, not a CRLF.
      // The first token closes its line (token then `\n`) and the second
      // opens the next (`\n${`, no `//` prefix) at all five sites. Rendering
      // the same pair on one line gives the flat baseline: the only
      // difference is exactly five inserted line breaks, one per site.
      const at = stub.indexOf(`${token}\n${token}`);
      expect(stub.charCodeAt(at + token.length)).toBe(0x0a);
      expect(count(stub, `${token}\n`)).toBe(3);
      expect(count(stub, `${token.toUpperCase()}\n`)).toBe(2);
      expect(count(stub, "\n${")).toBe(5);
      expect(newlineCount(stub)).toBe(newlineCount(flat) + 5);
      expect(stub).not.toContain("\\n");
      expect(stub).not.toContain("\r");

      // Ten `${...}` spans — two per site × five sites — every one the
      // carried token in that site's case: six exact-case, four folded.
      // Resolution would erase them, re-expansion would mint more, and
      // nothing reorders the pair onto one line.
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(10);
      for (const t of tokens) expect(t.toLowerCase()).toBe(token.toLowerCase());
      expect(count(stub, token)).toBe(6);
      expect(count(stub, token.toUpperCase())).toBe(4);

      // The sibling slots took their own generic values in the same single
      // pass — the carried pair never reached their switch cases either.
      expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
      expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it("keeps a different known token on each line in line order at every site", () => {
    // Two lines, a DIFFERENT known placeholder on each — `${provider}` on
    // the first, `${signatureHeaderFor(provider)}` on the second, ordinary
    // `pre`/`post` text at the name's edges. Both tokens ride along in the
    // name's own order: the first-line token never drops to the second
    // line and the second-line token never climbs to the first.
    const first = "${provider}";
    const second = "${signatureHeaderFor(provider)}";
    const name = `pre${first}\n${second}post`;
    const stub = webhookStubFor(name);
    const flat = webhookStubFor(`pre${first}${second}post`);

    // Case-preserving sites carry the name byte-for-byte; `capitalize`
    // folds only the leading `p` → `Pre`, and the reveal sites fold the
    // whole name — tokens, text, but not the newline.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handlePre${first}\n${second}postWebhook(req: Request)`);
    expect(
      count(
        stub,
        `phantom reveal PRE${first.toUpperCase()}\n${second.toUpperCase()}POST_WEBHOOK_SECRET`,
      ),
    ).toBe(2);

    // In order, on their own lines: exact-case at the three case-preserving
    // sites, folded at both reveal sites — never transposed, never
    // flattened onto one line, in either casing.
    expect(count(stub, `${first}\n${second}`)).toBe(3);
    expect(count(stub, `${first.toUpperCase()}\n${second.toUpperCase()}`)).toBe(2);
    expect(stub).not.toContain(`${second}\n${first}`);
    expect(stub).not.toContain(`${second.toUpperCase()}\n${first.toUpperCase()}`);
    expect(newlineCount(stub)).toBe(newlineCount(flat) + 5);

    // Ten spans — each is one of the two tokens in that site's case, still
    // seated where the name put it: the `pre` text ahead of the first
    // line's token, the `post` text behind the second line's.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(10);
    for (const t of tokens.map((t) => t.toLowerCase())) {
      expect([first.toLowerCase(), second.toLowerCase()]).toContain(t);
    }
    expect(stub.match(/pre\$\{[^}]*\}\n/gi)).toHaveLength(5);
    expect(stub.match(/\n\$\{[^}]*\}post/gi)).toHaveLength(5);

    // The sibling slots resolved to their own generic values in the same
    // single pass — the carried tokens never reached their switch cases.
    expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
    expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it("skips a two-line placeholder name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the name matches no catalog provider:
    // it returns in `skipped` byte-for-byte — both tokens and the newline
    // between them intact — gets no stub on disk, and provokes no vault
    // write. The known provider listed beside it wires normally,
    // unaffected by the line-broken placeholder neighbour.
    const name = "${provider}\n${provider}";
    const stubPath = join(dir, ".stack", "webhooks", "clerk.ts");
    const result = await wirePhantomForRecipe(recipe(name, "clerk"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["clerk:CLERK_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);
    expect(result.skipped[0]?.charCodeAt("${provider}".length)).toBe(0x0a);

    // Only clerk's documented stub lands — nothing for the two-line name,
    // and the stub on disk is the same render `webhookStubFor` returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["clerk.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("clerk"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});

    // The hint is a fixed string: a line-broken name never leaks into it.
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });
});
