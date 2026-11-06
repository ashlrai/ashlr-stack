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

describe("ai/phantom-wire double quote in replacement text", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-double-quote-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "double-quote",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  // The template carries its own quotes: two around the fixed signature
  // header in `req.headers.get("...")`, two in `new Response("Missing
  // signature", ...)` and two in `new Response("ok", ...)`. Measure them off
  // a quote-free name so the arithmetic tracks template drift instead of
  // pinning a count by hand.
  const templateDoubles = webhookStubFor("zzq").split('"').length - 1;

  it.each([
    'pay"hook', // interior quote
    '"hook', // leading quote
    'hook"', // trailing quote
    'a""b', // adjacent pair inside the name
    '"', // the entire name is one quote
    '""', // the entire name is a quote pair
  ])("renders the double quote byte-for-byte at every expansion site for %j", (name) => {
    const stub = webhookStubFor(name);
    const nameQuotes = name.split('"').length - 1;

    // Raw sites: the title line and the forgery warning carry the name
    // unchanged — the quote is data, never escaped, encoded, or dropped.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);

    // `capitalize(name)` site: only the first code point folds; `"` has no
    // case mapping, so every quote in the name survives into the handler.
    expect(stub).toContain(
      `handle${name[0]?.toUpperCase() ?? ""}${name.slice(1)}Webhook(req: Request)`,
    );

    // `webhookSecretKeyFor(name)` sites: `toUpperCase()` leaves `"` alone,
    // so the quote-bearing key lands in both `phantom reveal` lines.
    expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

    // Five expansion sites per name; the stub holds exactly the template's
    // own quotes plus the ones the name carried in — none lost to escaping.
    expect(stub.split('"').length - 1).toBe(templateDoubles + nameQuotes * 5);
  });

  it.each(['pay"hook', '"', 'a""b'])(
    "emits no escaped or encoded form of the quote for %j",
    (name) => {
      const stub = webhookStubFor(name);
      // A JSON.stringify-style pass would emit `\"`; an HTML/URI encoder
      // would emit an entity or %22. None of those run: the quote is
      // interpolated as plain text inside line comments.
      for (const encoded of ['\\"', "&quot;", "&#34;", "&#x22;", "%22", "\\u0022"]) {
        expect(stub).not.toContain(encoded);
      }
    },
  );

  it("keeps every quote inside `//` comments and the template's own string literals intact", () => {
    // The only real string literals in the stub are the template's own:
    // a `"` reaching one of those positions would corrupt the generated
    // code's syntax. Every provider-name site sits in a line comment, so
    // the carried quote can never terminate a literal — and the literals
    // themselves keep exactly their template text.
    const stub = webhookStubFor('pay"hook');
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain('new Response("Missing signature", { status: 400 })');
    expect(stub).toContain('new Response("ok", { status: 200 })');
    expect(stub.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
  });

  it("returns the fallback hint unchanged for a quote-bearing name", () => {
    // The hint is a fixed string per provider with no name interpolation:
    // the quote in the replacement text never reaches it.
    expect(verificationHintFor('pay"hook')).toBe(
      "Verify per the provider's documented signature scheme.",
    );
    expect(verificationHintFor('"')).toBe(verificationHintFor("zzq"));
  });

  it("skips a quote-bearing name byte-for-byte through wiring and writes nothing for it", async () => {
    // `stripe"` matches no catalog provider (the lookup compares exact
    // bytes): it returns in `skipped` with U+0022 intact, gets no stub on
    // disk, and provokes no vault write. The known provider listed beside
    // it wires normally, unaffected by the quoted neighbour.
    const name = 'stripe"';
    const stubPath = join(dir, ".stack", "webhooks", "github.ts");
    const result = await wirePhantomForRecipe(recipe(name, "github"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["github:GITHUB_TOKEN"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]?.charCodeAt(6)).toBe(0x22);

    // Only github's documented stub lands — nothing for the quoted name —
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
