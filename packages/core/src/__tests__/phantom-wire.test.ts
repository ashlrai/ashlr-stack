import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webhookStubFor, wirePhantomForRecipe } from "../ai/phantom-wire.ts";
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

  it("expands a provider name containing dollar signs literally in the webhook stub", () => {
    // `$&`, `$1`, `$$` and `` $` `` are special in String.replace replacement
    // strings; the stub must carry them through verbatim.
    const provider = "pay$&x$1$$y$`z";
    const stub = webhookStubFor(provider);
    expect(stub).toContain(`webhook handler stub for ${provider}.`);
    expect(stub).toContain(`forge a ${provider} webhook.`);
    expect(stub).toContain(`handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`);
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
});
