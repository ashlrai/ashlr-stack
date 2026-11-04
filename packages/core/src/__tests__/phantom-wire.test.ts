import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verificationHintFor, webhookStubFor, wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import { type Recipe, readRecipe, writeRecipe } from "../ai/recipe.ts";
import { exec, listSecrets } from "../phantom.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// Every test spawns the fake `phantom` shim (bash + several python3 calls),
// which takes multiple seconds on loaded machines — well past the 5s default.
setDefaultTimeout(30_000);

describe("ai/phantom-wire", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = setupFakePhantom();
  });
  afterEach(() => {
    harness.cleanup();
  });

  const STRIPE_RECIPE: Recipe = {
    id: "stripe-only",
    query: "payments",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: [{ name: "stripe" }],
  };

  it("returns the verification hint template unchanged for each known provider", () => {
    // `verificationHintFor` returns a fixed string per provider with no
    // placeholders to interpolate. The template must arrive at the caller
    // byte-for-byte — no mutation, no case folding, no escaping.
    expect(verificationHintFor("stripe")).toBe(
      "Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance.",
    );
    expect(verificationHintFor("clerk")).toBe(
      "Clerk (svix): `new Webhook(secret).verify(body, headers)`.",
    );
    expect(verificationHintFor("supabase")).toBe(
      "Supabase: `x-supabase-signature` per Supabase's documented webhook scheme.",
    );
    expect(verificationHintFor("github")).toBe(
      "GitHub: `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body.",
    );
  });

  it("returns the fallback hint template unchanged for any unknown provider, placeholder-shaped names included", () => {
    // The fallback template has no placeholders, so the provider name must
    // never leak into it or be interpolated, whatever it looks like.
    const fallback = "Verify per the provider's documented signature scheme.";
    for (const name of ["zzqhook", "", "${provider}", "{{provider}}", "%s", "$1", "Stripe"]) {
      expect(verificationHintFor(name)).toBe(fallback);
    }
    expect(fallback).not.toMatch(/\$\{|\{\{|%s|\$\d/);
  });

  it("returns empty results for a recipe with no providers", async () => {
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [] };

    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [],
    });
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
    expect(harness.callsTo("add")).toEqual([]);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
  });

  it("never writes to the vault, reports the missing secret, and writes a webhook stub", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });

    // Phantom Secrets refuses values in argv and denies overwriting names, so
    // apply must not try to plant placeholders. It only reads names.
    expect(harness.callsTo("add")).toEqual([]);
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
    expect(result.present).toEqual([]);
    expect(result.missing).toContain("stripe:STRIPE_SECRET_KEY");

    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(existsSync(stubPath)).toBe(true);
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toContain("stripe-signature");
    expect(stub).toContain("STRIPE_WEBHOOK_SECRET");
    expect(result.webhooks).toHaveLength(1);
  });

  it("ignores an unexpected field on a recipe provider", async () => {
    const provider = { name: "stripe", unexpected: "extra value" };
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [provider] };
    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");

    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [],
    });
    expect(readFileSync(stubPath, "utf-8")).toContain("stripe-signature");
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("gives every repeated provider slot in the stub the same supplied value", () => {
    // The provider shows up verbatim in the title and the forgery warning,
    // capitalized in the handler name, and as the secret key in both
    // `phantom reveal` lines. Each site must carry the same supplied value.
    const stub = webhookStubFor("acme");
    const count = (needle: string) => stub.split(needle).length - 1;
    expect(count("webhook handler stub for acme.")).toBe(1);
    expect(count("forge a acme webhook.")).toBe(1);
    expect(count("handleAcmeWebhook")).toBe(1);
    expect(count("phantom reveal ACME_WEBHOOK_SECRET")).toBe(2);
    // Every occurrence of the value, in any case, is one of the sites above.
    expect(stub.match(/acme/gi)?.length).toBe(5);
    expect(stub).not.toMatch(/\$\{|\{provider\}/);
  });

  it("fills two known providers' placeholders with their own values and never each other's", () => {
    // Each known provider maps to its own secret name, signature header,
    // handler name, and verification hint. Rendering one must not pick up
    // the other's values.
    const cases = [
      {
        provider: "stripe",
        secret: "STRIPE_WEBHOOK_SECRET",
        header: "stripe-signature",
        handler: "handleStripeWebhook",
      },
      {
        provider: "github",
        secret: "GITHUB_WEBHOOK_SECRET",
        header: "x-hub-signature-256",
        handler: "handleGithubWebhook",
      },
    ];
    for (const [self, other] of [
      [cases[0], cases[1]],
      [cases[1], cases[0]],
    ] as const) {
      const stub = webhookStubFor(self.provider);
      expect(stub).toContain(`webhook handler stub for ${self.provider}.`);
      expect(stub).toContain(`phantom reveal ${self.secret}`);
      expect(stub).toContain(`req.headers.get("${self.header}")`);
      expect(stub).toContain(self.handler);
      expect(stub).toContain(verificationHintFor(self.provider));
      expect(stub).not.toContain(other.provider);
      expect(stub).not.toContain(other.secret);
      expect(stub).not.toContain(other.header);
      expect(stub).not.toContain(other.handler);
      expect(stub).not.toContain(verificationHintFor(other.provider));
    }
  });

  it("expands a provider name containing dollar signs literally in the webhook stub", () => {
    // `$&`, `$1`, `$$` and `` $` `` are special in String.replace replacement
    // strings; the stub must carry them through verbatim.
    const provider = "pay$&x$1$$y$`z";
    const stub = webhookStubFor(provider);
    expect(stub).toContain(`webhook handler stub for ${provider}.`);
    expect(stub).toContain(`forge a ${provider} webhook.`);
    expect(stub).toContain(`handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`);
  });

  it("keeps both dollar signs of a `$$` in a provider name at every expansion site", () => {
    // In a String.replace replacement string, `$$` collapses to a single `$`.
    // Carried as data, both signs must survive at all five sites.
    const stub = webhookStubFor("pay$$hook");

    expect(stub).toContain("webhook handler stub for pay$$hook.");
    expect(stub).toContain("forge a pay$$hook webhook.");
    expect(stub).toContain("handlePay$$hookWebhook(req: Request)");
    expect(stub.split("phantom reveal PAY$$HOOK_WEBHOOK_SECRET").length - 1).toBe(2);
    // Five sites, two signs each; the template itself has no `$`.
    expect(stub.split("$").length - 1).toBe(10);
    expect(stub).not.toMatch(/pay\$hook|PAY\$HOOK/);
  });

  it("keeps both signs of every `$$` pair at the edges, doubled, and beside other dollar patterns", async () => {
    // `$$` is the String.replace replacement escape for one literal `$`:
    // under replace semantics each pair in the name would halve to a
    // single sign at every slot (`pay$$$hook` → `pay$$hook`), and `a$$&b`
    // would come out `a$&b` — the escape consumed, the `&` left plain.
    // Carried as data, both signs land at all five expansion sites
    // wherever the pair sits: leading, trailing, doubled in one name,
    // tripled (pair + lone sign), or beside another `$` pattern.
    for (const provider of ["$$hook", "hook$$", "a$$b$$c", "pay$$$hook", "a$$&b"]) {
      const stub = webhookStubFor(provider);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      // The template contributes no `$` of its own: each sign in the stub
      // is one the name carried into a slot — none consumed by pair
      // escaping, none added — and no `${` residue is left behind.
      expect(stub.split("$").length - 1).toBe((provider.split("$").length - 1) * 5);
      expect(stub).not.toContain("${");
    }

    // A `$$` name matches no catalog provider (the lookup compares exact
    // bytes): through wiring it returns in `skipped` byte-for-byte — both
    // dollar signs adjacent and intact — and never reaches the stub
    // template or disk.
    const name = "stripe$$";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [name] });
    expect(result.skipped[0]?.charCodeAt(6)).toBe(0x24);
    expect(result.skipped[0]?.charCodeAt(7)).toBe(0x24);
    expect(result.skipped[0]?.split("$").length - 1).toBe(2);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);

    // The hint is a fixed string: a `$$` name never leaks into it.
    expect(verificationHintFor("pay$$hook")).toBe(verificationHintFor("zzq"));
  });

  it("inserts a `$'` in a provider name literally at every expansion site", () => {
    // In a String.replace replacement string, `$'` splices in the text AFTER
    // the match — the rest of the template. If expansion ever ran through
    // replace, each site would swallow the trailing stub text instead of
    // keeping the two characters. Carried as data, `$'` is just the name.
    const provider = "pay$'hook";
    const stub = webhookStubFor(provider);

    expect(stub).toContain("webhook handler stub for pay$'hook.");
    expect(stub).toContain("forge a pay$'hook webhook.");
    expect(stub).toContain("handlePay$'hookWebhook(req: Request)");
    expect(stub.split("phantom reveal PAY$'HOOK_WEBHOOK_SECRET").length - 1).toBe(2);

    // One `$'` per expansion site (header, forge, handler name, two reveals);
    // the template itself has none. Line count matches a plain name, so no
    // trailing template text was spliced in.
    expect(stub.split("$'").length - 1).toBe(5);
    expect(stub).not.toContain("${");
    expect(stub.split("\n").length).toBe(webhookStubFor("zzqhook").split("\n").length);
  });

  it("inserts a `` $` `` in a provider name literally at every expansion site", async () => {
    // In a String.replace replacement string, `` $` `` splices in the text
    // BEFORE the match — the template's own leading text. If expansion ever
    // ran through replace, each site would repeat that prefix instead of
    // keeping the two characters. Carried as data, `` $` `` is just the name.
    const provider = "pay$`hook";
    const stub = webhookStubFor(provider);

    // The fixed template text sits flush against the replacement: no prefix
    // text was spliced in ahead of it at any site.
    expect(stub.split("\n")[0]).toBe(
      "// Auto-generated by `stack apply` — webhook handler stub for pay$`hook.",
    );
    expect(stub).toContain("forge a pay$`hook webhook.");
    expect(stub).toContain("handlePay$`hookWebhook(req: Request)");
    expect(stub.split("phantom reveal PAY$`HOOK_WEBHOOK_SECRET").length - 1).toBe(2);

    // One `` $` `` per expansion site (header, forge, handler name, two
    // reveals); the template itself has none. A prefix splice would repeat
    // the leading template text — a second "Auto-generated" banner and extra
    // lines — so the stub's shape stays identical to a plain name's.
    expect(stub.split("$`").length - 1).toBe(5);
    expect(stub).not.toContain("${");
    expect(stub.split("Auto-generated").length - 1).toBe(1);
    expect(stub.split("\n").length).toBe(webhookStubFor("zzqhook").split("\n").length);

    // Through wiring the name matches no catalog provider: it returns in
    // `skipped` byte-for-byte and never reaches the stub template or disk.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
    expect(result.skipped[0]?.charCodeAt(4)).toBe(0x60);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("carries the `$&` match token in a provider name literally through every expansion site", async () => {
    // In a String.replace replacement string, `$&` splices in the matched
    // substring — `${provider}` here. If expansion ever ran through replace,
    // `pay$&hook` would come out as `pay${provider}hook`: the token gone and
    // placeholder-shaped residue left in its place. Carried as data, the
    // name lands byte-for-byte at all five expansion sites instead.
    const provider = "pay$&hook";
    const stub = webhookStubFor(provider);

    // Raw `${provider}` sites: the header and forge lines.
    expect(stub).toContain("webhook handler stub for pay$&hook.");
    expect(stub).toContain("forge a pay$&hook webhook.");
    // `capitalize(provider)` site: only the name's first letter folds.
    expect(stub).toContain("handlePay$&hookWebhook(req: Request)");
    // `webhookSecretKeyFor(provider)` sites: neither `$` nor `&` has a case
    // mapping, so the token survives uppercasing in both reveal lines.
    expect(stub.split("phantom reveal PAY$&HOOK_WEBHOOK_SECRET").length - 1).toBe(2);

    // Exactly five `$&` sequences survive — one per expansion site. Splicing
    // the match would leave zero `$&` and inject `${provider}` text instead.
    expect(stub.split("$&").length - 1).toBe(5);
    expect(stub).not.toContain("${");

    // Through wiring the name matches no catalog provider: it returns in
    // `skipped` byte-for-byte and never reaches the stub template or disk.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [provider],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("preserves an unknown placeholder and surrounding ordinary text in the stub", () => {
    const stub = webhookStubFor("before${UNKNOWN}after");

    expect(stub).toContain("webhook handler stub for before${UNKNOWN}after.");
    expect(stub).toContain("forge a before${UNKNOWN}after webhook.");
    expect(stub).toContain("handleBefore${UNKNOWN}afterWebhook(req: Request)");
  });

  it("replaces the last placeholder in the template and leaves all preceding text unchanged", () => {
    // The final placeholder site is the secret name in the closing
    // `phantom reveal` line of the TODO. Render with a sentinel, then with a
    // real name: everything before that site must match once the earlier
    // sites are normalized, the site itself must hold the new value, and the
    // fixed tail after it must be identical.
    const sentinel = "zzqsentinel";
    const lastSite = (s: string, p: string) =>
      s.lastIndexOf(`phantom reveal ${p.toUpperCase()}_WEBHOOK_SECRET`);

    for (const provider of ["acme", "pay-hook", "stripe", "github"]) {
      const marked = webhookStubFor(sentinel);
      const real = webhookStubFor(provider);

      const markedAt = lastSite(marked, sentinel);
      const realAt = lastSite(real, provider);
      expect(markedAt).toBeGreaterThan(0);
      expect(realAt).toBeGreaterThan(0);

      // The sentinel is gone from the real render: every site was replaced.
      expect(real).not.toContain(sentinel);

      // The fixed tail after the last placeholder is byte-identical.
      const tail = (s: string, at: number, p: string) =>
        s.slice(at + `phantom reveal ${p.toUpperCase()}_WEBHOOK_SECRET`.length);
      expect(tail(real, realAt, provider)).toBe(tail(marked, markedAt, sentinel));
      expect(tail(real, realAt, provider).endsWith("// }\n")).toBe(true);

      // Text before the last site is the sentinel render with only
      // placeholder values swapped. Known-provider secret names differ from
      // the `<NAME>_WEBHOOK_SECRET` fallback, so compare the prose lines that
      // carry no placeholder.
      const proseOf = (s: string, at: number) =>
        s
          .slice(0, at)
          .split("\n")
          .filter((line) => !line.includes(provider) && !line.includes(sentinel))
          .filter(
            (line) =>
              !/WEBHOOK_SECRET|signature|[Ww]ebhook\(|verif|Stripe|Clerk|Supabase|GitHub/.test(
                line,
              ),
          );
      expect(proseOf(real, realAt)).toEqual(proseOf(marked, markedAt));
    }
  });

  it("inserts placeholder-like text in a provider name literally and never expands it again", () => {
    // The name is data. Text that looks like another slot (`${provider}`,
    // `{{provider}}`, `%s`, a call to a template helper) must land as typed at
    // all five sites, not be substituted a second time.
    for (const provider of [
      "a${provider}b",
      "a{{provider}}b",
      "a%sb",
      "a${webhookSecretKeyFor(provider)}b",
      "a${capitalize(provider)}b",
    ]) {
      const stub = webhookStubFor(provider);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );
      // Exactly one copy of the placeholder text per site: five in total.
      const token = provider.slice(1, -1);
      expect(stub.split(token).length - 1).toBe(3);
      expect(stub.split(token.toUpperCase()).length - 1).toBe(
        token === token.toUpperCase() ? 5 : 2,
      );
    }
  });

  it("preserves a literal dollar sign in a provider name at every expansion site", async () => {
    // A `$` followed by no special character — not `&`, `` ` ``, `'`, a
    // digit, or another `$` — matches no String.replace replacement
    // pattern, and `$0` / `$<name>` match none either without numbered or
    // named captures. Every variant is plain text to carry, but an
    // expansion that special-cased `$` anyway could eat it as a pattern
    // prefix, splice neighboring template text in around it, or strip it.
    expect(webhookStubFor("zzq")).not.toContain("$");
    for (const provider of ["pay$hook", "cost$", "$hook", "$", "pay$0hook", "pay$<name>hook"]) {
      const stub = webhookStubFor(provider);

      // Raw sites: the header and forge lines carry the name verbatim.
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      // `capitalize(provider)` site: only the first letter folds — `$` has
      // no case mapping, so a name that starts with one lands unchanged.
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      // `webhookSecretKeyFor(provider)` sites: every dollar survives
      // uppercasing in both reveal lines.
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      // The template contributes no `$` of its own: each one in the stub is
      // a dollar the name carried into its five expansion sites — none
      // consumed as pattern syntax, none added — and no `${` residue.
      expect(stub.split("$").length - 1).toBe((provider.split("$").length - 1) * 5);
      expect(stub).not.toContain("${");
    }

    // Through wiring a name ending in a literal dollar matches no catalog
    // provider: it returns in `skipped` byte-for-byte and never reaches
    // the stub template or disk.
    const name = "stripe$";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [name],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("ignores a replacement map: an empty provider still yields the empty-slot stub", () => {
    // phantom-wire takes no replacement map. A caller that passes one anyway
    // (e.g. `{ provider: "stripe" }`) must not change the empty-provider output.
    const withMap = (webhookStubFor as (p: string, map: Record<string, string>) => string)("", {
      provider: "stripe",
      "": "stripe",
    });
    expect(withMap).toBe(webhookStubFor(""));
    expect(withMap).not.toContain("stripe");
    const hintWithMap = (verificationHintFor as (p: string, map: Record<string, string>) => string)(
      "",
      { "": "stripe" },
    );
    expect(hintWithMap).toBe("Verify per the provider's documented signature scheme.");
  });

  it("does not render an unused replacement-map value", () => {
    // Extra arguments are ignored: the public renderer only accepts a provider.
    const renderWithExtraMap = webhookStubFor as (
      provider: string,
      map: Record<string, string>,
    ) => string;
    const unusedValue = "UNUSED_REPLACEMENT_SENTINEL";
    const stub = renderWithExtraMap("stripe", { unused: unusedValue });

    expect(stub).toBe(webhookStubFor("stripe"));
    expect(stub).toContain("stripe-signature");
    expect(stub).not.toContain(unusedValue);
  });

  it("leaves each hint template unchanged when extra replacement values are supplied", () => {
    // Every hint is a fixed string with no placeholder to fill. Values a
    // caller supplies anyway — including one keyed `provider`, the name the
    // switch matches on — are unused: the returned text must be the template
    // byte-for-byte with none of the supplied text in it.
    const hintWithValues = verificationHintFor as (
      provider: string,
      values: Record<string, string>,
    ) => string;
    for (const provider of ["stripe", "clerk", "supabase", "github", "zzqhook"]) {
      const hint = hintWithValues(provider, {
        unused: "UNUSED_HINT_SENTINEL",
        provider: "forged provider",
      });
      expect(hint).toBe(verificationHintFor(provider));
      expect(hint).not.toContain("UNUSED_HINT_SENTINEL");
      expect(hint).not.toContain("forged provider");
    }
  });

  it("does not let an extra value keyed like a template input reach the stub", () => {
    // The stub's expansion sites draw only from the `provider` argument —
    // there is no `{{provider}}`-style slot a values map could fill. Keys
    // naming the template's own inputs (the provider, its signature header,
    // secret key and hint) are unused values: the render must stay
    // byte-identical to the argument-only call.
    const renderWithValues = webhookStubFor as (
      provider: string,
      values: Record<string, string>,
    ) => string;
    const stub = renderWithValues("stripe", {
      provider: "clerk",
      signatureHeader: "x-forged-signature",
      webhookSecretKey: "FORGED_WEBHOOK_SECRET",
      verificationHint: "a forged hint",
    });
    expect(stub).toBe(webhookStubFor("stripe"));
    expect(stub).toContain("stripe-signature");
    expect(stub).toContain("STRIPE_WEBHOOK_SECRET");
    expect(stub).toContain("handleStripeWebhook");
    for (const unused of [
      "clerk",
      "x-forged-signature",
      "FORGED_WEBHOOK_SECRET",
      "a forged hint",
    ]) {
      expect(stub).not.toContain(unused);
    }
  });

  it("ignores extra positional values of any type and arity", () => {
    // An extra argument is an unused value whatever its shape — a bare
    // string, a number, an array, a nested map — and however many are
    // passed. The template has no slot for any of them: every call renders
    // byte-identically to the argument-only stub.
    const render = webhookStubFor as (provider: string, ...extra: unknown[]) => string;
    const baseline = webhookStubFor("stripe");
    for (const extra of [
      "forged value",
      42,
      ["forged value"],
      { deep: "forged value" },
      null,
      undefined,
    ]) {
      const stub = render("stripe", extra);
      expect(stub).toBe(baseline);
      expect(stub).not.toContain("forged value");
    }
    expect(render("stripe", "forged value", { deep: "forged value" }, ["x"])).toBe(baseline);
  });

  it("ignores values keyed by placeholder-shaped names the templates lack", () => {
    // Neither template has `${...}`, `{{...}}` or `%s` slots, so a values
    // map keyed by those shapes is entirely unused: supplying it must not
    // splice a value in nor strip placeholder-shaped template text.
    const values = {
      "${provider}": "FORGED_A",
      "{{provider}}": "FORGED_B",
      "%s": "FORGED_C",
      "${webhookSecretKeyFor(provider)}": "FORGED_D",
    };
    const renderWithValues = webhookStubFor as (
      provider: string,
      values: Record<string, string>,
    ) => string;
    const hintWithValues = verificationHintFor as (
      provider: string,
      values: Record<string, string>,
    ) => string;
    const stub = renderWithValues("stripe", values);
    const hint = hintWithValues("github", values);
    expect(stub).toBe(webhookStubFor("stripe"));
    expect(hint).toBe(verificationHintFor("github"));
    for (const forged of Object.values(values)) {
      expect(stub).not.toContain(forged);
      expect(hint).not.toContain(forged);
    }
  });

  it("leaves the stub's fixed text unchanged when no value is supplied for its placeholders", () => {
    // phantom-wire has no values map; the stub's only inputs are the provider
    // slots. An empty provider supplies nothing: each slot collapses to the
    // empty string and every other byte of the template must stay as-is.
    const stub = webhookStubFor("");
    const lines = stub.split("\n");
    expect(lines[0]).toBe("// Auto-generated by `stack apply` — webhook handler stub for .");
    expect(lines).toContain("//   phantom reveal _WEBHOOK_SECRET");
    expect(lines).toContain(
      "// export async function handleWebhook(req: Request): Promise<Response> {",
    );
    expect(lines).toContain('//   const signature = req.headers.get("x-webhook-signature");');
    expect(lines).toContain("//   // Verify per the provider's documented signature scheme.");
    // No placeholder syntax is left behind, nor any undefined/null text.
    expect(stub).not.toMatch(/\$\{|\{\{|undefined|null/);
    // Same line count as a populated stub: nothing added or dropped.
    expect(lines.length).toBe(webhookStubFor("payment").split("\n").length);
    expect(stub.endsWith("// }\n")).toBe(true);
  });

  it("renders an empty provider as the template with every provider slot blank", () => {
    // phantom-wire has no standalone template renderer: webhookStubFor is the
    // only template. Rendering it with nothing to substitute must equal the
    // rendering of a probe provider with that probe's text removed, byte for
    // byte, so no slot is missed, doubled, or filled with a default.
    const probe = "zzprobe";
    const empty = webhookStubFor("");
    const probed = webhookStubFor(probe);
    expect(probed).toContain(probe);
    // Derived slots (secret key, handler name, hint) embed the probe in
    // upper- or title-case; strip every casing before comparing.
    const stripped = probed
      .replaceAll(probe, "")
      .replaceAll(probe.toUpperCase(), "")
      .replaceAll("Zzprobe", "");
    expect(stripped).toBe(empty);
    expect(empty.length).toBeGreaterThan(0);
  });

  it("replaces each known slot with an empty string and keeps the text on both sides exact", () => {
    // Every provider slot sits between fixed text. With an empty provider each
    // one collapses to "" and the neighbouring characters must close up with
    // no stray space, default name, or dropped punctuation.
    const stub = webhookStubFor("");
    expect(stub).toContain("webhook handler stub for .\n// Fill in the secret retrieval");
    expect(stub).toContain("anyone who can POST\n//   // to this endpoint can forge a  webhook.\n");
    expect(stub).toContain("(`phantom reveal _WEBHOOK_SECRET`) and compare in\n");
    expect(stub).toContain("// export async function handleWebhook(req: Request)");
    // Both `phantom reveal` sites carry the same blank-keyed name: nothing
    // else was blanked, and nothing was left filled.
    expect(stub.split("phantom reveal _WEBHOOK_SECRET").length - 1).toBe(2);
    // A known provider only adds text at those slots: removing its values
    // from the known-provider stub yields the empty stub's slots plus the
    // provider-specific hint and header, which are not placeholders.
    const known = webhookStubFor("stripe")
      .replaceAll("STRIPE", "")
      .replaceAll("Stripe", "")
      .replaceAll("stripe", "");
    expect(known).toContain("webhook handler stub for .\n");
    expect(known).toContain("handleWebhook(req: Request)");
  });

  it("substitutes an empty provider to an empty string without throwing", () => {
    // Every provider-derived slot must collapse to "", not "undefined" and
    // not an exception, and the helpers must agree with the rendered stub.
    expect(() => webhookStubFor("")).not.toThrow();
    const stub = webhookStubFor("");
    expect(stub).toContain("webhook handler stub for .\n");
    expect(stub).toContain("forge a  webhook.");
    expect(stub).toContain("phantom reveal _WEBHOOK_SECRET");
    expect(verificationHintFor("")).toBe("Verify per the provider's documented signature scheme.");
    expect(stub).toContain(`// ${verificationHintFor("")}`);
  });

  it("preserves a tab character exactly in placeholder replacement text", () => {
    // Template literal interpolation must carry the tab through untouched —
    // no escaping, no collapsing to spaces, no stripping.
    const provider = "pay\tment";
    const stub = webhookStubFor(provider);
    expect(stub).toContain("webhook handler stub for pay\tment.");
    expect(stub).toContain("forge a pay\tment webhook.");
    expect(stub).toContain("handlePay\tmentWebhook");
    // The tab is a single 0x09 byte, not two spaces or any surrogate.
    const tabIndex = stub.indexOf("\t");
    expect(tabIndex).toBeGreaterThan(-1);
    // The raw bytes around the tab are exactly the surrounding text.
    expect(stub.slice(tabIndex - 3, tabIndex + 5)).toBe("pay\tment");
  });

  it("preserves a newline exactly in placeholder replacement text", () => {
    // Direct template call: the replacement is spliced in verbatim, so the
    // newline stays a single 0x0A byte — no escaping to `\\n`, no `\r\n`,
    // no collapsing to a space, no stripping.
    const provider = "pay\nment";
    const stub = webhookStubFor(provider);
    expect(stub).toContain("webhook handler stub for pay\nment.");
    expect(stub).toContain("forge a pay\nment webhook.");
    expect(stub).toContain("handlePay\nmentWebhook");
    expect(stub).not.toContain("\r");
    expect(stub).not.toContain("\\n");
    // Five slots carry the name: two raw `${provider}`, one capitalized, and
    // two upper-cased secret names. Each adds exactly one line break over the
    // newline-free stub.
    const plain = webhookStubFor("payment");
    expect(stub.split("\n").length - plain.split("\n").length).toBe(5);
    // Joining the split pieces restores the plain stub, so nothing but the
    // newline itself differs.
    const restored = stub
      .replaceAll("PAY\nMENT", "PAYMENT")
      .replaceAll("Pay\nment", "Payment")
      .replaceAll("pay\nment", "payment");
    expect(restored).toBe(plain);
  });

  it("preserves every line and its order throughout a multiline replacement", () => {
    const provider = "alpha\nsecond line\nthird line";
    const expected = webhookStubFor("marker")
      .replaceAll("MARKER", "ALPHA\nSECOND LINE\nTHIRD LINE")
      .replaceAll("Marker", "Alpha\nsecond line\nthird line")
      .replaceAll("marker", "alpha\nsecond line\nthird line");

    // Compare the entire output, including the text around all five slots.
    expect(webhookStubFor(provider)).toBe(expected);
  });

  it("preserves leading, trailing and consecutive newlines in a replacement", () => {
    // Edge positions must not be trimmed, and a blank line must not collapse.
    const plain = webhookStubFor("x");
    for (const provider of ["\nx", "x\n", "x\n\nx"]) {
      const stub = webhookStubFor(provider);
      const extra = (provider.match(/\n/g) ?? []).length * 5;
      expect(stub.split("\n").length - plain.split("\n").length).toBe(extra);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).not.toContain("\r");
    }
  });

  it("keeps a leading and a trailing newline together in every slot, and the template's own edges fixed", () => {
    // Both edge newlines at once: `\nx\n` must expand to `\nx\n` at all five
    // slots (upper- and capitalized forms included) with neither trimmed.
    const provider = "\npay\n";
    const stub = webhookStubFor(provider);
    expect(stub).toContain("webhook handler stub for \npay\n.");
    expect(stub).toContain("forge a \npay\n webhook.");
    expect(stub).toContain("handle\npay\nWebhook(req: Request)");
    expect(stub.split("phantom reveal \nPAY\n_WEBHOOK_SECRET").length - 1).toBe(2);
    expect(stub).not.toContain("\r");

    // Each slot adds exactly two line breaks over the newline-free stub, and
    // stripping the name's newlines restores that stub exactly.
    const plain = webhookStubFor("pay");
    expect(stub.split("\n").length - plain.split("\n").length).toBe(10);
    // `capitalize` sees `\n` first, so the handler name keeps a lowercase `p`.
    const restored = stub
      .replaceAll("\nPAY\n", "PAY")
      .replaceAll("handle\npay\nWebhook", "handlePayWebhook")
      .replaceAll("\npay\n", "pay");
    expect(restored).toBe(plain);

    // The template's own edges do not depend on the name: it never opens with
    // a newline and always closes with exactly one.
    for (const p of ["pay", provider, "x\n"]) {
      const s = webhookStubFor(p);
      expect(s.startsWith("// Auto-generated")).toBe(true);
      expect(s.endsWith("// }\n")).toBe(true);
      expect(s.endsWith("\n\n")).toBe(false);
    }
  });

  it("carries a tab through every expansion site and the skipped result byte-for-byte", async () => {
    // The name fills five slots: two raw `${provider}` (the generated-by and
    // forge lines), one `capitalize(provider)` (the handler name), and two
    // `webhookSecretKeyFor(provider)`, which uppercases the whole name —
    // U+0009 has no case mapping, so the tab must survive there too.
    const provider = "svc\thooks";
    const stub = webhookStubFor(provider);

    expect(stub).toContain("webhook handler stub for svc\thooks.");
    expect(stub).toContain("forge a svc\thooks webhook.");
    expect(stub).toContain("handleSvc\thooksWebhook(req: Request)");
    expect(stub.split("phantom reveal SVC\tHOOKS_WEBHOOK_SECRET").length - 1).toBe(2);

    // The template contributes no tabs of its own, so the stub's tabs are
    // exactly the five the name carried into its sites — none escaped,
    // collapsed to spaces, duplicated, or dropped.
    expect(webhookStubFor("zzq")).not.toContain("\t");
    expect(stub.split("\t").length - 1).toBe(5);

    // Through wiring the name matches no catalog provider: it returns in
    // `skipped` with the tab byte intact and never reaches a stub or disk.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
    expect(result.skipped[0]?.charCodeAt(3)).toBe(0x09);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("treats a known provider name wrapped in tabs as data, not as the known provider", async () => {
    // "stripe" is a catalog provider; "\tstripe\t" is not. Both tabs must
    // survive byte-for-byte in the stub and in `skipped` — never trimmed into
    // a match that would wire real secrets or write a webhook stub to disk.
    const provider = "\tstripe\t";
    expect(verificationHintFor(provider)).toBe(verificationHintFor("zzq"));
    expect(verificationHintFor(provider)).not.toBe(verificationHintFor("stripe"));

    const stub = webhookStubFor(provider);
    expect(stub).toContain(`webhook handler stub for ${provider}.`);
    expect(stub).toContain(`forge a ${provider} webhook.`);
    expect(stub).toContain("handle\tstripe\tWebhook(req: Request)");
    expect(stub.split("phantom reveal \tSTRIPE\t_WEBHOOK_SECRET").length - 1).toBe(2);
    // Exactly two tabs per site, five sites; none added, dropped or folded.
    expect(stub.split("\t").length - 1).toBe(10);

    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
    expect(result.skipped[0]?.charCodeAt(0)).toBe(0x09);
    expect(result.skipped[0]?.charCodeAt(7)).toBe(0x09);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("carries a tab adjacent to a known placeholder through every expansion site", async () => {
    // `${provider}` is the template's own slot name; arriving inside a name
    // it is data. A 0x09 byte parked against it must survive expansion —
    // not stripped as stray whitespace, folded to spaces, or lost when a
    // second substitution pass re-expands the placeholder-shaped text into
    // `pay\tpay\t${provider}mentment`. Variants put the tab before, after,
    // and on both sides of the token; each carries exactly one `${provider}`.
    for (const provider of [
      "pay\t${provider}ment",
      "pay${provider}\tment",
      "pay\t${provider}\tment",
      "\t${provider}",
    ]) {
      const stub = webhookStubFor(provider);

      // Direct `${provider}` slots: name and tab verbatim.
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      // `capitalize(provider)` slot: only the first letter folds — a leading
      // tab has no case mapping, so the name there is unchanged.
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      // `webhookSecretKeyFor(provider)` slots: the whole name uppercases —
      // tab and placeholder-shaped text included — in both reveal lines.
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      // The template contributes no tabs and no `${` of its own: every tab
      // and `${` in the stub is one the name carried into a site — five
      // sites each — none escaped, collapsed, stripped, or re-expanded.
      expect(stub.split("\t").length - 1).toBe((provider.split("\t").length - 1) * 5);
      expect(stub.split("${").length - 1).toBe(5);
      // The placeholder-shaped text survives once per site: lowercase at the
      // three mixed-case sites, uppercased at the two secret-key sites.
      expect(stub.split("${provider}").length - 1).toBe(3);
      expect(stub.split("${PROVIDER}").length - 1).toBe(2);
    }
    expect(webhookStubFor("zzq")).not.toContain("\t");

    // Through wiring the name matches no catalog provider: it returns in
    // `skipped` byte-for-byte — tab byte intact — and never reaches disk.
    const provider = "pay\t${provider}ment";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
    expect(result.skipped[0]?.charCodeAt(3)).toBe(0x09);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("carries a newline adjacent to a known placeholder through every expansion site", async () => {
    // `${provider}` is the template's own slot name; arriving inside a name
    // it is data. A 0x0A byte parked against it must survive expansion — not
    // stripped as a stray line break, folded to a space, or lost when a
    // second substitution pass re-expands the placeholder-shaped text into
    // `pay\npay\n${provider}mentment`. Variants put the newline before,
    // after, and on both sides of the token; each carries exactly one
    // `${provider}`.
    const plain = webhookStubFor("zzq");
    for (const provider of [
      "pay\n${provider}ment",
      "pay${provider}\nment",
      "pay\n${provider}\nment",
      "\n${provider}",
    ]) {
      const stub = webhookStubFor(provider);

      // Direct `${provider}` slots: name and newline verbatim.
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      // `capitalize(provider)` slot: only the first letter folds — a leading
      // newline has no case mapping, so the name there is unchanged.
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      // `webhookSecretKeyFor(provider)` slots: the whole name uppercases —
      // newline and placeholder-shaped text included — in both reveal lines.
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      // The template contributes no `${` of its own: every `${` in the stub
      // is one the name carried into a site — five sites — none escaped,
      // stripped, or re-expanded.
      expect(stub.split("${").length - 1).toBe(5);
      // The placeholder-shaped text survives once per site: lowercase at the
      // three mixed-case sites, uppercased at the two secret-key sites.
      expect(stub.split("${provider}").length - 1).toBe(3);
      expect(stub.split("${PROVIDER}").length - 1).toBe(2);
      // Each newline the name carried lands as a lone 0x0A: exactly
      // newlines-per-name × five added line breaks, and no `\r` introduced.
      expect(stub.split("\n").length - plain.split("\n").length).toBe(
        (provider.split("\n").length - 1) * 5,
      );
      expect(stub).not.toContain("\r");
    }

    // Through wiring the name matches no catalog provider: it returns in
    // `skipped` byte-for-byte — newline byte intact — and never reaches a
    // stub or disk.
    const provider = "pay\n${provider}ment";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
    expect(result.skipped[0]?.charCodeAt(3)).toBe(0x0a);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("preserves the leading zeroes of a numeric-looking name at every expansion site", async () => {
    // A name like "007" must stay a string: no Number() coercion (7), no
    // zero-trimming, no reformatting. Digits have no case mapping, so the
    // capitalized and upper-cased slots carry it unchanged too.
    for (const provider of ["007", "0042", "00", "0.50", "0x10", "1e3"]) {
      const stub = webhookStubFor(provider);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub).toContain(`handle${provider}Webhook(req: Request)`);
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
      expect(typeof result.skipped[0]).toBe("string");
    }
  });

  it("carries a carriage return through every expansion site and the skipped result byte-for-byte", async () => {
    // U+000D in the name is data, not a line ending: interpolation must
    // carry it through untouched — no conversion to `\n`, no `\r\n`
    // pairing, no stripping. The name fills five slots: two raw
    // `${provider}` (the generated-by and forge lines), one
    // `capitalize(provider)` (the handler name), and two
    // `webhookSecretKeyFor(provider)`, which uppercases the whole name —
    // U+000D has no case mapping, so the CR survives there too.
    const provider = "svc\rhooks";
    const stub = webhookStubFor(provider);

    expect(stub).toContain("webhook handler stub for svc\rhooks.");
    expect(stub).toContain("forge a svc\rhooks webhook.");
    expect(stub).toContain("handleSvc\rhooksWebhook(req: Request)");
    expect(stub.split("phantom reveal SVC\rHOOKS_WEBHOOK_SECRET").length - 1).toBe(2);

    // The template contributes no `\r` of its own, so the stub's carriage
    // returns are exactly the five the name carried into its sites — each a
    // lone 0x0D byte, never a `\r\n` pair or a translated `\n` (the `\n`
    // count stays identical to a name carrying no CR).
    expect(webhookStubFor("zzq")).not.toContain("\r");
    expect(stub.split("\r").length - 1).toBe(5);
    expect(stub).not.toContain("\r\n");
    expect(stub.split("\n")).toHaveLength(webhookStubFor("zzq").split("\n").length);
    const crIndex = stub.indexOf("\r");
    expect(stub.charCodeAt(crIndex)).toBe(0x0d);
    expect(stub.slice(crIndex - 3, crIndex + 6)).toBe("svc\rhooks");

    // Through wiring the name matches no catalog provider: it returns in
    // `skipped` with the CR byte intact and never reaches a stub or disk,
    // where a `\r` would end the `//` comment line for tools that treat it
    // as a line terminator.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
    expect(result.skipped[0]?.charCodeAt(3)).toBe(0x0d);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("preserves a CRLF pair exactly in every expansion site and the skipped result", async () => {
    // U+000D U+000A in the name is data: both bytes survive as a pair — no
    // collapsing to `\n`, no splitting, no stripping of either character.
    const provider = "svc\r\nhooks";
    const stub = webhookStubFor(provider);
    const plain = webhookStubFor("zzq");

    expect(stub).toContain("webhook handler stub for svc\r\nhooks.");
    expect(stub).toContain("forge a svc\r\nhooks webhook.");
    expect(stub).toContain("handleSvc\r\nhooksWebhook(req: Request)");
    expect(stub.split("phantom reveal SVC\r\nHOOKS_WEBHOOK_SECRET").length - 1).toBe(2);

    // Five slots carry the name, so exactly five CRs and five LFs were added,
    // and every CR is immediately followed by its LF.
    expect(plain).not.toContain("\r");
    expect(stub.split("\r").length - 1).toBe(5);
    expect(stub.split("\r\n").length - 1).toBe(5);
    expect(stub.split("\n").length - plain.split("\n").length).toBe(5);
    // Removing the pairs restores the stub for the joined name.
    expect(stub.replaceAll("\r\n", "")).toBe(webhookStubFor("svchooks"));

    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [provider] });
    expect(result.skipped[0]?.slice(3, 5)).toBe("\r\n");
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("keeps both characters of a CRLF at the edges, doubled, and apart from a lone CR or LF", () => {
    // Leading, trailing and consecutive pairs must not be trimmed or collapsed,
    // and a CRLF must stay distinguishable from a lone LF then CR.
    const plain = webhookStubFor("x");
    for (const provider of ["\r\nx", "x\r\n", "x\r\n\r\nx"]) {
      const stub = webhookStubFor(provider);
      const pairs = (provider.match(/\r\n/g) ?? []).length;
      expect(stub.split("\r\n").length - 1).toBe(pairs * 5);
      expect(stub.split("\r").length - 1).toBe(pairs * 5);
      expect(stub.split("\n").length - plain.split("\n").length).toBe(pairs * 5);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
    }
    // LF then CR is not a CRLF pair and must not be reordered into one.
    const swapped = webhookStubFor("a\n\rb");
    expect(swapped).toContain("stub for a\n\rb.");
    expect(swapped).not.toContain("\r\n");
    // The hint is a fixed string: a CRLF name never leaks into it.
    expect(verificationHintFor("svc\r\nhooks")).toBe(verificationHintFor("zzq"));
  });

  it("keeps a CRLF pair whole beside String.replace patterns and splits only at the pair", () => {
    // A CRLF next to `$&`, `$$` or `$1` is still plain data: the `$` text and
    // both line-ending characters all survive, in order, in every slot.
    const plain = webhookStubFor("x");
    for (const provider of ["a$&\r\nb", "a\r\n$$b", "$1\r\n$'", "a\r\n$`b"]) {
      const stub = webhookStubFor(provider);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub.split("\r\n").length - 1).toBe(5);
      expect(stub.split("\r").length - 1).toBe(5);
      expect(stub.split("\n").length - plain.split("\n").length).toBe(5);
    }
    // Splitting the stub on CRLF yields the name's two halves around each
    // pair, with the first half ending the line the pair interrupts.
    const parts = webhookStubFor("left\r\nright").split("\r\n");
    expect(parts).toHaveLength(6);
    expect(parts[0]?.endsWith("webhook handler stub for left")).toBe(true);
    expect(parts[1]?.startsWith("right.")).toBe(true);
  });

  it("retains a standalone carriage return exactly wherever it lands in a replacement", async () => {
    // A `\r` with no `\n` attached — alone as the whole value, at the edges,
    // or doubled — is data, not a line ending. Each one must land as a lone
    // 0x0D byte at every expansion site: never paired into `\r\n`, never
    // translated to `\n`, never trimmed, collapsed, or dropped.
    const plain = webhookStubFor("x");
    expect(plain).not.toContain("\r");
    for (const provider of ["\r", "\rx", "x\r", "x\r\rx"]) {
      const stub = webhookStubFor(provider);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      // Exactly the name's CRs times the five expansion sites, and each one
      // stays standalone: the stub's LF count is the plain stub's (no CR was
      // turned into an LF) and no CR gained an LF neighbor in either order.
      const crs = provider.split("\r").length - 1;
      expect(stub.split("\r").length - 1).toBe(crs * 5);
      expect(stub).not.toContain("\r\n");
      expect(stub).not.toContain("\n\r");
      expect(stub.split("\n")).toHaveLength(plain.split("\n").length);
      for (let i = stub.indexOf("\r"); i !== -1; i = stub.indexOf("\r", i + 1)) {
        expect(stub.charCodeAt(i)).toBe(0x0d);
        expect(stub.charCodeAt(i - 1)).not.toBe(0x0a);
        expect(stub.charCodeAt(i + 1)).not.toBe(0x0a);
      }
    }

    // Through wiring a name ending in a lone CR matches no catalog provider
    // (the lookup compares exact bytes — no trimming): it returns in
    // `skipped` with the CR byte intact and never reaches a stub or disk.
    const name = "stripe\r";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [name] });
    expect(result.skipped[0]?.charCodeAt(6)).toBe(0x0d);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("preserves leading and trailing spaces in replacement text at every expansion site", async () => {
    // A U+0020 at an edge of the name is data, not padding: interpolation
    // must carry each space through untouched — never trimmed, collapsed to
    // one, or stripped — at all five expansion sites (the header and forge
    // lines raw, the `capitalize(provider)` handler name, and both
    // uppercased `webhookSecretKeyFor` reveal lines). Spaces have no case
    // mapping, so a leading space also blocks the first letter's fold.
    const plain = webhookStubFor("marker");
    // Deriving the expected stub from a probe name splices the provider into
    // the same five slots, so a trim or collapse anywhere — not just at the
    // checked substrings — would make the whole-stub comparison fail.
    const expectedFor = (provider: string) =>
      plain
        .replaceAll("MARKER", provider.toUpperCase())
        .replaceAll("Marker", provider[0].toUpperCase() + provider.slice(1))
        .replaceAll("marker", provider);

    for (const provider of [" svc", "svc ", " svc ", "  svc  ", " ", "a  b"]) {
      const stub = webhookStubFor(provider);
      expect(stub).toBe(expectedFor(provider));
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );
      // Spaces are not newlines: the stub keeps the plain name's shape.
      expect(stub.split("\n")).toHaveLength(plain.split("\n").length);
    }

    // Byte-level edge check: flush against the template's own spaces, an
    // edge space shows as a doubled 0x20 gap a trimmed expansion would not
    // produce — and the leading space leaves `svc` lowercase in the
    // handler name because `capitalize` can only fold the name's first byte.
    const edged = webhookStubFor(" svc ");
    expect(edged).toContain("webhook handler stub for  svc .");
    expect(edged).toContain("forge a  svc  webhook.");
    expect(edged).toContain("handle svc Webhook(req: Request)");
    expect(edged.split("phantom reveal  SVC _WEBHOOK_SECRET").length - 1).toBe(2);
    // `slot` is the name's first byte inside the header line: 0x20, `svc`,
    // 0x20, then the template's `.` — with the template's own space right
    // before it, the pair reads as the doubled gap.
    const slot = edged.indexOf("stub for ") + "stub for ".length;
    expect(edged.charCodeAt(slot - 1)).toBe(0x20);
    expect(edged.charCodeAt(slot)).toBe(0x20);
    expect(edged.charCodeAt(slot + 4)).toBe(0x20);
    expect(edged.charCodeAt(slot + 5)).toBe(0x2e);

    // Through wiring a space-padded name matches no catalog provider (the
    // lookup compares exact bytes — no trimming): it returns in `skipped`
    // byte-for-byte — both edge spaces intact — and never reaches disk.
    const name = " stripe ";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [name] });
    expect(result.skipped[0]?.charCodeAt(0)).toBe(0x20);
    expect(result.skipped[0]?.charCodeAt(name.length - 1)).toBe(0x20);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);

    // The hint is a fixed string: a space-padded name never leaks into it.
    expect(verificationHintFor(" svc ")).toBe(verificationHintFor("zzq"));
  });

  it("preserves a single quote in a provider name literally in the stub and in skipped results", async () => {
    // `'` is inert inside the generated `//` comments, and `$'` is the one
    // String.replace replacement pattern (splice in the text after the match)
    // the dollar-signs test above does not exercise: if expansion ever ran
    // through replace, `$'` would pull trailing template text into the name.
    // Carried verbatim, the quote is just data at every expansion site.
    const provider = "pay'ment$'s";
    const stub = webhookStubFor(provider);
    expect(stub).toContain(`webhook handler stub for ${provider}.`);
    expect(stub).toContain(`forge a ${provider} webhook.`);
    expect(stub).toContain(
      `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
    );
    expect(stub).toContain(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`);
    // The quote never escapes into live code: every line stays a comment.
    expect(stub.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
    expect(stub).not.toContain("${");

    // The name's quotes land at all five expansion sites — raw in the header
    // and forge lines, capitalized in the handler name, uppercased in the two
    // reveal lines — on top of the template's own apostrophe ("provider's").
    const nameQuotes = provider.split("'").length - 1;
    const templateQuotes = webhookStubFor("zzq").split("'").length - 1;
    expect(stub.split("'").length - 1).toBe(templateQuotes + nameQuotes * 5);

    // Through wiring a quoted name matches no catalog provider: it returns in
    // `skipped` byte-for-byte and never reaches the stub template or disk.
    const name = "stripe'";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [name],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("preserves single and double quotes in a provider name literally at every expansion site", async () => {
    // `'` and `"` are both inert inside the generated `//` comments: neither
    // can end a line comment, and the stub holds no string literal a quote
    // could escape out of. Interpolation must carry each through untouched —
    // no `\"`/`\'` escaping, no `&quot;`-style entity encoding, no stripping
    // or doubling — at all five expansion sites (header line, forge line,
    // capitalized handler name, two uppercased reveal lines).
    const baseline = webhookStubFor("zzq");
    const templateDoubles = baseline.split('"').length - 1;
    const templateSingles = baseline.split("'").length - 1;
    for (const provider of ['pay"ment', '"quoted"', "it's", `a'b"c`, `'pay"co'`]) {
      const stub = webhookStubFor(provider);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      // The stub holds exactly the template's own quotes plus the ones the
      // name carried into its five sites — none escaped, encoded, or dropped.
      expect(stub.split('"').length - 1).toBe(
        templateDoubles + (provider.split('"').length - 1) * 5,
      );
      expect(stub.split("'").length - 1).toBe(
        templateSingles + (provider.split("'").length - 1) * 5,
      );
      expect(stub).not.toContain('\\"');
      expect(stub).not.toContain("\\'");
      expect(stub).not.toContain("&quot;");
      expect(stub).not.toContain("&apos;");
      expect(stub).not.toContain("&#34;");
      expect(stub).not.toContain("&#39;");
      // Every line stays a comment: a quote can never break out into code.
      expect(stub.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
    }

    // Through wiring a name carrying both quote kinds matches no catalog
    // provider: it returns in `skipped` byte-for-byte — U+0027 then U+0022 —
    // and never reaches the stub template or disk.
    const name = `stripe'"`;
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [name] });
    expect(result.skipped[0]?.charCodeAt(6)).toBe(0x27);
    expect(result.skipped[0]?.charCodeAt(7)).toBe(0x22);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("keeps the verification warning ahead of any use of the unverified body", () => {
    for (const provider of ["stripe", "clerk", "supabase", "github"]) {
      const stub = webhookStubFor(provider);
      const bodyRead = stub.indexOf("const body = await req.text()");
      const warning = stub.indexOf("TODO(security): signature verification is NOT implemented");
      const unauthenticated = stub.indexOf("unauthenticated, attacker-controlled input");
      const verifyThenTrust = stub.indexOf("and only then");
      const ok = stub.indexOf('return new Response("ok"');

      expect(bodyRead).toBeGreaterThan(-1);
      // The warning lands right after the body is read, before the stub returns.
      expect(warning).toBeGreaterThan(bodyRead);
      expect(unauthenticated).toBeGreaterThan(warning);
      expect(verifyThenTrust).toBeGreaterThan(unauthenticated);
      expect(ok).toBeGreaterThan(verifyThenTrust);
      // Header-level notice: the whole example is inert and does not verify.
      expect(stub).toContain("does not verify signatures");
      expect(stub).toContain("constant time");
      expect(stub).toContain("raw body");
      // Every code line stays commented out, so nothing runs unverified.
      for (const line of stub.split("\n").filter((l) => l.trim())) {
        expect(line.startsWith("//")).toBe(true);
      }
    }
  });

  it("replaces an existing webhook stub when wiring is repeated", async () => {
    const first = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    const stubPath = first.webhooks[0];
    const generated = readFileSync(stubPath, "utf-8");
    writeFileSync(stubPath, "custom handler");

    const second = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(second.webhooks).toEqual([stubPath]);
    expect(readFileSync(stubPath, "utf-8")).toBe(generated);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("wires an altered local recipe without authenticating its contents", async () => {
    const path = await writeRecipe(STRIPE_RECIPE, harness.dir);
    const original = readFileSync(path, "utf-8");
    expect(original).toContain("stripe");
    writeFileSync(path, original.replace('stripe"', 'github"'));

    const recipe = await readRecipe(STRIPE_RECIPE.id, harness.dir);
    expect(recipe.providers).toEqual([{ name: "github" }]);
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.missing).toContain("github:GITHUB_TOKEN");
    expect(result.webhooks).toEqual([join(harness.dir, ".stack/webhooks/github.ts")]);
  });

  it("generates a commented request handler and response for every webhook provider", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: providers.map((name) => ({ name })),
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.webhooks).toEqual(
      providers.map((provider) => join(harness.dir, ".stack/webhooks", `${provider}.ts`)),
    );

    for (const [index, provider] of providers.entries()) {
      const stub = readFileSync(result.webhooks[index], "utf-8");
      const handlerName = `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`;
      const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
      expect(example).toBeDefined();
      expect(example).toContain(
        `// export async function ${handlerName}(req: Request): Promise<Response> {`,
      );
      expect(example).toContain('//   return new Response("ok", { status: 200 });');
    }
  });

  it.each([
    [false, ["github", "stripe"]],
    [false, ["stripe", "github"]],
    [true, ["github", "stripe"]],
    [true, ["stripe", "github"]],
  ])(
    "generates two examples in input order (Phantom unavailable: %s)",
    async (unavailable, providers) => {
      if (unavailable) {
        writeFileSync(join(harness.dir, "phantom"), "#!/usr/bin/env bash\nexit 1\n");
      }
      const recipe: Recipe = {
        ...STRIPE_RECIPE,
        providers: providers.map((name) => ({ name })),
      };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });

      expect(result.webhooks).toEqual(
        providers.map((name) => join(harness.dir, ".stack/webhooks", `${name}.ts`)),
      );
      const examples = result.webhooks.map((path) => readFileSync(path, "utf-8")).join("\n");
      expect(
        [...examples.matchAll(/^\/\/ export async function (handle\w+Webhook)\(/gm)].map(
          (m) => m[1],
        ),
      ).toEqual(providers.map((name) => `handle${name[0].toUpperCase()}${name.slice(1)}Webhook`));
    },
  );

  it("keeps the verification review aligned with the generated webhook examples", async () => {
    const review = readFileSync(
      new URL("../../../../docs/phantom-wire-review.md", import.meta.url),
      "utf-8",
    );
    expect(review).toContain("Recipe signature verification is **not implemented**");
    expect(review).toContain("Webhook signature verification is **not implemented**");
    expect(review).toContain("any non-empty value");

    const providers = ["stripe", "clerk", "supabase", "github"];
    const result = await wirePhantomForRecipe(
      { ...STRIPE_RECIPE, providers: providers.map((name) => ({ name })) },
      { cwd: harness.dir },
    );
    for (const [index, provider] of providers.entries()) {
      const stub = readFileSync(result.webhooks[index], "utf-8");
      const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
      const secret = stub.match(/phantom reveal ([A-Z_]+)/)?.[1];
      expect(header).toBeDefined();
      expect(secret).toBeDefined();
      const row = review
        .split("\n")
        .find((line) => line.toLowerCase().startsWith(`| ${provider} |`));
      expect(row).toContain(`\`${header}\``);
      expect(row).toContain(`\`${secret}\``);
    }
  });

  it("keeps the example boundary note's excerpt identical to the generated Stripe example", async () => {
    const note = readFileSync(
      new URL("../../../../docs/phantom-wire-example-boundary.md", import.meta.url),
      "utf-8",
    );
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    const stub = readFileSync(result.webhooks[0], "utf-8");
    const excerpt = note.match(/```ts\n([\s\S]*?)```/)?.[1] ?? "";
    expect(excerpt.length).toBeGreaterThan(0);
    // Every quoted line is a comment line present verbatim in the generated file.
    for (const line of excerpt.trimEnd().split("\n")) {
      expect(line.startsWith("//")).toBe(true);
      expect(stub).toContain(line);
    }
    expect(note).toContain("TODO in an example");
    expect(note).toContain("not a verifier");
  });

  it("keeps the example review's source references pointing at the cited lines", () => {
    const review = readFileSync(
      new URL("../../../../docs/phantom-wire-example-review.md", import.meta.url),
      "utf-8",
    );
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    ).split("\n");
    const rows = [...review.matchAll(/\| ([\d, -]+) \| `([^`]+)` \|$/gm)];
    // 9 assumptions + 4 open items.
    expect(rows).toHaveLength(13);
    for (const [, ranges, anchor] of rows) {
      const found = ranges!.split(",").some((range) => {
        const [start, end = start] = range.trim().split("-").map(Number);
        return source.slice(start! - 1, end).some((line) => line.includes(anchor!));
      });
      expect(found, `"${anchor}" not within lines ${ranges}`).toBe(true);
    }
  });

  it("keeps the signature review aligned with the commented follow-up and active code", async () => {
    const review = readFileSync(
      new URL("../../../../docs/phantom-wire-signature-review.md", import.meta.url),
      "utf-8",
    );
    // The review must quote the follow-up verbatim and classify it as comment
    // text, distinct from the module's active behavior.
    expect(review).toContain("TODO(security): signature verification is NOT implemented here.");
    expect(review.toLowerCase()).toContain("commented signature-verification follow-up");
    expect(review).toContain("## Active behavior");

    const providers = ["stripe", "clerk", "supabase", "github"];
    const result = await wirePhantomForRecipe(
      { ...STRIPE_RECIPE, providers: providers.map((name) => ({ name })) },
      { cwd: harness.dir },
    );
    for (const [index, provider] of providers.entries()) {
      const stub = readFileSync(result.webhooks[index], "utf-8");
      const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
      const secret = stub.match(/phantom reveal ([A-Z_]+)/)?.[1];
      const hint = stub.match(/\/\/ {3}\/\/ (.+)\n\/\/ {3}\/\/ Verify over/)?.[1];
      const hintTokens = [...(hint ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      expect(hintTokens.length).toBeGreaterThan(0);
      const row = review
        .split("\n")
        .find((line) => line.toLowerCase().startsWith(`| ${provider} |`));
      expect(row).toContain(`\`${header}\``);
      expect(row).toContain(`\`${secret}\``);
      for (const token of hintTokens) expect(row).toContain(`\`${token}\``);
    }
  });

  it.each([
    ["stripe", "handleStripeWebhook"],
    ["clerk", "handleClerkWebhook"],
    ["supabase", "handleSupabaseWebhook"],
    ["github", "handleGithubWebhook"],
  ])("returns the unsigned %s response without reading the body", async (provider, name) => {
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    const stub = readFileSync(result.webhooks[0], "utf-8");
    const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
    if (!example) throw new Error(`Missing ${provider} webhook example`);
    const examplePath = join(harness.dir, `${provider}-unsigned-example.ts`);
    writeFileSync(examplePath, example.replace(/^\/\/ ?/gm, ""));
    const handler: unknown = (await import(examplePath))[name];
    if (typeof handler !== "function") throw new Error(`Missing ${name}`);

    const request = new Request("https://example.com", {
      method: "POST",
      body: "untrusted webhook payload",
    });
    const response: Response = await handler(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Missing signature");
    expect(request.bodyUsed).toBe(false);
  });

  it.each([
    ["stripe", "stripe-signature", "handleStripeWebhook"],
    ["clerk", "svix-signature", "handleClerkWebhook"],
    ["supabase", "x-supabase-signature", "handleSupabaseWebhook"],
    ["github", "x-hub-signature-256", "handleGithubWebhook"],
  ])("rejects missing signatures and interrupted %s requests", async (provider, header, name) => {
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.webhooks).toHaveLength(1);

    const stub = readFileSync(result.webhooks[0], "utf-8");
    expect(stub.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
    expect(stub).toContain("This entire example is commented out and does not verify signatures.");
    expect(stub).toContain(
      "If uncommented as-is, it accepts any non-empty signature header and returns\n" +
        "// 200 without authenticating the request. Implement verification first.",
    );
    const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
    if (!example) throw new Error(`Missing ${provider} webhook example`);
    expect(example).toContain(
      "//   // TODO(security): signature verification is NOT implemented here. The\n" +
        "//   // header check above proves only that a signature header arrived; its\n" +
        "//   // value is never compared to anything.",
    );
    expect(example).toContain(
      `//   // is unauthenticated, attacker-controlled input — anyone who can POST\n//   // to this endpoint can forge a ${provider} webhook.`,
    );
    expect(example).toContain(
      "//   // constant time; reject missing or invalid signatures, and only then\n" +
        "//   // parse, trust, or act on the body.",
    );
    const examplePath = join(harness.dir, `${provider}-example.ts`);
    writeFileSync(examplePath, example.replace(/^\/\/ ?/gm, ""));
    const handler: unknown = (await import(examplePath))[name];
    expect(typeof handler).toBe("function");
    if (typeof handler !== "function") throw new Error(`Missing ${name}`);

    const missingHeaders: HeadersInit[] = [
      {},
      { "x-unrelated-signature": "present" },
      { [header]: "" },
    ];
    for (const headers of missingHeaders) {
      const response: Response = await handler(new Request("https://example.com", { headers }));
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing signature");
    }

    // A non-empty header reaches the placeholder; it is not signature verification.
    const response: Response = await handler(
      new Request("https://example.com", {
        method: "POST",
        headers: { [header]: "placeholder" },
        body: "unverified webhook payload",
      }),
    );
    expect(response.status).toBe(200);

    const networkError = new Error("request body connection lost");
    const interruptedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(networkError);
      },
    });
    const interruptedRequest = new Request("https://example.com", {
      method: "POST",
      headers: { [header]: "placeholder" },
      body: interruptedBody,
    });
    await expect(handler(interruptedRequest)).rejects.toBe(networkError);
  });

  it.each([
    ["stripe", "stripe-signature", "handleStripeWebhook"],
    ["clerk", "svix-signature", "handleClerkWebhook"],
    ["supabase", "x-supabase-signature", "handleSupabaseWebhook"],
    ["github", "x-hub-signature-256", "handleGithubWebhook"],
  ])(
    "returns the successful %s webhook response after reading the body",
    async (provider, header, name) => {
      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      const stub = readFileSync(result.webhooks[0], "utf-8");
      const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
      if (!example) throw new Error(`Missing ${provider} webhook example`);
      const examplePath = join(harness.dir, `${provider}-success-example.ts`);
      writeFileSync(examplePath, example.replace(/^\/\/ ?/gm, ""));
      const handler: unknown = (await import(examplePath))[name];
      if (typeof handler !== "function") throw new Error(`Missing ${name}`);

      const request = new Request("https://example.com", {
        method: "POST",
        headers: { [header]: "placeholder" },
        body: "unverified webhook payload",
      });
      const response: Response = await handler(request);
      expect(request.bodyUsed).toBe(true);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    },
  );

  it.each(["stripe", "clerk", "supabase", "github"])(
    "places the signature verification TODO before trusting the %s webhook body",
    async (provider) => {
      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      expect(result.webhooks).toHaveLength(1);
      const stub = readFileSync(result.webhooks[0], "utf-8");
      const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
      if (!example) throw new Error(`Missing ${provider} webhook example`);

      // Reading the raw body supplies an input to verification; no executable
      // handling of it should appear before the verification reminder.
      expect(example).toContain(
        "//   const body = await req.text();\n" +
          "//   // TODO(security): signature verification is NOT implemented here.",
      );
      const todo = example.indexOf("TODO(security): signature verification is NOT implemented");
      const success = example.indexOf('return new Response("ok", { status: 200 })');
      expect(todo).toBeGreaterThanOrEqual(0);
      expect(success).toBeGreaterThan(todo);
    },
  );

  it.each(["stripe", "clerk", "supabase", "github"])(
    "retains a visible verification reminder before trusting the %s body when uncommented",
    async (provider) => {
      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      const stub = readFileSync(result.webhooks[0], "utf-8");
      const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
      if (!example) throw new Error(`Missing ${provider} webhook example`);

      // Uncommenting the example for deployment must not erase the reminder:
      // every line between capturing the body and returning "ok" stays a
      // comment, so the warning remains visible and nothing executable
      // trusts `body` before the TODO is done.
      const runnable = example.replace(/^\/\/ ?/gm, "");
      const bodyRead = runnable.indexOf("const body = await req.text();");
      const success = runnable.indexOf('return new Response("ok", { status: 200 });');
      expect(bodyRead).toBeGreaterThanOrEqual(0);
      expect(success).toBeGreaterThan(bodyRead);

      const reminderLines = runnable
        .slice(bodyRead, success)
        .split("\n")
        .slice(1)
        .filter((line) => line.trim().length > 0);
      expect(reminderLines.length).toBeGreaterThan(0);
      for (const line of reminderLines) {
        expect(line.trimStart().startsWith("//")).toBe(true);
      }
      const reminder = reminderLines.join("\n");
      expect(reminder).toContain("TODO(security): signature verification is NOT implemented here.");
      expect(reminder).toContain("unauthenticated, attacker-controlled input");
      expect(reminder).toContain(`forge a ${provider} webhook`);
      expect(reminder).toContain("constant time");
      expect(reminder).toContain("parse, trust, or act on the body");

      // In the runnable handler the only statement mentioning `body` is its
      // capture: untrusted input is read but never consumed ahead of the TODO.
      const executable = runnable
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
      expect([...executable.matchAll(/\bbody\b/g)]).toHaveLength(1);
    },
  );

  it.each([
    ["stripe", "stripe.webhooks.constructEvent"],
    ["clerk", "new Webhook(secret).verify(body, headers)"],
    ["supabase", "`x-supabase-signature` per Supabase's documented webhook scheme"],
    ["github", "`sha256=` + HMAC-SHA256"],
  ])(
    "points the %s stub at the provider's verification scheme without claiming it ran",
    async (provider, hint) => {
      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      const example = readFileSync(result.webhooks[0], "utf-8").match(
        /^\/\/ export async function [\s\S]*?^\/\/ }$/m,
      )?.[0];
      if (!example) throw new Error(`Missing ${provider} webhook example`);

      // The TODO names where verification belongs and how the provider does it.
      expect(example).toContain(hint);

      // No comment may describe the request as already verified, and the
      // uncommented handler must contain no verification code — the TODO's
      // "NOT implemented" claim has to be true, not aspirational.
      expect(example).not.toMatch(
        /signature verified|verified signature|request is authenticated/i,
      );
      const runnable = example
        .replace(/^\/\/ ?/gm, "")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
      expect(runnable).not.toMatch(/createHmac|timingSafeEqual|\.verify\(/);
    },
  );

  it("noWire: true skips the vault check and webhooks entirely", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, {
      cwd: harness.dir,
      noWire: true,
    });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [] });

    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(existsSync(stubPath)).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
    expect(harness.callsTo("list")).toEqual([]);
  });

  it("reports every provider as skipped when Phantom is unavailable, while writing stubs", async () => {
    writeFileSync(join(harness.dir, "phantom"), "#!/usr/bin/env bash\nexit 1\n");
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: "stripe" }, { name: "unknown" }, { name: "stripe" }],
    };
    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");

    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath, stubPath],
      skipped: ["stripe", "unknown", "stripe"],
    });
    expect(existsSync(stubPath)).toBe(true);
    expect(harness.callsTo("list")).toEqual([]);
  });

  it("keeps unverified webhook warnings when Phantom is unavailable", async () => {
    writeFileSync(join(harness.dir, "phantom"), "#!/usr/bin/env bash\nexit 1\n");
    const providers = ["stripe", "clerk", "supabase", "github"];
    const result = await wirePhantomForRecipe(
      { ...STRIPE_RECIPE, providers: providers.map((name) => ({ name })) },
      { cwd: harness.dir },
    );

    expect(result.skipped).toEqual(providers);
    expect(result.webhooks).toEqual(
      providers.map((provider) => join(harness.dir, ".stack/webhooks", `${provider}.ts`)),
    );
    for (const path of result.webhooks) {
      const stub = readFileSync(path, "utf-8");
      const warning = stub.indexOf(
        "This entire example is commented out and does not verify signatures.",
      );
      const handler = stub.indexOf("// export async function");
      expect(warning).toBeGreaterThanOrEqual(0);
      expect(handler).toBeGreaterThan(warning);
      expect(stub).toContain(
        "200 without authenticating the request. Implement verification first.",
      );
      expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
      expect(stub).not.toMatch(/signature verified|verified signature|request is authenticated/i);
      expect(stub.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
    }
  });

  it("rejects a stub write failure after leaving earlier stubs in place", async () => {
    const webhookDir = join(harness.dir, ".stack/webhooks");
    mkdirSync(join(webhookDir, "github.ts"), { recursive: true });
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: "stripe" }, { name: "github" }],
    };

    await expect(wirePhantomForRecipe(recipe, { cwd: harness.dir })).rejects.toBeDefined();
    expect(readFileSync(join(webhookDir, "stripe.ts"), "utf-8")).toContain("stripe-signature");
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("skips an unknown provider without suppressing known provider results", async () => {
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: "unknown" }, { name: "stripe" }],
    };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [join(harness.dir, ".stack/webhooks/stripe.ts")],
      skipped: ["unknown"],
    });
  });

  it("preserves a newline in a provider name exactly and never turns it into a stub or file", async () => {
    // A name with a newline is not a known provider. It must come back
    // byte-for-byte in `skipped` (no trimming, no escaping), and must not
    // reach the webhook stub template, where a raw newline would end the `//`
    // comment line and leave live code in the generated file.
    const name = "stripe\nexport const injected = true;";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };

    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });

    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [name] });
    expect(result.skipped[0]).toBe("stripe\nexport const injected = true;");
    expect(result.skipped[0].split("\n")).toHaveLength(2);
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("splits a multi-secret provider into present and missing", async () => {
    harness.cleanup();
    harness = setupFakePhantom({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "a" });
    const recipe: Recipe = {
      id: "supa",
      query: "database",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [{ name: "supabase" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.present).toEqual(["supabase:SUPABASE_URL", "supabase:SUPABASE_ANON_KEY"]);
    expect(result.missing).toEqual(["supabase:SUPABASE_SERVICE_ROLE_KEY"]);
    expect(result.skipped).toEqual([]);
    expect(harness.callsTo("add")).toEqual([]);
    // Supabase is webhook-capable in our moat list.
    expect(result.webhooks).toHaveLength(1);
  });

  it("skips providers when the vault can't be listed, but still writes stubs", async () => {
    writeFileSync(harness.vaultPath, "not json");
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(result.skipped).toEqual(["stripe"]);
    expect(result.present).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.webhooks).toHaveLength(1);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("surfaces a failed inventory command as unavailable and skips providers", async () => {
    const phantomPath = join(harness.dir, "phantom");
    const shim = readFileSync(phantomPath, "utf-8");
    // Even plausible inventory on stdout is not evidence when the command fails.
    expect(shim).toContain("  list)\n");
    writeFileSync(
      phantomPath,
      shim.replace(
        "  list)\n",
        `  list)\n    echo '[{"name":"STRIPE_SECRET_KEY"}]'\n    echo 'inventory unavailable' >&2\n    exit 1\n`,
      ),
    );

    await expect(listSecrets(harness.dir)).rejects.toMatchObject({
      code: "PHANTOM_METADATA_UNAVAILABLE",
      message: "Phantom secret inventory is unavailable; stored names are unknown.",
    });
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: "stripe" }, { name: "neon" }] };
    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath],
      skipped: ["stripe", "neon"],
    });
    expect(existsSync(stubPath)).toBe(true);
    expect(harness.callsTo("list")).toEqual([
      { cmd: "list", args: ["--json"] },
      { cmd: "list", args: ["--json"] },
    ]);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });

  it("treats surrounding whitespace in vault inventory JSON the same as compact JSON", async () => {
    const inventory = '[{"name":"STRIPE_SECRET_KEY"}]';
    const setListOutput = (output: string) => {
      writeFileSync(
        join(harness.dir, "phantom"),
        `#!/usr/bin/env bash\ncase "$1" in\n  --version) echo "phantom fake 0.0.1" ;;\n  list) printf '%s' '${output}' ;;\n  *) exit 1 ;;\nesac\n`,
      );
    };

    setListOutput(inventory);
    const compact = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(compact).toEqual({
      present: ["stripe:STRIPE_SECRET_KEY"],
      missing: [],
      skipped: [],
      webhooks: [join(harness.dir, ".stack/webhooks/stripe.ts")],
    });

    setListOutput(` \t\r\n${inventory}\n\t `);
    expect(await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir })).toEqual(compact);
  });

  it("rejects malformed vault inventory JSON and keeps the provider's secrets unknown", async () => {
    // A successful command may still return a truncated inventory containing a plausible name.
    writeFileSync(
      join(harness.dir, "phantom"),
      `#!/usr/bin/env bash\ncase "$1" in\n  --version) echo "phantom fake 0.0.1" ;;\n  list) printf '%s' '[{"name":"STRIPE_SECRET_KEY"}' ;;\n  *) exit 1 ;;\nesac\n`,
    );

    await expect(listSecrets(harness.dir)).rejects.toMatchObject({
      code: "PHANTOM_OUTPUT_UNRECOGNIZED",
      message:
        "phantom list --json did not return JSON; upgrade Phantom Secrets to 0.7.9 or newer.",
    });
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(result).toEqual({
      present: [],
      missing: [],
      skipped: ["stripe"],
      webhooks: [join(harness.dir, ".stack/webhooks/stripe.ts")],
    });
    expect(existsSync(result.webhooks[0])).toBe(true);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });

  it("rejects a JSON number from the vault inventory and skips the provider", async () => {
    // Return valid JSON from a successful list command, but not the required array.
    writeFileSync(
      join(harness.dir, "phantom"),
      '#!/usr/bin/env bash\ncase "$1" in\n  --version) echo "phantom fake 0.0.1" ;;\n  list) echo 42 ;;\n  *) exit 1 ;;\nesac\n',
    );

    await expect(listSecrets(harness.dir)).rejects.toMatchObject({
      code: "PHANTOM_OUTPUT_UNRECOGNIZED",
      message: "phantom list --json did not return an array.",
    });
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(result).toEqual({
      present: [],
      missing: [],
      skipped: ["stripe"],
      webhooks: [join(harness.dir, ".stack/webhooks/stripe.ts")],
    });
    expect(existsSync(result.webhooks[0])).toBe(true);
  });

  it.each(["true", "false"])(
    "rejects JSON boolean %s from the vault inventory and skips the provider",
    async (output) => {
      writeFileSync(
        join(harness.dir, "phantom"),
        `#!/usr/bin/env bash\ncase "$1" in\n  --version) echo "phantom fake 0.0.1" ;;\n  list) echo ${output} ;;\n  *) exit 1 ;;\nesac\n`,
      );

      await expect(listSecrets(harness.dir)).rejects.toMatchObject({
        code: "PHANTOM_OUTPUT_UNRECOGNIZED",
        message: "phantom list --json did not return an array.",
      });
      const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
      expect(result).toEqual({
        present: [],
        missing: [],
        skipped: ["stripe"],
        webhooks: [join(harness.dir, ".stack/webhooks/stripe.ts")],
      });
      expect(existsSync(result.webhooks[0])).toBe(true);
      expect(harness.callsTo("add")).toEqual([]);
    },
  );

  it("does not report a JSON string vault response as a verified secret", async () => {
    // A successful command returning the expected name as a scalar is not an inventory.
    writeFileSync(
      join(harness.dir, "phantom"),
      `#!/usr/bin/env bash\ncase "$1" in\n  --version) echo "phantom fake 0.0.1" ;;\n  list) printf '%s' '"STRIPE_SECRET_KEY"' ;;\n  *) exit 1 ;;\nesac\n`,
    );

    await expect(listSecrets(harness.dir)).rejects.toMatchObject({
      code: "PHANTOM_OUTPUT_UNRECOGNIZED",
      message: "phantom list --json did not return an array.",
    });
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(result).toEqual({
      present: [],
      missing: [],
      skipped: ["stripe"],
      webhooks: [join(harness.dir, ".stack/webhooks/stripe.ts")],
    });
    expect(existsSync(result.webhooks[0])).toBe(true);
  });

  it("skips providers with no webhook stub without crashing", async () => {
    const recipe: Recipe = {
      id: "neon",
      query: "database",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [{ name: "neon" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.webhooks).toEqual([]);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("documents in the module header that readers must verify before trusting the body", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    const header = source.match(/^\/\*\*[\s\S]*?\*\//)?.[0];
    if (!header) throw new Error("Missing phantom-wire module header");
    const prose = header.replace(/^ ?\*+ ?/gm, "").replace(/\s+/g, " ");

    expect(prose).toContain("Signature verification is not implemented");
    expect(prose).toContain("a present signature header authenticates nothing");
    expect(prose).toContain("the body is untrusted input");
    expect(prose).toContain("verification to add before deploying a handler");
  });

  it.each([
    ["missing providers", { providers: undefined }],
    ["null providers", { providers: null }],
    ["a null provider entry", { providers: [null] }],
  ])(
    "rejects a malformed recipe with %s before touching the vault or disk",
    async (_label, bad) => {
      // Recipes are normally parsed by readRecipe; a hand-built object that skips
      // it is not validated here, so the failure is a plain TypeError.
      await expect(
        wirePhantomForRecipe({ ...STRIPE_RECIPE, ...bad } as unknown as Recipe, {
          cwd: harness.dir,
        }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(harness.callsTo("add")).toEqual([]);
      expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    },
  );

  it("keeps the trust-boundary doc aligned with the unimplemented verification", async () => {
    const doc = readFileSync(
      new URL("../../../../docs/phantom-wire-trust-boundary.md", import.meta.url),
      "utf-8",
    );
    expect(doc).toContain("Signature verification is not implemented");
    expect(doc).toContain("Recipe signature verification");
    expect(doc).toContain("Webhook signature verification");
    expect(doc).toContain("## Data that must not be trusted before verification");

    const providers = ["stripe", "clerk", "supabase", "github"];
    const result = await wirePhantomForRecipe(
      { ...STRIPE_RECIPE, providers: providers.map((name) => ({ name })) },
      { cwd: harness.dir },
    );
    for (const path of result.webhooks) {
      const stub = readFileSync(path, "utf-8");
      // Every header the doc says is untrusted must be the one the stub reads.
      const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
      expect(header).toBeDefined();
      expect(doc).toContain(`\`${header}\``);
      expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
    }
  });

  it("passes arguments containing parentheses to the phantom executable unchanged", async () => {
    // Stub records each argv entry NUL-delimited, plus the working directory.
    const argvLog = join(harness.dir, "argv.log");
    const cwdLog = join(harness.dir, "cwd.log");
    writeFileSync(
      join(harness.dir, "phantom"),
      `#!/bin/sh
case "$1" in --version) echo "phantom 0.0.0"; exit 0;; esac
for a in "$@"; do printf '%s\\0' "$a" >> "${argvLog}"; done
printf '%s' "$(pwd -P)" > "${cwdLog}"
echo "[]"
`,
    );
    chmodSync(join(harness.dir, "phantom"), 0o755);
    const argv = () => readFileSync(argvLog, "utf-8").split("\0").slice(0, -1);

    // A project directory with parentheses reaches phantom as its cwd, intact.
    const projectDir = join(harness.dir, "proj (copy) (1)");
    mkdirSync(projectDir);
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: projectDir });
    expect(argv()).toEqual(["list", "--json"]);
    expect(readFileSync(cwdLog, "utf-8")).toBe(realpathSync(projectDir));
    expect(result.missing).toContain("stripe:STRIPE_SECRET_KEY");

    // A parenthesized argv entry is not split, expanded, or quoted.
    writeFileSync(argvLog, "");
    const arg = "KEY (v2) $(echo x) `id` *";
    await exec(["reveal", arg], { cwd: projectDir });
    expect(argv()).toEqual(["reveal", arg]);
  });

  it("expands the provider placeholders in the webhook stub and preserves the surrounding text exactly", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    const stub = readFileSync(result.webhooks[0] as string, "utf-8");
    const lines = stub.split("\n");

    // Known placeholder values are substituted inside ordinary text...
    expect(lines[0]).toBe("// Auto-generated by `stack apply` — webhook handler stub for stripe.");
    expect(lines).toContain("//   phantom reveal STRIPE_WEBHOOK_SECRET");
    expect(lines).toContain(
      "// export async function handleStripeWebhook(req: Request): Promise<Response> {",
    );
    expect(lines).toContain('//   const signature = req.headers.get("stripe-signature");');
    expect(lines).toContain("//   // (`phantom reveal STRIPE_WEBHOOK_SECRET`) and compare in");
    // ...the text around them is untouched, and no placeholder is left behind.
    expect(lines).toContain("// The secret lives in Phantom; read it at call time with:");
    expect(stub).not.toContain("${");
    expect(stub.endsWith("// }\n")).toBe(true);
  });

  it.each(["stripe", "clerk", "supabase", "github"])(
    "replaces the template's first placeholder with %s and keeps the following text exact",
    (provider) => {
      // The `base` template opens with its first `${provider}` slot at the
      // end of the first comment line. Expansion must land the provider name
      // in that exact position and leave every byte after it — the closing
      // period, the line break, and the fixed header text up to the next
      // `${...}` slot (`${webhookSecretKeyFor(provider)}`) — untouched.
      const stub = webhookStubFor(provider);
      const opening = [
        `// Auto-generated by \`stack apply\` — webhook handler stub for ${provider}.`,
        "// Fill in the secret retrieval + signature verification before deploying.",
        "// This entire example is commented out and does not verify signatures.",
        "// If uncommented as-is, it accepts any non-empty signature header and returns",
        "// 200 without authenticating the request. Implement verification first.",
        "//",
        "// The secret lives in Phantom; read it at call time with:",
        "//   phantom reveal ",
      ].join("\n");
      expect(stub.startsWith(opening)).toBe(true);
      // The slot is consumed: no unexpanded `${` survives on the first line.
      expect(stub.split("\n", 1)[0]).not.toContain("${");
    },
  );

  it.each([
    ["stripe", "STRIPE_WEBHOOK_SECRET"],
    ["clerk", "CLERK_WEBHOOK_SECRET"],
    ["supabase", "SUPABASE_WEBHOOK_SECRET"],
    ["github", "GITHUB_WEBHOOK_SECRET"],
  ])(
    "replaces the template's last placeholder with the %s secret name and keeps the preceding text exact",
    (provider, secret) => {
      // The `base` template's final `${...}` slot is the second
      // `${webhookSecretKeyFor(provider)}`, inside the TODO's backticked
      // reveal reminder. Every byte before the slot — the "Verify over ...
      // secret" lead-in line and the `//   // (` + backtick +
      // `phantom reveal ` opener — is fixed text, and only fixed comment
      // lines follow it. Expansion must land the provider's secret name at
      // exactly that position.
      const source = readFileSync(
        fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
        "utf-8",
      );
      const template = source.match(/const base = `([\s\S]*?)`;\n/)?.[1];
      if (template === undefined) throw new Error("webhook stub template not found in source");
      const lastSlot = template.lastIndexOf("${");
      expect(template.slice(lastSlot)).toMatch(/^\$\{webhookSecretKeyFor\(provider\)\}/);

      const stub = webhookStubFor(provider);
      // The slot's line byte-for-byte: fixed prefix, the replacement, then
      // the fixed suffix — anything added, dropped, or reordered breaks it.
      expect(stub).toContain(`//   // (\`phantom reveal ${secret}\`) and compare in`);
      // The known placeholder sits at the end of the template: the fixed
      // lead-in line immediately precedes it and only the template's fixed
      // closing lines follow — the stub ends exactly here.
      const tail = [
        "//   // Verify over the exact raw body bytes with the webhook secret",
        `//   // (\`phantom reveal ${secret}\`) and compare in`,
        "//   // constant time; reject missing or invalid signatures, and only then",
        "//   // parse, trust, or act on the body.",
        '//   return new Response("ok", { status: 200 });',
        "// }",
        "",
      ].join("\n");
      expect(stub.endsWith(tail)).toBe(true);
    },
  );

  it("expands the placeholder at the start of the secret-name template and keeps the following text exact", () => {
    // `webhookSecretKeyFor`'s fallback template is
    // `${provider.toUpperCase()}_WEBHOOK_SECRET` — the slot opens the
    // template with nothing before it, and the literal `_WEBHOOK_SECRET`
    // is the text that follows. Expansion must land the uppercased name
    // flush at position 0: no prefix inserted, no byte of the suffix
    // eaten, padded, or reordered.
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    // Sanity: in the source the template really does start with the slot,
    // and `_WEBHOOK_SECRET` is the only text after it.
    const slot = source.match(/`(\$\{provider\.toUpperCase\(\)\})([^`]*)`/);
    expect(slot?.[1]).toBe("${provider.toUpperCase()}");
    expect(slot?.[2]).toBe("_WEBHOOK_SECRET");

    // A name outside the four-case switch takes the fallback branch; the
    // expansion surfaces in the stub's two reveal sites. Everything after
    // the reveal line's fixed prefix is the slot's output, byte-exact:
    // the substituted name at the start plus the following text behind it.
    const stub = webhookStubFor("payco");
    const revealLine = stub.split("\n").find((l) => l.startsWith("//   phantom reveal "));
    const key = revealLine?.slice("//   phantom reveal ".length);
    expect(key).toBe("PAYCO_WEBHOOK_SECRET");
    expect(key?.startsWith("PAYCO")).toBe(true);
    expect(key?.slice("PAYCO".length)).toBe("_WEBHOOK_SECRET");
    expect(stub).toContain("//   // (`phantom reveal PAYCO_WEBHOOK_SECRET`) and compare in");
    expect(stub.split("phantom reveal PAYCO_WEBHOOK_SECRET").length - 1).toBe(2);
    expect(stub).not.toContain("${");
  });

  it("replaces the leading provider name in the fallback secret name once and leaves the following text unchanged", () => {
    // The name is data, not template: a placeholder-shaped name is
    // uppercased in place at position 0 and never expanded a second time,
    // and `_WEBHOOK_SECRET` follows it byte for byte.
    const stub = webhookStubFor("${x}co");
    expect(stub).toContain("//   phantom reveal ${X}CO_WEBHOOK_SECRET\n");
    expect(stub).toContain("//   // (`phantom reveal ${X}CO_WEBHOOK_SECRET`) and compare in\n");
    expect(stub.split("${X}CO_WEBHOOK_SECRET").length - 1).toBe(2);
  });

  it.each(["stripe", "clerk", "supabase", "github"])(
    "expands the placeholder at the start of the stub filename template for %s and keeps the following text in order",
    async (provider) => {
      // `writeWebhookStub` builds each stub path from the filename template
      // `${provider}.ts` — a known placeholder at position 0 followed by the
      // fixed text `.ts`. Expansion must land the provider name flush at the
      // start of the basename with the suffix immediately behind it: value
      // first, following text second, nothing before or between them.
      const source = readFileSync(
        fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
        "utf-8",
      );
      // Sanity: the template under test really opens with the slot.
      expect(source).toContain('"webhooks", `${provider}.ts`');

      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      expect(result.webhooks).toHaveLength(1);
      const file = basename(result.webhooks[0] as string);

      // The placeholder's value at position 0, then the fixed `.ts` text,
      // in that order — the whole basename is exactly value + suffix.
      expect(file.startsWith(provider)).toBe(true);
      expect(file.indexOf(".ts")).toBe(provider.length);
      expect(file).toBe(`${provider}.ts`);
    },
  );

  it("expands the placeholder at the start of the vault-entry template and keeps the following text in order", async () => {
    // `wirePhantomForRecipe` classifies secrets through the entry template
    // `${name}:${secret}` — a known placeholder at position 0 followed by
    // the fixed `:` separator and the `${secret}` slot's value. Every
    // `present`/`missing` entry must carry the provider name flush at the
    // start, then `:` + the secret name, in that order.
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    // Sanity: the template under test really opens with the `${name}` slot.
    expect(source).toContain("`${name}:${secret}`");

    // A vault holding only some of the provider's secrets exercises both
    // branches: stored names land in `present`, the rest in `missing`.
    harness.cleanup();
    harness = setupFakePhantom({ SUPABASE_URL: "https://x.supabase.co" });
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: "supabase" }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });

    for (const [entries, secrets] of [
      [result.present, ["SUPABASE_URL"]],
      [result.missing, ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]],
    ] as const) {
      expect(entries).toHaveLength(secrets.length);
      for (const [index, secret] of secrets.entries()) {
        const entry = entries[index] as string;
        // Value at position 0, then `:` + secret — in order, nothing else.
        expect(entry.startsWith("supabase")).toBe(true);
        expect(entry.indexOf(":")).toBe("supabase".length);
        expect(entry).toBe(`supabase:${secret}`);
      }
    }
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("gives the secret-name and signature-header placeholders their own replacement per provider", () => {
    // `${webhookSecretKeyFor(provider)}` and `${signatureHeaderFor(provider)}`
    // are separate slots filled by separate lookups. Two providers pin the
    // mapping: a shared or swapped substitution would drop the wrong value
    // into a slot or leak one provider's value into the other's stub.
    const stripe = webhookStubFor("stripe");
    const github = webhookStubFor("github");

    // The secret-name placeholder expands in both of its stub positions.
    expect(stripe.match(/phantom reveal \w+/g)).toEqual([
      "phantom reveal STRIPE_WEBHOOK_SECRET",
      "phantom reveal STRIPE_WEBHOOK_SECRET",
    ]);
    expect(github.match(/phantom reveal \w+/g)).toEqual([
      "phantom reveal GITHUB_WEBHOOK_SECRET",
      "phantom reveal GITHUB_WEBHOOK_SECRET",
    ]);

    // The signature-header placeholder takes each provider's own header, not
    // the secret-name slot's replacement or the other provider's header.
    expect(stripe).toContain('req.headers.get("stripe-signature")');
    expect(github).toContain('req.headers.get("x-hub-signature-256")');
    expect(stripe).not.toContain('req.headers.get("STRIPE_WEBHOOK_SECRET")');
    expect(stripe).not.toContain("GITHUB_WEBHOOK_SECRET");
    expect(stripe).not.toContain("x-hub-signature-256");
    expect(github).not.toContain("STRIPE_WEBHOOK_SECRET");
    expect(github).not.toContain("stripe-signature");
  });

  it("gives the provider-name and capitalized-name placeholders their own replacement", () => {
    // `${provider}` and `${capitalize(provider)}` are two distinct slots fed by
    // one input. Each must receive its own form: the raw name in the prose
    // slots, the capitalized name only inside the handler identifier.
    const clerk = webhookStubFor("clerk");
    const github = webhookStubFor("github");

    expect(clerk).toContain("webhook handler stub for clerk.");
    expect(clerk).toContain("forge a clerk webhook.");
    expect(clerk).toContain("export async function handleClerkWebhook(");
    expect(github).toContain("webhook handler stub for github.");
    expect(github).toContain("forge a github webhook.");
    expect(github).toContain("export async function handleGithubWebhook(");

    // No cross-over: the capitalized form never lands in a prose slot, the raw
    // form never lands in the identifier, and neither provider leaks into the other.
    expect(clerk).not.toContain("stub for Clerk");
    expect(clerk).not.toContain("forge a Clerk");
    expect(clerk).not.toContain("handleclerkWebhook");
    expect(clerk).not.toMatch(/github/i);
    expect(github).not.toContain("stub for Github");
    expect(github).not.toContain("handlegithubWebhook");
    expect(github).not.toMatch(/clerk/i);
  });

  it("replaces every occurrence of a placeholder that appears more than once in the template", () => {
    // `${webhookSecretKeyFor(provider)}` fills two slots — the reveal
    // instruction line and the TODO's backticked reminder — and `${provider}`
    // fills two more (the generated-by line and the forge warning). Expansion
    // is per occurrence: stopping after a first match would leave a live
    // `${...}` slot or drop a site entirely.
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    const template = source.match(/const base = `([\s\S]*?)`;\n/)?.[1];
    if (template === undefined) throw new Error("webhook stub template not found in source");
    const count = (text: string, needle: string): number => text.split(needle).length - 1;

    const secretSlots = count(template, "${webhookSecretKeyFor(provider)}");
    const nameSlots = count(template, "${provider}");
    expect(secretSlots).toBeGreaterThan(1);
    expect(nameSlots).toBeGreaterThan(1);

    // Each provider's secret name lands at all of its slots: nothing
    // duplicates it, no slot is left unexpanded, no `${` survives.
    for (const [provider, secret] of [
      ["stripe", "STRIPE_WEBHOOK_SECRET"],
      ["clerk", "CLERK_WEBHOOK_SECRET"],
      ["supabase", "SUPABASE_WEBHOOK_SECRET"],
      ["github", "GITHUB_WEBHOOK_SECRET"],
    ] as const) {
      const stub = webhookStubFor(provider);
      expect(count(stub, secret)).toBe(secretSlots);
      expect(stub).not.toContain("${");
    }

    // The same for `${provider}`: a name that collides with nothing else in
    // the template keeps the count honest — every match is an expansion site.
    const stub = webhookStubFor("payco");
    expect(count(stub, "payco")).toBe(nameSlots);
    expect(count(stub, "PAYCO_WEBHOOK_SECRET")).toBe(secretSlots);
    // Each repeated site kept its own surrounding text, so both occurrences
    // were expanded in place rather than one dropped or copied.
    expect(stub).toContain("webhook handler stub for payco.");
    expect(stub).toContain("forge a payco webhook.");
    expect(stub).toContain("//   phantom reveal PAYCO_WEBHOOK_SECRET\n");
    expect(stub).toContain("//   // (`phantom reveal PAYCO_WEBHOOK_SECRET`) and compare in");
    expect(stub).not.toContain("${");
  });

  it("gives every repeated occurrence of a known provider's placeholders its value in the stub written to disk", async () => {
    // End to end: the file `wirePhantomForRecipe` writes, not just the pure
    // template function. Each line carrying a repeated placeholder is located
    // by line, so a site that kept a stale or foreign value cannot hide behind
    // a matching total count.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: "clerk" }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    const stub = readFileSync(result.webhooks[0] as string, "utf-8");
    const lines = stub.split("\n");

    expect(lines.filter((l) => l.includes("CLERK_WEBHOOK_SECRET"))).toEqual([
      "//   phantom reveal CLERK_WEBHOOK_SECRET",
      "//   // (`phantom reveal CLERK_WEBHOOK_SECRET`) and compare in",
    ]);
    expect(lines.filter((l) => /\bclerk\b/.test(l))).toEqual([
      "// Auto-generated by `stack apply` — webhook handler stub for clerk.",
      "//   // to this endpoint can forge a clerk webhook.",
    ]);
    expect(stub).not.toContain("${");
  });

  it.each([
    ["stripe", "STRIPE_WEBHOOK_SECRET"],
    ["supabase", "SUPABASE_WEBHOOK_SECRET"],
    ["github", "GITHUB_WEBHOOK_SECRET"],
  ])(
    "gives both repeated secret-name and provider-name sites their value for %s in the stub written to disk",
    async (name, secret) => {
      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      const lines = readFileSync(result.webhooks[0] as string, "utf-8").split("\n");

      expect(lines.filter((l) => l.includes(secret))).toEqual([
        `//   phantom reveal ${secret}`,
        `//   // (\`phantom reveal ${secret}\`) and compare in`,
      ]);
      expect(lines).toContain(
        `// Auto-generated by \`stack apply\` — webhook handler stub for ${name}.`,
      );
      expect(lines).toContain(`//   // to this endpoint can forge a ${name} webhook.`);
      expect(lines.join("\n")).not.toContain("${");
    },
  );

  it("expands the multiline template line for line, leaving unrelated lines and line breaks identical across providers", () => {
    // Swap each provider's own expansions back to neutral tokens. What remains
    // is the template with its placeholders unexpanded; if expansion touched
    // any unrelated line (or added, dropped, or re-terminated one) the
    // providers' templates would diverge.
    const cases = [
      {
        p: "stripe",
        cap: "Stripe",
        secret: "STRIPE_WEBHOOK_SECRET",
        header: "stripe-signature",
        hint: "Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance.",
      },
      {
        p: "clerk",
        cap: "Clerk",
        secret: "CLERK_WEBHOOK_SECRET",
        header: "svix-signature",
        hint: "Clerk (svix): `new Webhook(secret).verify(body, headers)`.",
      },
      {
        p: "supabase",
        cap: "Supabase",
        secret: "SUPABASE_WEBHOOK_SECRET",
        header: "x-supabase-signature",
        hint: "Supabase: `x-supabase-signature` per Supabase's documented webhook scheme.",
      },
      {
        p: "github",
        cap: "GitHub",
        secret: "GITHUB_WEBHOOK_SECRET",
        header: "x-hub-signature-256",
        hint: "GitHub: `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body.",
      },
    ];
    const templateOf = (c: (typeof cases)[number]): string[] => {
      const stub = webhookStubFor(c.p);
      expect(stub).not.toContain("\r");
      expect(stub).not.toContain("${");
      expect(stub.endsWith("\n")).toBe(true);
      return stub
        .split("\n")
        .map((line) => (line === `//   // ${c.hint}` ? "//   // <HINT>" : line))
        .map((line) =>
          line
            .replaceAll(c.secret, "<SECRET>")
            .replaceAll(`handle${c.p.charAt(0).toUpperCase()}${c.p.slice(1)}Webhook`, "<HANDLER>")
            .replaceAll(c.header, "<HEADER>")
            .replaceAll(c.p, "<PROVIDER>"),
        );
    };
    const [first, ...rest] = cases.map(templateOf);
    expect(first?.length).toBe(26);
    expect(first).toContain("//   // <HINT>");
    for (const other of rest) expect(other).toEqual(first);

    // Blank-free comment block: every non-final line is a `//` comment, and
    // unrelated lines survive verbatim, in order, with their breaks.
    const lines = webhookStubFor("stripe").split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.slice(0, -1).every((l) => l.startsWith("//"))).toBe(true);
    expect(lines[1]).toBe(
      "// Fill in the secret retrieval + signature verification before deploying.",
    );
    expect(lines[5]).toBe("//");
    expect(lines.indexOf("// The secret lives in Phantom; read it at call time with:")).toBe(6);
  });

  it("returns the template's placeholder-free lines unchanged for every provider", () => {
    // The `base` template literal mixes `${...}` placeholder slots with static
    // comment text. A line carrying no `${` is the template without
    // placeholders: expansion must return it unchanged — same bytes, in the
    // same order — no matter which provider name fills the slots. Escaped
    // backticks in the source (\`) unescape to ` in the literal's value.
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    const base = source.match(/const base = `([\s\S]*?)`;\n/)?.[1];
    if (base === undefined) throw new Error("webhook stub template not found in source");
    const staticLines = base
      .split("\n")
      .filter((line) => !line.includes("${"))
      .map((line) => line.replaceAll("\\`", "`"));
    // 26 template lines total; 7 carry placeholders, leaving 19 static lines.
    expect(staticLines).toHaveLength(19);

    for (const provider of ["stripe", "clerk", "supabase", "github"]) {
      const stubLines = webhookStubFor(provider).split("\n");
      expect(stubLines).toHaveLength(26); // 25 comment lines + trailing "" after the final \n
      let at = 0;
      for (const line of staticLines) {
        const found = stubLines.indexOf(line, at);
        expect(found).toBeGreaterThanOrEqual(at);
        at = found + 1;
      }
    }
  });

  it.each([
    [
      "stripe",
      {
        cap: "Stripe",
        secret: "STRIPE_WEBHOOK_SECRET",
        header: "stripe-signature",
        hint: "Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance.",
      },
    ],
    [
      "clerk",
      {
        cap: "Clerk",
        secret: "CLERK_WEBHOOK_SECRET",
        header: "svix-signature",
        hint: "Clerk (svix): `new Webhook(secret).verify(body, headers)`.",
      },
    ],
    [
      "supabase",
      {
        cap: "Supabase",
        secret: "SUPABASE_WEBHOOK_SECRET",
        header: "x-supabase-signature",
        hint: "Supabase: `x-supabase-signature` per Supabase's documented webhook scheme.",
      },
    ],
    [
      "github",
      {
        cap: "Github",
        secret: "GITHUB_WEBHOOK_SECRET",
        header: "x-hub-signature-256",
        hint: "GitHub: `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body.",
      },
    ],
  ])(
    "expands the multiline template for %s byte-for-byte, preserving line breaks and other text",
    (provider, want) => {
      // Build the expected stub straight from the source template: each known
      // `${...}` slot is filled with this provider's value and `\`` escapes
      // unescape to `` ` `` — everything else (every `\n`, every comment
      // byte) must come through untouched. Comparing the whole stub to this
      // independently expanded template proves replacement changed only the
      // placeholder slots: a dropped line, a CRLF, a reordered comment, or a
      // modified character anywhere fails the equality.
      const source = readFileSync(
        fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
        "utf-8",
      );
      const base = source.match(/const base = `([\s\S]*?)`;\n/)?.[1];
      if (base === undefined) throw new Error("webhook stub template not found in source");
      // Sanity: the template under test really is multiline with known slots.
      expect(base.split("\n").length).toBeGreaterThan(1);
      for (const slot of [
        "${provider}",
        "${capitalize(provider)}",
        "${webhookSecretKeyFor(provider)}",
        "${signatureHeaderFor(provider)}",
        "${verificationHintFor(provider)}",
      ]) {
        expect(base).toContain(slot);
      }

      const expected = base
        .replaceAll("\\`", "`")
        .replaceAll("${capitalize(provider)}", want.cap)
        .replaceAll("${webhookSecretKeyFor(provider)}", want.secret)
        .replaceAll("${signatureHeaderFor(provider)}", want.header)
        .replaceAll("${verificationHintFor(provider)}", want.hint)
        // `${provider}` last: it is not a substring of the longer slots, but
        // filling it first would still be correct only because of that — the
        // order here never depends on it.
        .replaceAll("${provider}", provider);
      expect(expected).not.toContain("${");
      // Substitution adds no line breaks: slot count differs, line count does not.
      expect(expected.split("\n")).toHaveLength(base.split("\n").length);

      expect(webhookStubFor(provider)).toBe(expected);
    },
  );

  it("expands a line holding only a known placeholder to exactly the replacement", () => {
    // These stub lines are a fixed prefix plus one placeholder and nothing
    // else, so after stripping the prefix the remainder must equal the
    // replacement exactly: no padding, quoting, or trailing text.
    const lineAfter = (stub: string, prefix: string): string[] =>
      stub
        .split("\n")
        .filter((l) => l.startsWith(prefix))
        .map((l) => l.slice(prefix.length));

    expect(lineAfter(webhookStubFor("stripe"), "//   phantom reveal ")).toEqual([
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(lineAfter(webhookStubFor("github"), "//   phantom reveal ")).toEqual([
      "GITHUB_WEBHOOK_SECRET",
    ]);
    // The hint line is `// ` + the verification hint, verbatim.
    expect(lineAfter(webhookStubFor("github"), "//   // GitHub: ")).toEqual([
      "`x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body.",
    ]);
    expect(lineAfter(webhookStubFor("clerk"), "//   // ")).toContain(
      "Clerk (svix): `new Webhook(secret).verify(body, headers)`.",
    );
  });

  it.each([
    [
      "stripe",
      {
        headerLine: '//   const signature = req.headers.get("stripe-signature");',
        revealLine: "//   // (`phantom reveal STRIPE_WEBHOOK_SECRET`) and compare in",
        handlerLine:
          "// export async function handleStripeWebhook(req: Request): Promise<Response> {",
        generatedLine: "// Auto-generated by `stack apply` — webhook handler stub for stripe.",
        forgeLine: "//   // to this endpoint can forge a stripe webhook.",
      },
    ],
    [
      "clerk",
      {
        headerLine: '//   const signature = req.headers.get("svix-signature");',
        revealLine: "//   // (`phantom reveal CLERK_WEBHOOK_SECRET`) and compare in",
        handlerLine:
          "// export async function handleClerkWebhook(req: Request): Promise<Response> {",
        generatedLine: "// Auto-generated by `stack apply` — webhook handler stub for clerk.",
        forgeLine: "//   // to this endpoint can forge a clerk webhook.",
      },
    ],
    [
      "supabase",
      {
        headerLine: '//   const signature = req.headers.get("x-supabase-signature");',
        revealLine: "//   // (`phantom reveal SUPABASE_WEBHOOK_SECRET`) and compare in",
        handlerLine:
          "// export async function handleSupabaseWebhook(req: Request): Promise<Response> {",
        generatedLine: "// Auto-generated by `stack apply` — webhook handler stub for supabase.",
        forgeLine: "//   // to this endpoint can forge a supabase webhook.",
      },
    ],
    [
      "github",
      {
        headerLine: '//   const signature = req.headers.get("x-hub-signature-256");',
        revealLine: "//   // (`phantom reveal GITHUB_WEBHOOK_SECRET`) and compare in",
        handlerLine:
          "// export async function handleGithubWebhook(req: Request): Promise<Response> {",
        generatedLine: "// Auto-generated by `stack apply` — webhook handler stub for github.",
        forgeLine: "//   // to this endpoint can forge a github webhook.",
      },
    ],
  ])("expands each %s placeholder with the punctuation around it intact", (provider, want) => {
    const lines = webhookStubFor(provider).split("\n");

    // `get("${...}");` — the header placeholder is wrapped in a quote, parens,
    // and a semicolon; all of them are literal template text.
    expect(lines).toContain(want.headerLine);

    // `` (`...`) `` — the secret-name placeholder sits inside a backtick pair
    // and parentheses.
    expect(lines).toContain(want.revealLine);

    // `handle${...}Webhook(` — the provider placeholder expands mid-identifier
    // with an open paren immediately after the replacement.
    expect(lines).toContain(want.handlerLine);

    // `${...}.` — the provider placeholder ends two sentences; the periods
    // after it survive expansion untouched.
    expect(lines).toContain(want.generatedLine);
    expect(lines).toContain(want.forgeLine);
  });

  it("preserves punctuation around interpolated values in the written webhook stub", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(result.webhooks).toHaveLength(1);
    const stub = readFileSync(result.webhooks[0] as string, "utf-8");
    const lines = stub.split("\n");

    expect(lines).toContain('//   const signature = req.headers.get("stripe-signature");');
    expect(lines).toContain("//   // (`phantom reveal STRIPE_WEBHOOK_SECRET`) and compare in");
    expect(lines).toContain(
      "// Auto-generated by `stack apply` — webhook handler stub for stripe.",
    );
    expect(stub).not.toContain("${signatureHeaderFor(provider)}");
    expect(stub).not.toContain("${webhookSecretKeyFor(provider)}");
  });

  it.each([
    [
      "stripe",
      {
        cap: "Stripe",
        secret: "STRIPE_WEBHOOK_SECRET",
        header: "stripe-signature",
        hint: "Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance.",
      },
    ],
    [
      "clerk",
      {
        cap: "Clerk",
        secret: "CLERK_WEBHOOK_SECRET",
        header: "svix-signature",
        hint: "Clerk (svix): `new Webhook(secret).verify(body, headers)`.",
      },
    ],
    [
      "supabase",
      {
        cap: "Supabase",
        secret: "SUPABASE_WEBHOOK_SECRET",
        header: "x-supabase-signature",
        hint: "Supabase: `x-supabase-signature` per Supabase's documented webhook scheme.",
      },
    ],
    [
      "github",
      {
        cap: "Github",
        secret: "GITHUB_WEBHOOK_SECRET",
        header: "x-hub-signature-256",
        hint: "GitHub: `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body.",
      },
    ],
  ])(
    "replaces each known %s placeholder and leaves the punctuation around its slot unchanged",
    (provider, want) => {
      // Every `${...}` slot in the `base` template sits inside literal
      // punctuation: `"` and parens around the signature header, backticks
      // and parens around the reveal reminder, `.` after the provider
      // slots, a line break after the reveal and hint slots. Substitution
      // fills only the slot — the bytes on either side are template text
      // and must arrive hugging the replacement exactly: none consumed as
      // syntax, none dropped, duplicated, or reordered.
      const source = readFileSync(
        fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
        "utf-8",
      );
      const base = source.match(/const base = `([\s\S]*?)`;\n/)?.[1];
      if (base === undefined) throw new Error("webhook stub template not found in source");
      // `\`` escapes in the literal are `` ` `` bytes in the template's value.
      const template = base.replaceAll("\\`", "`");

      const values = new Map([
        ["${provider}", provider],
        ["${capitalize(provider)}", want.cap],
        ["${webhookSecretKeyFor(provider)}", want.secret],
        ["${signatureHeaderFor(provider)}", want.header],
        ["${verificationHintFor(provider)}", want.hint],
      ]);

      // Sanity: the template holds exactly the seven known slots — the raw
      // provider name twice, the capitalized handler name, the header and
      // the hint once each, and the secret name twice.
      const slots = [...template.matchAll(/\$\{[^}]*\}/g)];
      expect(slots.map((s) => s[0])).toEqual([
        "${provider}",
        "${webhookSecretKeyFor(provider)}",
        "${capitalize(provider)}",
        "${signatureHeaderFor(provider)}",
        "${provider}",
        "${verificationHintFor(provider)}",
        "${webhookSecretKeyFor(provider)}",
      ]);

      const stub = webhookStubFor(provider);
      for (const [index, slot] of slots.entries()) {
        const value = values.get(slot[0]);
        if (value === undefined) throw new Error(`template slot ${slot[0]} has no known value`);
        const at = slot.index ?? 0;
        const end = at + slot[0].length;
        // A window of the fixed text on each side of the slot — the slot's
        // punctuation envelope — must arrive verbatim around the value.
        // Each window stops at the neighboring slot so it stays fixed
        // template text (the forge-line and hint slots sit only 18 bytes
        // apart).
        const prevEnd =
          index === 0 ? 0 : (slots[index - 1]?.index ?? 0) + (slots[index - 1]?.[0].length ?? 0);
        const nextStart = slots[index + 1]?.index ?? template.length;
        const before = template.slice(Math.max(prevEnd, at - 24), at);
        const after = template.slice(end, Math.min(nextStart, end + 24));
        expect(stub).toContain(`${before}${value}${after}`);
      }
      // No placeholder syntax survives: every known slot was filled.
      expect(stub).not.toContain("${");
    },
  );

  it.each([
    ["stripe", "Stripe"],
    ["clerk", "Clerk"],
    ["supabase", "Supabase"],
    ["github", "Github"],
  ])("substitutes the %s placeholder between the ordinary words flanking it", (provider, cap) => {
    // `handle${capitalize(provider)}Webhook` is the template's one slot
    // bounded on both sides by plain word characters: `handle` before and
    // `Webhook` after, with no whitespace or punctuation separating the
    // slot from either word. Expansion must land the capitalized name
    // flush between them — nothing inserted, no part of either neighbor
    // consumed.
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    const base = source.match(/const base = `([\s\S]*?)`;\n/)?.[1];
    if (base === undefined) throw new Error("webhook stub template not found in source");
    // Sanity: in the template the slot really does sit between the words.
    expect(base).toContain("handle${capitalize(provider)}Webhook");

    const stub = webhookStubFor(provider);
    const handlerLine = stub.split("\n").find((l) => l.includes("export async function"));
    // Both surrounding words preserved verbatim, the replacement flush
    // between them — the whole line is byte-exact, not a loose match.
    expect(handlerLine).toBe(
      `// export async function handle${cap}Webhook(req: Request): Promise<Response> {`,
    );
    // Taking the replacement back out leaves the neighbors joined:
    // `handle` and `Webhook` each came through untouched on their side
    // of the slot, with nothing left between them.
    expect(handlerLine?.split(cap).join("")).toBe(
      "// export async function handleWebhook(req: Request): Promise<Response> {",
    );

    // The same holds for a slot between space-separated words:
    // `forge a ${provider} webhook.` keeps `a` and `webhook` exactly one
    // space from the expanded name on each side.
    const forgeLine = stub.split("\n").find((l) => l.includes("forge a"));
    expect(forgeLine).toBe(`//   // to this endpoint can forge a ${provider} webhook.`);
    expect(forgeLine?.split(` ${provider} `).join(" ")).toBe(
      "//   // to this endpoint can forge a webhook.",
    );
  });

  it.each([
    ["stripe", "STRIPE_WEBHOOK_SECRET", "Stripe"],
    ["clerk", "CLERK_WEBHOOK_SECRET", "Clerk"],
  ])(
    "expands both %s secret-name placeholders and keeps the ordinary text between them exact",
    (provider, secret, cap) => {
      // The secret-name placeholder repeats: once in the reveal instruction and
      // once in the TODO reminder. Slice the stub from the first replacement to
      // the second; the template text in between must come through byte for
      // byte, with the provider-name slots inside it expanded and no extra copy
      // of the secret name.
      const stub = webhookStubFor(provider);
      const first = stub.indexOf(secret);
      const second = stub.indexOf(secret, first + secret.length);
      expect(first).toBeGreaterThan(-1);
      expect(second).toBeGreaterThan(first);
      expect(stub.indexOf(secret, second + secret.length)).toBe(-1);

      const between = stub.slice(first + secret.length, second);
      expect(between.startsWith("\n//\n// export async function handle")).toBe(true);
      expect(
        between.endsWith(
          "\n//   // Verify over the exact raw body bytes with the webhook secret\n//   // (`phantom reveal ",
        ),
      ).toBe(true);
      expect(between).not.toContain(secret);
      expect(between).toContain(`handle${cap}Webhook(req: Request)`);
      expect(between).toContain(`forge a ${provider} webhook.`);
      expect(between).not.toContain("${");
    },
  );

  it("keeps punctuation inside an expanded provider name verbatim beside the template's marks", () => {
    // `.`, `(`, and `)` in the name are data, not syntax: they expand
    // byte-for-byte next to the template's own `.`, `(`, and backticks.
    const stub = webhookStubFor("acme-hooks.io(2)");
    expect(stub).toContain("webhook handler stub for acme-hooks.io(2).");
    expect(stub).toContain("forge a acme-hooks.io(2) webhook.");
    expect(stub).toContain("handleAcme-hooks.io(2)Webhook(req: Request)");
    expect(stub).toContain("phantom reveal ACME-HOOKS.IO(2)_WEBHOOK_SECRET");
    expect(stub).not.toContain("${");
  });

  it("leaves an unmatched closing placeholder delimiter in a provider name unchanged", async () => {
    // `}` ends a `${...}` placeholder only when a `${` opened one; on its own
    // it is incomplete text. Expansion must carry it byte-for-byte — never
    // pair it with the template's own braces, consume it as syntax, or
    // duplicate it.
    // `}`s the template itself contributes (the `{ status: ... }` literals and
    // the closing `// }`), measured on a name that carries none.
    const templateClosers = webhookStubFor("zzq").split("}").length - 1;
    for (const name of ["pay}ment", "hooks}}", "}"]) {
      const stub = webhookStubFor(name);
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${name[0].toUpperCase()}${name.slice(1)}Webhook(req: Request)`);
      expect(stub).toContain(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`);
      // No stray closer completes a placeholder, and the stub holds exactly
      // the template's own `}`s plus the ones the name carried into its five
      // expansion sites (header, forge line, handler name, two reveal lines).
      expect(stub).not.toContain("${");
      const closers = name.split("}").length - 1;
      expect(stub.split("}").length - 1).toBe(templateClosers + closers * 5);
    }

    // Through wiring the same name matches no catalog provider: it returns in
    // `skipped` byte-for-byte and never reaches the stub template or disk.
    const name = "stripe}";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [name],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("preserves a placeholder-shaped provider name without a second substitution", async () => {
    // `pay${provider}ment` carries text shaped exactly like a template
    // placeholder. Expansion runs once, so the inserted `${provider}` is data
    // and must come back byte-for-byte at every site the name fills. A second
    // substitution pass would re-expand it — nesting the name into itself as
    // `paypay${provider}mentment` — resolve it to an unrelated value, or
    // throw on the unresolvable slot.
    const provider = "pay${provider}ment";
    const stub = webhookStubFor(provider);

    // Direct `${provider}` slots: verbatim.
    expect(stub).toContain("webhook handler stub for pay${provider}ment.");
    expect(stub).toContain("forge a pay${provider}ment webhook.");
    // `capitalize(provider)` slot: only the first letter folds.
    expect(stub).toContain("handlePay${provider}mentWebhook(req: Request)");
    // `webhookSecretKeyFor(provider)` slot: uppercases the whole name,
    // placeholder-shaped text included, in both reveal lines.
    expect(stub.split("PAY${PROVIDER}MENT_WEBHOOK_SECRET").length - 1).toBe(2);

    // Exactly five `${` sequences survive — the ones the name carried into
    // its five expansion sites. Re-substituting would leave zero, and a
    // fixpoint loop re-expanding `${provider}` would double the surrounding
    // text into `paypay…mentment`.
    expect(stub.split("${").length - 1).toBe(5);
    expect(stub).not.toContain("paypay");
    expect(stub).not.toContain("mentment");

    // Through wiring the same name matches no catalog provider: it returns in
    // `skipped` byte-for-byte and never reaches the stub template or disk.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [provider],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("leaves a lone unknown placeholder in a provider name unchanged", async () => {
    // `${HOOK_URL}` matches none of the template's slots — expansion fills
    // `provider`, `capitalize(provider)`, `webhookSecretKeyFor(provider)`, and
    // `signatureHeaderFor(provider)`; a `${...}` arriving inside the name has
    // no substitution and is pure data. Carried once, it reaches all five
    // expansion sites → five occurrences. A pass that resolved the token to
    // an empty string or an environment value, dropped it, or re-ran
    // substitution on the output would change that count or leave zero `${`
    // behind. One name carries the token mid-string; the other is nothing
    // but the token, so the whole name is placeholder-shaped text that must
    // still be treated as data, not a slot to fill.
    for (const name of ["pay${HOOK_URL}ment", "${HOOK_URL}"]) {
      const stub = webhookStubFor(name);

      // Every `${...}` in the stub is the carried-in token — unchanged,
      // byte-for-byte, one per expansion site.
      const placeholders = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(placeholders).toHaveLength(5);
      for (const token of placeholders) expect(token).toBe("${HOOK_URL}");

      // Raw sites: the header and forge lines carry the name, token included.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      // Isolate the interpolated value from the surrounding template text.
      const generatedLine = stub.split("\n")[0];
      const prefix = "// Auto-generated by `stack apply` — webhook handler stub for ";
      expect(generatedLine.slice(prefix.length, -1)).toBe(name);
      // `capitalize(provider)` site: only the name's first letter folds — for
      // the token-only name that letter is `$`, which has no case mapping.
      expect(stub).toContain(`handle${name[0].toUpperCase()}${name.slice(1)}Webhook(req: Request)`);
      // `webhookSecretKeyFor(provider)` sites: the already-uppercase token
      // survives uppercasing in both reveal lines.
      expect(stub.split(`${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);
    }

    // Through wiring a name that is nothing but the placeholder still matches
    // no catalog provider: it returns in `skipped` byte-for-byte and never
    // reaches the stub template or disk.
    const name = "${HOOK_URL}";
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [name],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("leaves a provider name consisting solely of an unknown placeholder unchanged", async () => {
    // The whole name is one placeholder token with no ordinary text around
    // it — the degenerate case of the lone `${HOOK_URL}` above, extended to
    // every placeholder syntax this template does not define: `{{...}}`,
    // `%...%`, `%s`, `$1`, `$&`, plus an unknown token in the `${...}` syntax
    // it does use. With nothing else in the name, a pass that tried to
    // resolve the token would leave an empty name, substitute an unrelated
    // value, or throw on the unresolvable slot; carried as data, each name
    // lands at every expansion site byte-for-byte instead.
    const names = ["{{UNKNOWN}}", "%UNKNOWN%", "%s", "$1", "$&", "${unknownName}"];
    for (const name of names) {
      const stub = webhookStubFor(name);

      // The template contributes none of these tokens itself, so every
      // occurrence in the stub is one the name carried in.
      expect(webhookStubFor("zzq")).not.toContain(name);
      // Raw sites: the header and forge lines carry the name byte-for-byte.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      // `capitalize(provider)` site: each token starts with a non-letter, so
      // capitalize folds nothing and this site is verbatim too.
      expect(stub).toContain(`handle${name[0].toUpperCase()}${name.slice(1)}Webhook(req: Request)`);
      // `webhookSecretKeyFor(provider)` sites: the only transform — the whole
      // name uppercases, token included, in both reveal lines.
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

      // Occurrence accounting: three case-preserving sites (header, forge,
      // handler) hold the token verbatim; the two reveal lines hold its
      // uppercased form. A resolver that emptied or re-expanded the token
      // would leave zero behind.
      expect(stub.split(name).length - 1).toBe(name === name.toUpperCase() ? 5 : 3);
      if (name !== name.toUpperCase()) {
        expect(stub.split(name.toUpperCase()).length - 1).toBe(2);
      }

      // An unknown name gets the generic signature header and the fallback
      // hint — nothing provider-specific leaked in alongside the token.
      expect(stub).toContain('req.headers.get("x-webhook-signature")');
      expect(verificationHintFor(name)).toBe(
        "Verify per the provider's documented signature scheme.",
      );
    }

    // Through wiring every solely-placeholder name matches no catalog
    // provider: each returns in `skipped` byte-for-byte and nothing reaches
    // the stub dir or the vault.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: names.map((name) => ({ name })) };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: names,
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
  });

  it("leaves every occurrence of a repeated unknown placeholder in a provider name unchanged", async () => {
    // `${HOOK_URL}` matches none of the template's slots — expansion fills
    // `provider`, `capitalize(provider)`, `webhookSecretKeyFor(provider)`, and
    // `signatureHeaderFor(provider)`; a `${...}` arriving inside the name has
    // no substitution and is pure data. Carried twice, it reaches all five
    // expansion sites → ten occurrences. A pass that resolved, dropped, or
    // merged only the first occurrence would change that count, and a
    // re-substitution pass would leave zero `${` sequences behind.
    const provider = "pay${HOOK_URL}me${HOOK_URL}nt";
    const stub = webhookStubFor(provider);

    // Every `${...}` in the stub is one of the ten carried-in occurrences of
    // the same unknown token — unchanged, byte-for-byte, at every site.
    const placeholders = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(placeholders).toHaveLength(10);
    for (const token of placeholders) expect(token).toBe("${HOOK_URL}");

    // Raw sites: the header and forge lines carry the name, tokens included.
    expect(stub).toContain("webhook handler stub for pay${HOOK_URL}me${HOOK_URL}nt.");
    expect(stub).toContain("forge a pay${HOOK_URL}me${HOOK_URL}nt webhook.");
    // `capitalize(provider)` site: only the name's first letter folds.
    expect(stub).toContain("handlePay${HOOK_URL}me${HOOK_URL}ntWebhook(req: Request)");
    // `webhookSecretKeyFor(provider)` sites: uppercasing leaves the already
    // uppercase token untouched in both reveal lines.
    expect(stub.split("PAY${HOOK_URL}ME${HOOK_URL}NT_WEBHOOK_SECRET").length - 1).toBe(2);

    // Through wiring the name matches no catalog provider: it returns in
    // `skipped` byte-for-byte and never reaches the stub template or disk.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [provider],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("leaves two different adjacent unknown placeholders in a provider name unchanged", async () => {
    // Two distinct unknown tokens touching each other, with no text between
    // them and with ordinary text on either side. Each token reaches all five
    // expansion sites → five of each, ten in total, in order and unmerged.
    const first = "${HOOK_URL}";
    const second = "${API_BASE}";
    for (const provider of [`pay${first}${second}ment`, `${first}${second}`, `${second}${first}`]) {
      const stub = webhookStubFor(provider);

      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(10);
      expect(tokens.filter((t) => t === first)).toHaveLength(5);
      // Uppercasing at the secret-key sites leaves both already-uppercase tokens intact.
      expect(tokens.filter((t) => t === second)).toHaveLength(5);

      // Raw sites carry the name byte-for-byte, tokens in their original order.
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      expect(stub).toContain(
        `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook(req: Request)`,
      );
      expect(stub.split(`${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);
      // Neither token resolves a slot: the generic signature header applies.
      expect(stub).toContain('req.headers.get("x-webhook-signature")');
    }

    // Through wiring both names match no catalog provider: each returns in
    // `skipped` unchanged and nothing is written or added.
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: first }, { name: second }, { name: `${first}${second}` }],
    };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [first, second, `${first}${second}`],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("leaves every occurrence of a repeated slot-named placeholder in a provider name unchanged", () => {
    // `${provider}` repeated twice, back to back and apart: the token is
    // named like a real template slot, but arriving inside the name it is
    // data. Two tokens × five expansion sites → ten occurrences, none
    // expanded, merged, or dropped. Adjacent tokens are the case most likely
    // to be collapsed by a global-replace pass.
    for (const provider of ["a${provider}${provider}b", "x${provider}y${provider}z"]) {
      const stub = webhookStubFor(provider);
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(10);
      // The two secret-key sites uppercase the whole name; the rest keep case.
      for (const token of tokens) expect(token.toLowerCase()).toBe("${provider}");
      expect(tokens.filter((t) => t === "${PROVIDER}")).toHaveLength(4);
      expect(stub).toContain(`${provider.toUpperCase()}_WEBHOOK_SECRET`);
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
    }
  });

  it("keeps a known placeholder used as the whole replacement text literal at every expansion site", async () => {
    // Each of the template's slots is a known placeholder: `${provider}`,
    // `${capitalize(provider)}`, `${webhookSecretKeyFor(provider)}`,
    // `${signatureHeaderFor(provider)}` and `${verificationHintFor(provider)}`.
    // As the whole provider name the token is still replacement text — data —
    // not a slot to fill. A pass that expanded the inserted text a second
    // time would splice each token's own value into its place (the header
    // token becoming `x-webhook-signature`, the secret-key token growing a
    // doubled `_WEBHOOK_SECRET`, the hint token sprouting the fallback
    // sentence), and every self-referential `${provider}` in the last name
    // would double with each pass. Carried literally, each token lands
    // byte-for-byte at all five name sites instead.
    const names = [
      "${provider}",
      "${capitalize(provider)}",
      "${webhookSecretKeyFor(provider)}",
      "${signatureHeaderFor(provider)}",
      "${verificationHintFor(provider)}",
      "${provider}${provider}",
    ];
    for (const provider of names) {
      const stub = webhookStubFor(provider);

      // Raw `${provider}` sites: the header and forge lines carry the name,
      // token included, byte-for-byte.
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      // `capitalize(provider)` site: the name starts with `$`, which has no
      // case mapping, so the token arrives unchanged.
      expect(stub).toContain(`handle${provider}Webhook(req: Request)`);
      // `webhookSecretKeyFor(provider)` sites: the whole name — token
      // included — uppercases in both reveal lines.
      expect(stub.split(`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(
        2,
      );

      // Every `${` in the stub is one the name carried into an expansion
      // site — none resolved away, and none added by a second pass doubling
      // a self-referential `${provider}` or splicing in a derived value.
      expect(stub.split("${").length - 1).toBe((provider.split("${").length - 1) * 5);
      // The derived slots' own values stay at their own sites: the generic
      // signature header and the fallback hint appear exactly once each —
      // at their own slots, not at a name site — and no `_WEBHOOK_SECRET`
      // suffix doubles up.
      expect(stub.split("x-webhook-signature").length - 1).toBe(1);
      expect(stub.split("Verify per the provider's documented signature scheme.").length - 1).toBe(
        1,
      );
      expect(stub).not.toContain("WEBHOOK_SECRET_WEBHOOK_SECRET");
      // No template text was spliced in around the tokens: the stub keeps a
      // plain name's shape.
      expect(stub.split("\n").length).toBe(webhookStubFor("zzqhook").split("\n").length);
    }

    // Through wiring every solely-placeholder name matches no catalog
    // provider: each returns in `skipped` byte-for-byte and nothing reaches
    // the stub dir or the vault.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: names.map((name) => ({ name })) };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: names });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("substitutes a known placeholder and leaves an unknown placeholder beside it intact", async () => {
    // A known provider (`stripe`) wired next to an unknown placeholder-shaped
    // name (`${HOOK_URL}`), both in one recipe and both as one adjacent name.
    const unknown = "${HOOK_URL}";

    // Adjacent in one name: the known `stripe` prefix gets no special
    // treatment — it is data, and the unknown token stays byte-for-byte.
    for (const name of [`stripe${unknown}`, `${unknown}stripe`]) {
      const stub = webhookStubFor(name);
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain("x-webhook-signature");
      expect(stub).not.toContain("stripe-signature");
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(5);
      for (const token of tokens) expect(token).toBe(unknown);
    }

    // Adjacent in one recipe: the known provider is fully substituted in the
    // stub on disk; the unknown placeholder is skipped, unchanged, and writes
    // nothing.
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: "stripe" }, { name: unknown }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    // Only the unknown name is asserted on `skipped`: `stripe` may also land
    // there when the vault inventory is unreadable, which is not under test.
    expect(result.skipped).toContain(unknown);
    expect(result.skipped.filter((n) => n !== "stripe")).toEqual([unknown]);
    expect(result.webhooks).toEqual([join(harness.dir, ".stack/webhooks/stripe.ts")]);
    const stub = readFileSync(result.webhooks[0] as string, "utf-8");
    expect(stub).toBe(webhookStubFor("stripe"));
    expect(stub).toContain("STRIPE_WEBHOOK_SECRET");
    expect(stub).not.toContain("${");
    expect(existsSync(join(harness.dir, ".stack/webhooks", `${unknown}.ts`))).toBe(false);
  });

  it("leaves an unknown placeholder unchanged and still substitutes the known provider listed after it", async () => {
    // `${HOOK_URL}` is an unknown placeholder-shaped provider name wired
    // BEFORE a known provider (`stripe`) in one recipe — the reverse of the
    // ordering above. A pass that bails on the first skipped name (early
    // return, break, or a cursor that consumes two entries per step) wires
    // stripe fine when it leads the list but leaves it unwired here. The
    // unknown name must come back in `skipped` byte-for-byte while stripe is
    // fully substituted.
    const unknown = "${HOOK_URL}";
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: unknown }, { name: "stripe" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });

    // The unknown placeholder leads `skipped` unchanged; the vault is
    // readable here, so stripe is processed rather than skipped.
    expect(result.skipped).toEqual([unknown]);
    expect(result.skipped[0]).toBe("${HOOK_URL}");
    // The known provider is replaced: its declared secret reports missing
    // and its stub is the fully expanded template — every slot filled, no
    // placeholder text left.
    expect(result.present).toEqual([]);
    expect(result.missing).toEqual(["stripe:STRIPE_SECRET_KEY"]);
    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(result.webhooks).toEqual([stubPath]);
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toBe(webhookStubFor("stripe"));
    expect(stub).toContain("STRIPE_WEBHOOK_SECRET");
    expect(stub).toContain("stripe-signature");
    expect(stub).not.toContain("${");

    // The unknown placeholder writes nothing of its own — no stub file and
    // no vault writes — and wiring reads the vault inventory exactly once.
    expect(existsSync(join(harness.dir, ".stack/webhooks", `${unknown}.ts`))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
  });

  it("leaves a repeated unknown placeholder in other syntaxes unchanged at every expansion site", () => {
    // `{{x}}`, `%s`, `$&` and `$1` are placeholder/replacement syntaxes other
    // than `${...}`. None is a template slot here, so each repeated token must
    // come through verbatim — in particular `$&` / `$1` must not be read as
    // String.replace patterns that splice in matched text.
    for (const token of ["{{HOOK_URL}}", "%s", "$&", "$1"]) {
      const provider = `ab${token}cd${token}ef`;
      const stub = webhookStubFor(provider);
      // Raw sites (header + forge line) carry the name, both tokens included.
      expect(stub).toContain(`webhook handler stub for ${provider}.`);
      expect(stub).toContain(`forge a ${provider} webhook.`);
      // Capitalized site: only the first letter folds.
      expect(stub).toContain(`handleAb${token}cd${token}efWebhook(req: Request)`);
      // The template carries no token of its own, and the raw and capitalized
      // sites are the case-preserving ones: three sites, two tokens each.
      expect(stub.split(token).length - 1).toBeGreaterThanOrEqual(6);
      expect(webhookStubFor("abcdef").split(token).length - 1).toBe(0);
    }
  });

  it("leaves a nested placeholder in a provider name unexpanded at every expansion site", async () => {
    // `pay${${provider}}ment` nests one placeholder-shaped token inside
    // another: an outer `${` whose contents are themselves `${provider}`.
    // Carried as data, the whole name lands byte-for-byte at all five
    // expansion sites. A second substitution pass over the rendered stub
    // would misread it: `/\$\{[^}]*\}/` matches `${${provider}` — outer
    // opener to the INNER `}` — leaving the outer `}` stray, while a
    // fixpoint loop expanding the inner `${provider}` first would splice
    // the name into itself as `paypay${${provider}}mentment`. Either
    // re-expansion mangles the inserted text; neither may happen.
    const provider = "pay${${provider}}ment";
    const stub = webhookStubFor(provider);
    const baseline = webhookStubFor("zzq");

    // Raw sites: the header and forge lines carry the name, nested token included.
    expect(stub).toContain(`webhook handler stub for ${provider}.`);
    expect(stub).toContain(`forge a ${provider} webhook.`);
    // `capitalize(provider)` site: only the name's first letter folds.
    expect(stub).toContain("handlePay${${provider}}mentWebhook(req: Request)");
    // `webhookSecretKeyFor(provider)` sites: the nested token uppercases
    // with the rest of the name in both reveal lines.
    expect(stub.split("phantom reveal PAY${${PROVIDER}}MENT_WEBHOOK_SECRET").length - 1).toBe(2);
    // The inserted name resolves no slots: the unknown name still takes the
    // generic header and hint, unchanged.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");

    // What a re-expansion regex would match at each site — outer `${` to the
    // inner `}` — survives untouched: three case-preserving sites carry
    // `${${provider}` and the two reveal sites `${${PROVIDER}`.
    const matches = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(matches).toHaveLength(5);
    expect(matches.filter((t) => t === "${${provider}")).toHaveLength(3);
    expect(matches.filter((t) => t === "${${PROVIDER}")).toHaveLength(2);

    // Ten `${` openers and ten `}` closers beyond the template's own — the
    // name's two of each × five sites. Re-expanding the inner token would
    // consume one `}` per site as its closer and leave the outer one stray;
    // expanding the outer token would leave zero `${` behind.
    expect(stub.split("${").length - 1).toBe(10);
    expect(stub.split("}").length - 1).toBe(baseline.split("}").length - 1 + 10);
    expect(stub.split("\n").length).toBe(baseline.split("\n").length);
    // No self-splice: the name never nests into itself and nothing resolves.
    expect(stub).not.toContain("paypay");
    expect(stub).not.toContain("mentment");

    // `${{provider}}` misreads the same way — inner text in braces is data,
    // not a slot; the token survives verbatim at all five sites.
    const mismatched = "a${{provider}}b";
    const mStub = webhookStubFor(mismatched);
    expect(mStub).toContain(`webhook handler stub for ${mismatched}.`);
    expect(mStub).toContain(`forge a ${mismatched} webhook.`);
    expect(mStub).toContain("handleA${{provider}}bWebhook(req: Request)");
    expect(mStub.split("phantom reveal A${{PROVIDER}}B_WEBHOOK_SECRET").length - 1).toBe(2);
    expect(mStub.split("${").length - 1).toBe(5);
    expect(mStub.split("}").length - 1).toBe(baseline.split("}").length - 1 + 10);

    // Through wiring the nested name matches no catalog provider: it returns
    // in `skipped` byte-for-byte and never reaches the stub template or disk.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [provider],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("preserves unterminated and empty placeholder-looking text in a provider name without re-expansion", async () => {
    // `pay${HOOK` is an unterminated `${` opener and `pay${}ment` an empty
    // placeholder: both look like substitution syntax, but neither is a
    // slot the template fills. Carried as data, each must land byte-for-byte
    // at all five expansion sites (header, forge line, handler name, two
    // reveal lines). A second substitution pass over the rendered stub would
    // treat them as syntax instead: resolving the empty `${}` to "" or
    // "undefined", or pairing the dangling `${` with the template's own next
    // `}` — `{ status: 200 }` or the closing `// }` — and swallowing the
    // comment text between them into the "slot".
    const baseline = webhookStubFor("zzq");
    expect(baseline).not.toContain("${");
    const baselineClosers = baseline.split("}").length - 1;
    const baselineLines = baseline.split("\n").length;

    const dangling = "pay${HOOK";
    const stub = webhookStubFor(dangling);
    expect(stub).toContain(`webhook handler stub for ${dangling}.`);
    expect(stub).toContain(`forge a ${dangling} webhook.`);
    expect(stub).toContain("handlePay${HOOKWebhook(req: Request)");
    expect(stub.split("phantom reveal PAY${HOOK_WEBHOOK_SECRET").length - 1).toBe(2);
    // Five `${` sequences — one per site, all unterminated — and the `}`
    // count is exactly the template's own: no closer was borrowed to
    // complete the opener, and nothing after it was consumed.
    expect(stub.split("${").length - 1).toBe(5);
    expect(stub.split("}").length - 1).toBe(baselineClosers);
    expect(stub.split("\n").length).toBe(baselineLines);

    const empty = "pay${}ment";
    const emptyStub = webhookStubFor(empty);
    expect(emptyStub).toContain(`webhook handler stub for ${empty}.`);
    expect(emptyStub).toContain(`forge a ${empty} webhook.`);
    expect(emptyStub).toContain("handlePay${}mentWebhook(req: Request)");
    expect(emptyStub.split("phantom reveal PAY${}MENT_WEBHOOK_SECRET").length - 1).toBe(2);
    // `/\$\{[^}]*\}/` matches `${}` — the only placeholder-shaped tokens in
    // the stub are the five the name carried in, each preserved verbatim.
    // A re-substitution pass would resolve the empty slot to "" or
    // "undefined"; neither happens.
    const tokens = [...emptyStub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(5);
    for (const token of tokens) expect(token).toBe("${}");
    expect(emptyStub).not.toContain("undefined");
    expect(emptyStub).not.toContain("handlePaymentWebhook");
    expect(emptyStub.split("}").length - 1).toBe(baselineClosers + 5);

    // Through wiring a name carrying the dangling opener matches no catalog
    // provider: it returns in `skipped` byte-for-byte and never reaches the
    // stub template or disk.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: dangling }] };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [dangling],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("leaves an incomplete opening placeholder in a provider name unchanged at every expansion site", async () => {
    // `${`, `{{`, and `{` open a placeholder only when a closer completes
    // them; on their own — trailing a name, leading it, stacked, or as the
    // whole name — each is incomplete text with no slot to fill. Carried as
    // data, every dangling opener lands byte-for-byte at all five expansion
    // sites (header, forge line, handler name, two reveal lines). A second
    // substitution pass over the rendered stub would treat them as syntax
    // instead: pairing a dangling `${` with the template's own next `}`
    // (`{ status: 400 }`, `{ status: 200 }`, the closing `// }`) and
    // swallowing the lines between into a "slot", or resolving the opener
    // to "" or "undefined".
    const baseline = webhookStubFor("zzq");
    expect(baseline).not.toContain("${");
    const baselineOpeners = baseline.split("{").length - 1;
    const baselineClosers = baseline.split("}").length - 1;
    const baselineLines = baseline.split("\n").length;

    for (const name of [
      "pay${", // trailing bare opener — the name ends inside the slot
      "${", // the name is nothing but an opener
      "${HOOK", // opener leading the name, never closed
      "pay${HOOK${", // an unclosed opener mid-name and another trailing
      "${${", // stacked openers, still never closed
      "pay{{HOOK", // `{{`-syntax opening, never closed
      "{{", // the whole name is a `{{` opener
      "{HOOK", // a lone `{` opening
    ]) {
      const stub = webhookStubFor(name);

      // Raw sites: the header and forge lines carry the name — incomplete
      // opening included — byte-for-byte.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      // `capitalize(provider)` site: only the name's first letter folds.
      expect(stub).toContain(`handle${name[0].toUpperCase()}${name.slice(1)}Webhook(req: Request)`);
      // `webhookSecretKeyFor(provider)` sites: the whole name — opener
      // included — uppercases in both reveal lines.
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

      // Opener accounting: every `${` and `{` in the stub is one the name
      // carried into its five expansion sites — none consumed as syntax and
      // none completed by a template `}`. The `}` count stays exactly the
      // template's own (no closer was borrowed), and the line count never
      // shrinks (no text was swallowed between a dangling opener and a
      // misread closer).
      expect(stub.split("${").length - 1).toBe((name.split("${").length - 1) * 5);
      expect(stub.split("{").length - 1).toBe(baselineOpeners + (name.split("{").length - 1) * 5);
      expect(stub.split("}").length - 1).toBe(baselineClosers);
      expect(stub.split("\n").length).toBe(baselineLines);

      // An incomplete name resolves no slot: the generic signature header
      // and the fallback hint apply, unchanged.
      expect(stub).toContain('req.headers.get("x-webhook-signature")');
      expect(verificationHintFor(name)).toBe(
        "Verify per the provider's documented signature scheme.",
      );
    }

    // Through wiring every incomplete-opening name matches no catalog
    // provider: each returns in `skipped` byte-for-byte and never reaches
    // the stub template or disk, and the vault stays read-only.
    const names = ["pay${", "${", "pay{{HOOK", "{{"];
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: names.map((name) => ({ name })) };
    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: names,
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("leaves a differently cased provider name unchanged in the stub unless it is explicitly defined", () => {
    // Only the lowercase names are defined; `Stripe` / `GITHUB` must take the
    // generic fallbacks and echo the given casing, never the stripe/github maps.
    const mixed = webhookStubFor("Stripe");
    expect(mixed).toContain("webhook handler stub for Stripe.");
    expect(mixed).toContain("phantom reveal STRIPE_WEBHOOK_SECRET"); // fallback uppercases the name
    expect(mixed).toContain('req.headers.get("x-webhook-signature")');
    expect(mixed).toContain("handleStripeWebhook");
    expect(mixed).toContain("Verify per the provider's documented signature scheme.");
    expect(mixed).not.toContain("stripe-signature");
    expect(mixed).not.toContain("constructEvent");

    const upper = webhookStubFor("GITHUB");
    expect(upper).toContain("webhook handler stub for GITHUB.");
    expect(upper).toContain('req.headers.get("x-webhook-signature")');
    expect(upper).toContain("handleGITHUBWebhook");
    expect(upper).not.toContain("x-hub-signature-256");
    expect(upper).not.toContain("sha256=");

    // The explicitly defined lowercase name still takes its own mapping.
    expect(webhookStubFor("github")).toContain('req.headers.get("x-hub-signature-256")');
  });

  it("writes no webhook stub for a differently cased provider name", async () => {
    for (const name of ["Stripe", "STRIPE", "sTrIpE"]) {
      const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name }] };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      expect(result.webhooks).toEqual([]);
      expect(result.skipped).toEqual([name]);
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual([]);
    }
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
  });

  it("keeps a differently cased unknown name unchanged while the known spelling expands", async () => {
    // `findProviderRef`, `WEBHOOK_PROVIDERS` and every stub switch map compare
    // exact bytes, so a differently cased spelling of a catalog name is a
    // different name — there is no case folding anywhere in the module.
    // Wiring `STRIPE` ahead of the known `stripe` in one recipe (unknown
    // first, so a pass that bails on the first skipped name would leave
    // stripe unwired): `STRIPE` must come back in `skipped` byte-for-byte —
    // not folded to `stripe`, not echoed as `Stripe` — while `stripe`
    // expands: its declared secret reports missing and the stub on disk is
    // the fully substituted stripe render.
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: "STRIPE" }, { name: "stripe" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });

    expect(result.skipped).toEqual(["STRIPE"]);
    expect(result.missing).toEqual(["stripe:STRIPE_SECRET_KEY"]);
    expect(result.present).toEqual([]);

    // One stub, for `stripe` only: every slot took the stripe mapping. The
    // directory holds exactly `stripe.ts` — no `STRIPE.ts` or other case
    // variant beside it (read via readdir so the check holds on
    // case-insensitive filesystems too).
    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(result.webhooks).toEqual([stubPath]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("stripe"));
    expect(readdirSync(join(harness.dir, ".stack/webhooks"))).toEqual(["stripe.ts"]);
    expect(harness.callsTo("add")).toEqual([]);

    // Rendered on its own the unknown casing is unchanged too: its bytes echo
    // verbatim at the raw and capitalized slots and every lookup takes the
    // generic branch, while the exact spelling expands to stripe's mappings.
    const upperStub = webhookStubFor("STRIPE");
    expect(upperStub).toContain("webhook handler stub for STRIPE.");
    expect(upperStub).toContain("forge a STRIPE webhook.");
    expect(upperStub).toContain("handleSTRIPEWebhook(req: Request)");
    expect(upperStub).toContain('req.headers.get("x-webhook-signature")');
    expect(upperStub).toContain("Verify per the provider's documented signature scheme.");
    expect(upperStub).not.toContain("stripe-signature");
    expect(upperStub).not.toContain("constructEvent");

    // The hint lookup is case-sensitive the same way: the known spelling
    // expands to the Stripe hint, the unknown casing takes the fallback.
    expect(verificationHintFor("stripe")).toContain("constructEvent");
    expect(verificationHintFor("STRIPE")).toBe(verificationHintFor("zzq"));
  });

  it("skips a path-traversal provider name without writing any stub", async () => {
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: "../../evil" }] };

    expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: ["../../evil"],
    });
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("expands placeholders with a Unicode replacement preserved exactly", async () => {
    // `cwd` is expanded into every webhook path and an unknown provider name
    // is expanded verbatim into `skipped`. The replacement's code points must
    // survive untouched: no NFC folding (decomposed é below), no
    // transliteration, no surrogate-pair mangling (🚀 is astral).
    const unicodeName = "cafe\u0301-провайдер-日本語-🚀";
    const projectDir = join(harness.dir, "projet — café ☕ 日本語");
    mkdirSync(projectDir, { recursive: true });

    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: unicodeName }, { name: "stripe" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: projectDir });

    const stubPath = join(projectDir, ".stack/webhooks/stripe.ts");
    expect(result).toEqual({
      present: [],
      missing: ["stripe:STRIPE_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [unicodeName],
    });
    expect(result.skipped[0]).toBe(unicodeName);
    expect(result.skipped[0]).not.toBe(unicodeName.normalize("NFC"));
    expect(existsSync(stubPath)).toBe(true);

    // The stub's own non-ASCII expansion (the em dashes in the header and the
    // provider's verification hint) round-trips through UTF-8 byte-for-byte.
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toContain("Auto-generated by `stack apply` — webhook handler stub for stripe.");
    expect(stub).toContain(
      "`stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance.",
    );
    expect(stub).not.toContain("�");
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("keeps a known provider name intact when Unicode text surrounds it", async () => {
    // A known name (`stripe`) wrapped in Unicode is a different name: it must
    // take the generic fallbacks and echo the surrounding text exactly in every
    // slot, never match the stripe maps and never be trimmed, NFC-folded or
    // split across a surrogate pair (🚀 is astral).
    const wrapped = "日本\u{1F680}stripe\u0301-провайдер🚀";
    const stub = webhookStubFor(wrapped);
    expect(stub).toContain(`webhook handler stub for ${wrapped}.`);
    expect(stub).toContain(`forge a ${wrapped} webhook.`);
    expect(stub).toContain(`handle${wrapped}Webhook(req: Request)`);
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("Verify per the provider's documented signature scheme.");
    expect(stub).not.toContain("stripe-signature");
    expect(stub).not.toContain("constructEvent");
    expect(stub).not.toContain("�");
    expect(stub).not.toContain(wrapped.normalize("NFC"));

    // The capitalized slot upper-cases only the first letter; the rest of the
    // Unicode text is untouched.
    expect(webhookStubFor("éstripe🚀")).toContain("handleÉstripe🚀Webhook(req: Request)");

    // Through wiring: the wrapped name is skipped, no stub is written for it,
    // and the plain known name beside it still gets its own.
    const recipe: Recipe = {
      ...STRIPE_RECIPE,
      providers: [{ name: `日本${"stripe"}🚀` }, { name: "stripe" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.skipped).toEqual(["日本stripe🚀"]);
    expect(result.webhooks).toEqual([join(harness.dir, ".stack/webhooks/stripe.ts")]);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("leaves the rendered stub byte-identical for every map entry the template never uses", async () => {
    // The stub's expansion sites draw only from `providers[].name`: the two
    // raw `${provider}` slots, `capitalize(provider)`, the two
    // `webhookSecretKeyFor(provider)` slots, and the `signatureHeaderFor` /
    // `verificationHintFor` lookups keyed by that same name. Every other
    // entry in the maps reaching wiring is an unused value — the recipe's
    // metadata fields, a provider's `rationale` and stray keys, extra `opts`
    // entries, and vault inventory entries the recipe never declares. None
    // may reach the rendered template: the stub must come out byte-for-byte
    // identical to the bare recipe's.
    harness.cleanup();
    harness = setupFakePhantom({
      UNUSED_VAULT_ENTRY: "stored value the recipe never names",
      SECOND_UNUSED_ENTRY: "another unused stored value",
    });

    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    const baseline = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(baseline.webhooks).toEqual([stubPath]);
    const baselineStub = readFileSync(stubPath, "utf-8");
    expect(baselineStub).toBe(webhookStubFor("stripe"));

    // Same used entries (`providers[].name`), different unused ones.
    const loaded = {
      id: "a-different-recipe-id",
      query: "an unused query entry",
      createdAt: "2031-05-06T07:08:09.000Z",
      providers: [
        {
          name: "stripe",
          rationale: "an unused rationale entry",
          stray: "an unused entry value",
        },
      ],
      guidance: "an unused guidance entry",
      projectContext: { unused: { nested: ["entry", "values"] } },
      strayRecipeKey: "an unused recipe entry",
    };
    const opts = { cwd: harness.dir, unusedOpt: "an unused opts entry" };
    const result = await wirePhantomForRecipe(loaded, opts);

    // The result and the rendered bytes are identical to the bare recipe's
    // run: undeclared vault names were never classified, and no unused entry
    // changed what the template renders.
    expect(result).toEqual(baseline);
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toBe(baselineStub);
    expect(stub).not.toContain("${");

    // No unused entry's text leaked into the render.
    for (const unused of [
      "a-different-recipe-id",
      "an unused query entry",
      "an unused rationale entry",
      "an unused entry value",
      "an unused guidance entry",
      "an unused recipe entry",
      "an unused opts entry",
      "UNUSED_VAULT_ENTRY",
      "SECOND_UNUSED_ENTRY",
      "stored value the recipe never names",
    ]) {
      expect(stub).not.toContain(unused);
    }
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("substitutes the provider placeholder amid Unicode text and keeps that text intact", () => {
    const provider = "stripe";
    const stub = webhookStubFor(provider);

    // Surrounding Unicode (em dash in the header) is preserved verbatim.
    expect(stub).toContain("`stack apply` — webhook handler stub for stripe.");

    // A provider name that is itself Unicode is substituted in place and the
    // fixed text on either side of every occurrence is unchanged.
    const uni = webhookStubFor("café-日本");
    expect(uni).toContain("`stack apply` — webhook handler stub for café-日本.");
    expect(uni).toContain("anyone who can POST");
    expect(uni).toContain("forge a café-日本 webhook.");
    expect(uni).not.toContain("stripe");

    // Replacing the placeholder back yields the known stub for the same provider.
    const sentinel = webhookStubFor("zzq");
    expect(uni.replaceAll("café-日本", "zzq")).toContain("stub for zzq.");
    expect(uni.split("\n").length).toBe(sentinel.split("\n").length);
    expect(
      uni
        .replaceAll("café-日本", "zzq")
        .replaceAll("CAFÉ-日本", "ZZQ")
        .replaceAll("Café-日本", "Zzq"),
    ).toBe(sentinel);
  });

  it("keeps text around a known placeholder exact, line by line, in the string and on disk", async () => {
    // Every line of a known provider's stub is compared against the same
    // template rendered for a sentinel: only the placeholder slots may differ,
    // so all surrounding text (em dashes included) is preserved exactly.
    const known = webhookStubFor("stripe").split("\n");
    const sentinel = webhookStubFor("zzq").split("\n");
    expect(known.length).toBe(sentinel.length);
    const changed = known.filter((line, i) => line !== sentinel[i]);
    expect(changed.length).toBeGreaterThan(0);
    for (const line of changed) {
      expect(line).toMatch(/stripe|Stripe|STRIPE/);
    }

    // The em dash is written as UTF-8 bytes E2 80 94, with no BOM, mojibake
    // or replacement character, and the file reads back identical to the
    // rendered string.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: "stripe" }] };
    await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    const bytes = readFileSync(join(harness.dir, ".stack/webhooks/stripe.ts"));
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("//");
    expect(bytes.includes(Buffer.from([0xe2, 0x80, 0x94]))).toBe(true);
    expect(bytes.toString("utf-8")).toBe(webhookStubFor("stripe"));

    // Case mapping reaches the secret-key slot: `ß` upper-cases to `SS`, and
    // the Unicode text on each side of the placeholder is otherwise unchanged.
    const stub = webhookStubFor("straße-日本");
    expect(stub).toContain("phantom reveal STRASSE-日本_WEBHOOK_SECRET");
    expect(stub).toContain("webhook handler stub for straße-日本.");
    expect(stub).toContain("handleStraße-日本Webhook(req: Request)");
  });

  it("returns a template with no placeholders unchanged across renders and through the stub", () => {
    // `verificationHintFor` is the module's template with no placeholders:
    // every branch returns one fixed string — the four provider hints and
    // the fallback — and none carries a `${`-slot of its own, so there is
    // nothing to expand and no slot a provider name could leak into.
    // "Unchanged" pins down three ways: the returned text holds no
    // placeholder-shaped bytes; repeated renders — even interleaved with
    // stub renders for other names — return the identical string; and
    // spliced into the outer stub template the hint lands as the whole line
    // `//   // ` + the template, byte-exact.
    const noSlots = /\$\{|\{\{|\$[&'`\d]|%[sdif]/;
    const hints: Record<string, string> = {
      stripe: "Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance.",
      clerk: "Clerk (svix): `new Webhook(secret).verify(body, headers)`.",
      supabase: "Supabase: `x-supabase-signature` per Supabase's documented webhook scheme.",
      github: "GitHub: `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body.",
    };
    for (const [provider, hint] of Object.entries(hints)) {
      expect(hint).not.toMatch(noSlots);
      webhookStubFor("unrelated");
      expect(verificationHintFor(provider)).toBe(hint);
      expect(verificationHintFor(provider)).toBe(verificationHintFor(provider));
      expect(webhookStubFor(provider).split("\n")).toContain(`//   // ${hint}`);
    }

    // The fallback is a no-placeholder template on the same terms: returned
    // unchanged for any unknown name — placeholder-shaped ones included —
    // and the stub's hint line is byte-exact.
    const fallback = verificationHintFor("payco");
    expect(fallback).toBe("Verify per the provider's documented signature scheme.");
    expect(fallback).not.toMatch(noSlots);
    expect(verificationHintFor("${provider}")).toBe(fallback);
    expect(webhookStubFor("payco").split("\n")).toContain(`//   // ${fallback}`);
    expect(webhookStubFor("payco")).toBe(webhookStubFor("payco"));
  });

  it("substitutes an empty template: every name slot splices the empty string, and wiring returns it verbatim", async () => {
    // The module's templates are fixed literals — there is no caller-supplied
    // template — so the empty case is the empty substitution: a provider name
    // of "". Each `${provider}` and `${capitalize(provider)}` slot then
    // splices the empty string, the fixed text on either side lands flush
    // together, and through wiring the name itself returns in `skipped` as
    // exactly the empty string — nothing fabricated to fill the blank.
    const stub = webhookStubFor("");

    // The two raw `${provider}` slots and the `${capitalize(provider)}` slot
    // each received "": prefix meets suffix with zero bytes between.
    expect(stub).toContain("webhook handler stub for .\n");
    expect(stub).toContain("forge a  webhook.");
    expect(stub).toContain("handleWebhook(req: Request): Promise<Response>");
    // Derived slots contribute their fixed text alone: the secret-name
    // template `${provider.toUpperCase()}_WEBHOOK_SECRET` renders
    // "_WEBHOOK_SECRET" at both reveal sites, and the signature-header and
    // hint fallbacks carry no name at all.
    expect(stub.split("phantom reveal _WEBHOOK_SECRET").length - 1).toBe(2);
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain(`// ${verificationHintFor("")}`);
    // An empty substitution adds no bytes: same shape as a populated stub,
    // no placeholder residue.
    expect(stub).not.toContain("${");
    expect(stub.endsWith("// }\n")).toBe(true);
    expect(stub.split("\n")).toHaveLength(webhookStubFor("payment").split("\n").length);

    // Replay the substitution out of the extracted `base` template with ""
    // as the provider value: every name slot maps to the empty string and
    // the reconstruction must equal webhookStubFor("") byte-for-byte.
    const source = readFileSync(
      fileURLToPath(new URL("../ai/phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    const base = source.match(/const base = `([\s\S]*?)`;\n/)?.[1];
    if (base === undefined) throw new Error("webhook stub template not found in source");
    // `\`` escapes in the literal are `` ` `` bytes in the template's value.
    const template = base.replaceAll("\\`", "`");

    // Guard: the template holds exactly the seven known slots, in order.
    expect([...template.matchAll(/\$\{[^}]*\}/g)].map((s) => s[0])).toEqual([
      "${provider}",
      "${webhookSecretKeyFor(provider)}",
      "${capitalize(provider)}",
      "${signatureHeaderFor(provider)}",
      "${provider}",
      "${verificationHintFor(provider)}",
      "${webhookSecretKeyFor(provider)}",
    ]);

    const rendered = template
      .replaceAll("${provider}", "")
      .replaceAll("${capitalize(provider)}", "")
      .replaceAll("${webhookSecretKeyFor(provider)}", "_WEBHOOK_SECRET")
      .replaceAll("${signatureHeaderFor(provider)}", "x-webhook-signature")
      .replaceAll("${verificationHintFor(provider)}", verificationHintFor(""));
    expect(rendered).toBe(stub);

    // Through wiring the empty name matches no catalog provider and is no
    // webhook provider, so the `${provider}.ts` filename template is never
    // instantiated: the name returns in `skipped` as the empty string
    // byte-for-byte, no stub reaches disk, and the vault stays read-only.
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: "" }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [""] });
    expect(result.skipped[0]).toBe("");
    expect(existsSync(join(harness.dir, ".stack/webhooks"))).toBe(false);
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
    expect(harness.callsTo("add")).toEqual([]);
  });
});
