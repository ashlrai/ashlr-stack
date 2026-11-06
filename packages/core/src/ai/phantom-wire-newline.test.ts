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

const newlineCount = (s: string) => s.split("\n").length - 1;

describe("ai/phantom-wire replacement text containing a newline", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-newline-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "newline",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it("emits the literal newline byte at all five expansion sites", () => {
    // A newline inside the replacement text is ordinary data: carried
    // through the template's single pass it must arrive as a real 0x0A byte
    // at every expansion site — not collapsed, not stripped, and not
    // emitted as the two-character escape `\n`. Rendering the same letters
    // without the break (`ab`) gives the flat baseline: the only difference
    // between the two stubs is exactly five inserted line breaks, one per
    // site that splices the name.
    const stub = webhookStubFor("a\nb");
    const flat = webhookStubFor("ab");

    // Case-preserving sites emit the name byte-for-byte — newline included.
    expect(stub).toContain("webhook handler stub for a\nb.");
    expect(stub).toContain("forge a a\nb webhook.");
    // `capitalize` folds only the first code point; the newline is untouched.
    expect(stub).toContain("handleA\nbWebhook(req: Request)");
    // `webhookSecretKeyFor` uppercases the letters around the break; it
    // survives at both reveal lines.
    expect(stub.split("phantom reveal A\nB_WEBHOOK_SECRET").length - 1).toBe(2);

    // Exactly five extra line breaks over the flat render — one per
    // expansion site, none eaten or doubled by the pass.
    expect(newlineCount(stub)).toBe(newlineCount(flat) + 5);

    // Byte-level pin: the character after `stub for a` is 0x0A itself, and
    // no escaped `\n` two-character sequence or `${...}` residue appears
    // anywhere in the output.
    expect(stub.charCodeAt(stub.indexOf("stub for a") + "stub for a".length)).toBe(0x0a);
    expect(stub).not.toContain("\\n");
    expect(stub).not.toContain("${");

    // Proof the byte is a real line break and not an escape: each site's
    // tail continues on a fresh line with no `//` comment prefix.
    expect(stub).toContain("\nb.\n");
    expect(stub).toContain("\nbWebhook(req: Request): Promise<Response> {\n");
    expect(stub).toContain("\nb webhook.\n");
    expect(stub.split("\nB_WEBHOOK_SECRET").length - 1).toBe(2);

    // The remaining slots resolved to their own generic values in the same
    // pass — the newline-bearing name never reached their switch cases.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor("a\nb")).toBe(verificationHintFor("zzq"));
  });

  it.each(["\nx", "x\n", "a\nb\nc", "\n", "a\n\nb"])(
    "keeps every literal newline in %j at all five expansion sites",
    (name) => {
      // Leading, trailing, adjacent, and repeated breaks are the same data.
      // `capitalize` and `toUpperCase` leave 0x0A untouched — a newline has
      // no case mapping — so each break in the name lands once per
      // expansion site and the count scales with the newline count.
      const stub = webhookStubFor(name);
      const flat = webhookStubFor(name.replace(/\n/g, ""));
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

      // Five expansion sites carry the name; each preserves every newline
      // in it. Escaped sequences would not raise the line count, and
      // stripping would lower it below the flat baseline's own breaks.
      expect(newlineCount(stub)).toBe(newlineCount(flat) + 5 * newlineCount(name));
      expect(stub).not.toContain("\\n");
      expect(stub).not.toContain("${");
    },
  );

  it("skips a newline name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the newline-bearing name matches no
    // catalog provider: it returns in `skipped` byte-for-byte — the 0x0A
    // intact — gets no stub on disk, and provokes no vault write. The
    // known provider listed beside it wires normally, unaffected by the
    // line-break-shaped neighbour.
    const name = "a\nb";
    const stubPath = join(dir, ".stack", "webhooks", "clerk.ts");
    const result = await wirePhantomForRecipe(recipe(name, "clerk"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["clerk:CLERK_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);
    expect(result.skipped[0]?.charCodeAt(1)).toBe(0x0a);

    // Only clerk's documented stub lands — nothing for the newline name,
    // and the stub on disk is the same render `webhookStubFor` returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["clerk.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("clerk"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });
});
