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

describe("ai/phantom-wire literal `$&` in replacement text", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-dollar-amp-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "dollar-amp",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it("keeps the bare `$&` match token as the whole name byte-for-byte at every site", () => {
    // `$&` is the String.replace replacement pattern that splices in the
    // matched substring — the slot spelling itself here. If expansion ever
    // ran through replace, a whole name of `$&` would vanish into
    // `${provider}` (or `${webhookSecretKeyFor(provider)}`, etc.) at every
    // site: the two characters gone, placeholder-shaped residue in their
    // place. Carried as data through a single template pass the name is
    // just `$&` — and since neither `$` nor `&` has a case mapping, even
    // the `capitalize` and `toUpperCase` sites emit the identical bytes.
    const stub = webhookStubFor("$&");

    expect(stub).toContain("webhook handler stub for $&.");
    expect(stub).toContain("handle$&Webhook(req: Request)");
    expect(stub).toContain("forge a $& webhook.");
    expect(stub.split("phantom reveal $&_WEBHOOK_SECRET").length - 1).toBe(2);

    // Five expansion sites, one `$&` each — none spliced into the match. A
    // replace-driven render would show zero `$&` and `${...}` residue.
    expect(stub.split("$&").length - 1).toBe(5);
    expect(stub).not.toContain("${");

    // The remaining slots resolved to their own values in the same pass:
    // the generic signature header and the fallback hint.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor("$&")).toBe(verificationHintFor("zzq"));
  });

  it.each(["$&hook", "hook$&", "$&$&", "a$&$&b"])(
    "keeps every literal `$&` in %j at all five expansion sites",
    (name) => {
      // Leading, trailing, and adjacent tokens are the same data. Under
      // replace semantics each `$&` would splice in the match — `a$&$&b`
      // would come out `a${provider}${provider}b`. Rendered as a name every
      // token survives at all five sites; the case folds touch only the
      // letters around them, never the two characters themselves.
      const stub = webhookStubFor(name);
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

      // Each `$&` in the name lands once per expansion site — the count
      // scales with the token count — and no `${...}` residue was spliced.
      expect(stub.split("$&").length - 1).toBe(5 * (name.split("$&").length - 1));
      expect(stub).not.toContain("${");
    },
  );

  it("preserves `$&` after an astral initial at every expansion site", () => {
    const stub = webhookStubFor("𐐨$&tail");

    expect(stub).toContain("webhook handler stub for 𐐨$&tail.");
    expect(stub).toContain("handle𐐀$&tailWebhook(req: Request)");
    expect(stub).toContain("forge a 𐐨$&tail webhook.");
    expect(stub.split("phantom reveal 𐐀$&TAIL_WEBHOOK_SECRET")).toHaveLength(3);
    expect(stub.split("$&")).toHaveLength(6);
  });

  it("skips `$&` names byte-for-byte through wiring and writes nothing for them", async () => {
    // Through `wirePhantomForRecipe` the bare and doubled tokens match no
    // catalog provider: both return in `skipped` byte-for-byte — every `$`
    // and `&` intact, in order — get no stub on disk, and provoke no vault
    // write. The known provider listed beside them wires normally,
    // unaffected by the match-token-shaped neighbours.
    const stubPath = join(dir, ".stack", "webhooks", "clerk.ts");
    const result = await wirePhantomForRecipe(recipe("$&", "$&$&", "clerk"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["clerk:CLERK_SECRET_KEY"],
      webhooks: [stubPath],
      skipped: ["$&", "$&$&"],
    });
    // Byte-level pin: `$` is 0x24 and `&` is 0x26 — the pair survives the
    // catalog lookup and the skip path unconsumed.
    expect(result.skipped[0]?.charCodeAt(0)).toBe(0x24);
    expect(result.skipped[0]?.charCodeAt(1)).toBe(0x26);
    expect(result.skipped[1]?.split("$&").length - 1).toBe(2);

    // Only clerk's documented stub lands — nothing for the `$&` names, and
    // the stub on disk is the same render `webhookStubFor` returns.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["clerk.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("clerk"));
    expect(existsSync(join(dir, ".stack", "webhooks", "$&.ts"))).toBe(false);
    expect(existsSync(join(dir, ".stack", "webhooks", "$&$&.ts"))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });
});
