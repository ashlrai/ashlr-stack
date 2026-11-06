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

describe("ai/phantom-wire unknown placeholder surrounded by ordinary text", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-unknown-placeholder-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "unknown-placeholder",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each(["${UNKNOWN}stripe", "stripe${UNKNOWN}"])(
    "substitutes the provider beside an unknown token without resolving the token: %s",
    (name) => {
      const stub = webhookStubFor(name);

      // The provider interpolation resolves to the supplied name in both
      // locations, while the adjacent unknown token remains literal data.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).not.toContain("${provider}");
      expect(stub.split("${UNKNOWN}").length - 1).toBe(5);
    },
  );

  it("keeps an unknown ${...} token and the text around it byte-for-byte at every site", () => {
    // `pre${HOOK_URL}post` matches none of the template's slots — expansion
    // fills `provider`, `capitalize(provider)`, `webhookSecretKeyFor(provider)`
    // and `signatureHeaderFor(provider)`; a `${...}` arriving inside the name
    // has no substitution and is pure data. It must reach each of the five
    // expansion sites still seated between the name's own `pre`/`post` text:
    // a resolver would empty it, splice a value in, or orphan the text around
    // it. The token is already uppercase, so even the `toUpperCase()`
    // secret-key sites hold the identical bytes.
    const name = "pre${HOOK_URL}post";
    const stub = webhookStubFor(name);

    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    // `capitalize(provider)` folds only the name's first letter — the token
    // and the text after it are untouched.
    expect(stub).toContain("handlePre${HOOK_URL}postWebhook(req: Request)");
    // `webhookSecretKeyFor(provider)` sites: the already-uppercase token and
    // its uppercase surrounding text survive in both reveal lines.
    expect(stub.split("phantom reveal PRE${HOOK_URL}POST_WEBHOOK_SECRET").length - 1).toBe(2);

    // Every `${...}` in the stub is the carried token — five expansion
    // sites, five occurrences, no other unresolved placeholder-shaped text.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toEqual(Array(5).fill("${HOOK_URL}"));
    // The ordinary text still flanks the token at every site: each
    // occurrence sits between the name's own `pre` and `post` (in whatever
    // case that site's transform gives them), never beside injected text.
    expect(stub.match(/pre\$\{HOOK_URL\}post/gi)).toHaveLength(5);

    // Nothing resolved the token as a slot: the generic signature header and
    // the fallback verification hint apply unchanged.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it("folds a lowercase token's interior only at the secret-key sites and keeps it verbatim elsewhere", () => {
    // Same scenario with a token whose interior is lowercase. The three
    // case-preserving sites carry the name — token and surrounding text —
    // byte-for-byte; the two `toUpperCase()` secret-key sites fold the
    // token's letters along with the text around it, because they uppercase
    // the whole name. Either way the token is still there, still `${...}`,
    // still between the same surrounding text — never resolved, emptied or
    // duplicated.
    const stub = webhookStubFor("before${hook_url}after");

    // Case-preserving sites carry `before${hook_url}after` byte-for-byte.
    expect(stub).toContain("webhook handler stub for before${hook_url}after.");
    expect(stub).toContain("forge a before${hook_url}after webhook.");
    expect(stub).toContain("handleBefore${hook_url}afterWebhook(req: Request)");
    // The original-case token appears only at those three sites; its folded
    // form appears only at the two reveal lines.
    expect(stub.split("${hook_url}").length - 1).toBe(3);
    expect(stub.split("${HOOK_URL}").length - 1).toBe(2);
    expect(stub.split("phantom reveal BEFORE${HOOK_URL}AFTER_WEBHOOK_SECRET").length - 1).toBe(2);

    // Five `${...}` tokens in total, every one the carried placeholder in
    // either its original or its reveal-site case — and each still seated
    // between the surrounding `before`/`after` text.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(5);
    for (const token of tokens) expect(token.toLowerCase()).toBe("${hook_url}");
    expect(stub.match(/before\$\{hook_url\}after/gi)).toHaveLength(5);
  });

  it.each(["a{{mustache}}b", "a%name%b", "a%sb", "a$1b"])(
    "carries the foreign placeholder syntax in %s literally when wrapped in ordinary text",
    (name) => {
      // `{{...}}`, `%...%`, `%s` and `$1` are placeholder syntaxes this
      // template does not use at all. Surrounded by ordinary text they are
      // pure data: byte-for-byte at the title and forge sites, folded only
      // at the first letter by `capitalize` at the handler site, and folded
      // with the rest of the name at the two `toUpperCase()` secret-key
      // sites — never resolved, emptied or merged.
      const stub = webhookStubFor(name);
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

      // Two verbatim sites + one first-letter-folded site + two folded
      // sites = the five expansion sites. The template contributes none of
      // these syntaxes itself, so every occurrence is one the name carried.
      expect(stub.split(name).length - 1).toBe(2);
      expect(stub.split(capitalized).length - 1).toBe(1);
      expect(stub.split(name.toUpperCase()).length - 1).toBe(2);
      expect(stub).not.toContain("${");
    },
  );

  it("skips a placeholder-surrounded name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the name matches no catalog provider:
    // it returns in `skipped` byte-for-byte — token and surrounding text
    // intact — gets no stub on disk, and provokes no vault write. The known
    // provider listed beside it wires normally, unaffected by the
    // placeholder-shaped neighbour.
    const name = "pre${HOOK_URL}post";
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");
    const result = await wirePhantomForRecipe(recipe(name, "stripe"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only stripe's documented stub lands — nothing for the
    // placeholder-shaped name, and the stub on disk is the same render
    // `webhookStubFor` returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["stripe.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("stripe"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });

  it("renders the known provider's placeholders and leaves a bare unknown ${...} token untouched in one recipe", async () => {
    // Known (`stripe`) and unknown (`${UNKNOWN}`) together: the known
    // provider's stub has every slot replaced (no `${` left); the unknown
    // token is skipped verbatim and no file is written under its name.
    const unknown = "${UNKNOWN}";
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");
    const result = await wirePhantomForRecipe(recipe("stripe", unknown), { cwd: dir });

    expect(result.skipped).toEqual([unknown]);
    expect(result.webhooks).toEqual([stubPath]);
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toBe(webhookStubFor("stripe"));
    expect(stub).toContain("webhook handler stub for stripe.");
    expect(stub).toContain("handleStripeWebhook");
    expect(stub).not.toContain("${");
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["stripe.ts"]);
  });
});
