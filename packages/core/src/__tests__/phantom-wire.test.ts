import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import { type Recipe, readRecipe, writeRecipe } from "../ai/recipe.ts";
import { listSecrets } from "../phantom.ts";
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
});
