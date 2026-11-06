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

describe("ai/phantom-wire known placeholder adjacent to punctuation", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-punct-adjacent-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "punct-adjacent",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  // The template's own marks (periods, parens, quotes, colons, dashes)
  // measured off a mark-free name, so the per-mark arithmetic tracks
  // template drift instead of pinning counts by hand.
  const baseline = webhookStubFor("zzq");

  it.each([
    "pay.${provider}!", // `.` before and `!` after, mid-name
    "(${capitalize(provider)})", // parens flush around the token
    "hook:${webhookSecretKeyFor(provider)};", // `:` before, `;` after
    "a,${signatureHeaderFor(provider)}?", // `,` before, `?` after
    "x-${verificationHintFor(provider)}", // `-` before a trailing token
    "${provider}.hook", // `.` after a leading token
  ])("keeps the marks flush against the carried token at every site for %j", (name) => {
    // Each name is ordinary text carrying one of the template's own slot
    // spellings — a known placeholder — with punctuation flush on at least
    // one side. Both are data: expansion fills the template's slots with the
    // whole name, so the marks must land byte-for-byte beside the token,
    // neither consumed into the slot's syntax nor split off it — while the
    // token itself never resolves to the value its spelling names.
    const stub = webhookStubFor(name);
    const token = name.match(/\$\{[^}]*\}/)?.[0] as string;
    const at = name.indexOf(token);
    const left = name.slice(0, at);
    const right = name.slice(at + token.length);

    // The name — token and marks together — lands byte-for-byte at the
    // three case-preserving sites and whole-name uppercased at the two
    // secret-key sites. `capitalize` folds only the first code point: a
    // letter-led name folds (`pay` → `Pay`); a mark- or `$`-led name passes
    // through unchanged.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain(`forge a ${name} webhook.`);
    expect(stub).toContain(`handle${name[0].toUpperCase()}${name.slice(1)}Webhook(req: Request)`);
    expect(count(stub, `phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

    // Flank census: at every occurrence of the token — exact case at the
    // three mixed-case sites, uppercased at the two reveal sites — the
    // bytes immediately beside it are the name's own flanks (in that site's
    // case), never the template's text. A slot-skipping render would leave
    // the bare token hugged by `for `/`.`; a mark-eating one would show the
    // name's letters or the template beside it instead.
    const contexts: string[] = [];
    for (const variant of [token, token.toUpperCase()]) {
      for (let i = stub.indexOf(variant); i !== -1; i = stub.indexOf(variant, i + 1)) {
        const l = stub.slice(i - left.length, i);
        const r = stub.slice(i + variant.length, i + variant.length + right.length);
        contexts.push(`${l}|${r}`.toLowerCase());
      }
    }
    expect(contexts).toEqual(Array.from({ length: 5 }, () => `${left}|${right}`.toLowerCase()));

    // Five `${...}` spans — one per expansion site — every one the carried
    // token in that site's case: none resolved to the value its spelling
    // names, none dropped, none duplicated.
    const spans = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(spans).toHaveLength(5);
    for (const span of spans) expect(span.toLowerCase()).toBe(token.toLowerCase());

    // Mark accounting: every punctuation mark in the stub is either one the
    // template contributes itself or one the name carried into its five
    // expansion sites — none eaten, none doubled. The token's own `${`/`}`
    // bytes are tracked by the span census above.
    for (const mark of new Set(name.match(/[^a-zA-Z0-9${}]/g) ?? [])) {
      expect(count(stub, mark)).toBe(count(baseline, mark) + 5 * count(name, mark));
    }

    // A second pass would re-resolve the carried token into the whole name,
    // splicing the flanks around it again; neither flank ever repeats.
    if (left) expect(stub).not.toContain(`${left}${left}`);
    if (right) expect(stub).not.toContain(`${right}${right}`);

    // The remaining slots took their own generic values in the same single
    // pass — the carried token never reached their switch cases either.
    expect(count(stub, 'req.headers.get("x-webhook-signature")')).toBe(1);
    expect(count(stub, "//   // Verify per the provider's documented signature scheme.")).toBe(1);
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });

  it("pins `pay.${provider}!` line-for-line — the slot took the whole value, the marks stayed put", () => {
    // The sharpest form: the carried token spells the name slot itself, so
    // at the name sites the emitted text is indistinguishable from an
    // unresolved slot. Exact-line equality pins every site: the slot was
    // replaced once by `pay.${provider}!` — the `.` before and the `!`
    // after the token arriving as data — and the template's own `.`
    // follows the whole value untouched.
    const stub = webhookStubFor("pay.${provider}!");

    expect(stub).toContain(
      "// Auto-generated by `stack apply` — webhook handler stub for pay.${provider}!.",
    );
    expect(stub).toContain("//   phantom reveal PAY.${PROVIDER}!_WEBHOOK_SECRET");
    expect(stub).toContain(
      "// export async function handlePay.${provider}!Webhook(req: Request): Promise<Response> {",
    );
    expect(stub).toContain("//   // to this endpoint can forge a pay.${provider}! webhook.");
    expect(stub).toContain(
      "//   // (`phantom reveal PAY.${PROVIDER}!_WEBHOOK_SECRET`) and compare in",
    );

    // Census: exactly five `${...}` spans — three original-case at the
    // case-preserving sites, two folded at the reveal sites. A second pass
    // would re-resolve each `${provider}` into `pay.${provider}!` again,
    // doubling the `pay.` prefix and the `!` suffix; neither appears.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toEqual([
      "${provider}",
      "${PROVIDER}",
      "${provider}",
      "${provider}",
      "${PROVIDER}",
    ]);
    expect(stub).not.toContain("pay.pay");
    expect(stub).not.toContain("!!");
  });

  it("skips a mark-adjacent placeholder name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the name matches no catalog provider:
    // it returns in `skipped` byte-for-byte — marks and token intact — gets
    // no stub on disk, and provokes no vault write. The known provider
    // listed beside it wires normally, unaffected by the mark-wrapped,
    // placeholder-shaped neighbour.
    const name = "pay.${provider}!";
    const stubPath = join(dir, ".stack", "webhooks", "supabase.ts");
    const result = await wirePhantomForRecipe(recipe(name, "supabase"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: [
        "supabase:SUPABASE_URL",
        "supabase:SUPABASE_ANON_KEY",
        "supabase:SUPABASE_SERVICE_ROLE_KEY",
      ],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only supabase's documented stub lands — nothing for the mark-carrying
    // name, and the stub on disk is the same render `webhookStubFor`
    // returns, fully substituted.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["supabase.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("supabase"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});

    // The hint is a fixed string: a mark-adjacent token never leaks into it.
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });
});
