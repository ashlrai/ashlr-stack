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

// Each of the template's own slot spellings, usable as a provider name that
// spells a known placeholder.
const SLOT_TOKENS = [
  "${provider}", // the name slot's own spelling
  "${capitalize(provider)}", // the handler-name slot's spelling
  "${webhookSecretKeyFor(provider)}", // the secret-key slot's spelling
  "${signatureHeaderFor(provider)}", // the header slot's spelling
  "${verificationHintFor(provider)}", // the hint slot's spelling
];

describe("ai/phantom-wire known placeholder beside a carriage return", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-placeholder-cr-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "placeholder-cr",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each(SLOT_TOKENS.flatMap((token) => [`${token}\r`, `\r${token}`]))(
    "replaces every slot and preserves the carriage return beside the carried token in %j",
    (name) => {
      // The name is exactly one known placeholder token with a carriage
      // return seated beside it — before it or after it, no ordinary text.
      // Expansion fills the five name-carrying sites with the name itself,
      // so the rendered stub holds the token and the CR still adjacent in
      // the input's own order: a resolver would resolve the token away, a
      // sanitizer would strip or escape the control byte, a newline
      // normalization would rewrite it as CRLF. None of that runs.
      const stub = webhookStubFor(name);
      const token = name.replace("\r", "");

      // The three case-preserving sites carry the name byte-for-byte —
      // token, CR and all. `capitalize` folds only the first code point,
      // and both `$` and `\r` uppercase to themselves, so the handler site
      // holds the identical bytes.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${name}Webhook(req: Request)`);
      // The two `toUpperCase()` reveal sites carry the folded name; `\r`
      // folds to itself, so the CR sits beside the folded token there too.
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);

      // Five name sites, five carriage returns — none stripped, doubled or
      // moved. Each sits exactly where the name put it: adjacent to the
      // carried token, on the same side it occupied in the input.
      expect(stub.split("\r").length - 1).toBe(5);
      const adjacent = name.startsWith("\r") ? /\r\$\{[^}]*\}/g : /\$\{[^}]*\}\r/g;
      expect(stub.match(adjacent)).toHaveLength(5);
      // The byte is data, not a line ending: the stub still contains no
      // CRLF, and the template's own `.\n` still terminates the title line
      // right after the CR-carrying name.
      expect(stub).not.toContain("\r\n");
      expect(stub).toContain(`${name}.\n`);

      // Every `${...}` in the output is the carried token in that site's
      // case — five expansion sites, five occurrences, none resolved away.
      const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
      expect(tokens).toHaveLength(5);
      for (const t of tokens) expect(t.toLowerCase()).toBe(token.toLowerCase());

      // The remaining slots took their own values in the same single pass:
      // the generic signature header and the fallback hint — the carried
      // token never reached their switch cases either.
      expect(stub).toContain('req.headers.get("x-webhook-signature")');
      expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it("skips a CR-carrying placeholder name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the name matches no catalog provider:
    // it returns in `skipped` byte-for-byte — token and carriage return
    // intact — gets no stub on disk, and provokes no vault write. The
    // known provider listed beside it wires normally, unaffected by the
    // control-byte neighbour.
    const name = "${provider}\r";
    const stubPath = join(dir, ".stack", "webhooks", "github.ts");
    const result = await wirePhantomForRecipe(recipe(name, "github"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["github:GITHUB_TOKEN"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only github's documented stub lands — nothing for the CR-carrying
    // name, and the stub on disk is the same render `webhookStubFor`
    // returns.
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
