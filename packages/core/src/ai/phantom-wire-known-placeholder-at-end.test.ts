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

describe("ai/phantom-wire known placeholder at the end of a template", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-trailing-known-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "trailing-known-placeholder",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it.each([
    "${provider}", // the name slot's own spelling
    "${capitalize(provider)}", // the handler-name slot's spelling
    "${webhookSecretKeyFor(provider)}", // the secret-key slot's spelling
    "${signatureHeaderFor(provider)}", // the header slot's spelling
    "${verificationHintFor(provider)}", // the hint slot's spelling
  ])(
    "emits the trailing token %j verbatim with the preceding text intact at every site",
    (slot) => {
      // The name is ordinary text ending in one of the template's own slot
      // spellings — a known placeholder at the very end, with nothing after
      // it. `pay` is the preceding text the substitution must preserve.
      // Because the token would resolve if inserted text were ever fed back
      // through the slots, this is also a re-expansion case: a second pass
      // would splice the whole name in again and double the `pay` prefix.
      const name = `pay${slot}`;
      const stub = webhookStubFor(name);

      // The slot was replaced by the full name — prefix plus token — at the
      // three case-preserving sites. A skipped slot would emit the bare
      // `${provider}` after `for `; the `pay` prefix landing before the token
      // proves the value was substituted whole.
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      // `capitalize` folds only the name's first letter: `pay` → `Pay`, and
      // the trailing token rides along untouched.
      expect(stub).toContain(`handlePay${slot}Webhook(req: Request)`);
      // Both `toUpperCase()` secret-key sites fold prefix and token together —
      // work only the substitution path does.
      expect(count(stub, `phantom reveal PAY${slot.toUpperCase()}_WEBHOOK_SECRET`)).toBe(2);

      // Five `${...}` spans — one per expansion site — every one the carried
      // token in that site's case. Each sits flush at the END of the emitted
      // name: the three bytes in front of it are always the name's own `pay`
      // prefix (in whatever case that site's transform gives it), never the
      // template's fixed text — proof the slot was replaced, not left raw.
      const spans = [...stub.matchAll(/\$\{[^}]*\}/g)];
      expect(spans).toHaveLength(5);
      for (const span of spans) {
        expect(span[0].toLowerCase()).toBe(slot.toLowerCase());
        const at = span.index as number;
        expect(stub.slice(at - 3, at).toLowerCase()).toBe("pay");
      }
      // And each is the last thing the name contributes — the template's own
      // post-slot text (`.`, `Webhook`, ` webhook.`, `_WEBHOOK_SECRET`) picks
      // up right where the token ends, never eaten or doubled.
      expect(stub).not.toMatch(/paypay/i);
      expect(count(stub, "_WEBHOOK_SECRET")).toBe(2);

      // The remaining slots took their own generic values in the same single
      // pass — the carried token never reached their switch cases either.
      expect(stub).toContain('req.headers.get("x-webhook-signature")');
      expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
      expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
    },
  );

  it("pins `pay${provider}` line-for-line — the slot took the value, the prefix survived", () => {
    // The sharpest form: the trailing token spells the name slot itself, so
    // at the name sites the emitted text is indistinguishable from an
    // unresolved slot. Exact-line equality pins every site: the slot was
    // replaced by the name once, the `pay` prefix before it is intact, and
    // no second pass spliced the name around the token again.
    const stub = webhookStubFor("pay${provider}");

    expect(stub).toContain(
      "// Auto-generated by `stack apply` — webhook handler stub for pay${provider}.",
    );
    expect(stub).toContain("//   phantom reveal PAY${PROVIDER}_WEBHOOK_SECRET");
    expect(stub).toContain(
      "// export async function handlePay${provider}Webhook(req: Request): Promise<Response> {",
    );
    expect(stub).toContain("//   // to this endpoint can forge a pay${provider} webhook.");
    expect(stub).toContain(
      "//   // (`phantom reveal PAY${PROVIDER}_WEBHOOK_SECRET`) and compare in",
    );

    // Census: exactly five `${...}` spans — three original-case at the
    // case-preserving sites, two folded at the reveal sites. Re-expansion
    // would have produced `paypay${provider}` at every site; none appears.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toEqual([
      "${provider}",
      "${PROVIDER}",
      "${provider}",
      "${provider}",
      "${PROVIDER}",
    ]);
    expect(stub).not.toMatch(/paypay/i);
  });

  it("skips a trailing-placeholder name byte-for-byte through wiring and writes nothing for it", async () => {
    // Through `wirePhantomForRecipe` the name matches no catalog provider:
    // it returns in `skipped` byte-for-byte — `pay` prefix and trailing
    // token intact — gets no stub on disk, and provokes no vault write. The
    // known provider listed beside it wires normally, unaffected by the
    // placeholder-shaped neighbour.
    const name = "pay${provider}";
    const stubPath = join(dir, ".stack", "webhooks", "github.ts");
    const result = await wirePhantomForRecipe(recipe(name, "github"), { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: ["github:GITHUB_TOKEN"],
      webhooks: [stubPath],
      skipped: [name],
    });
    expect(result.skipped[0]).toBe(name);

    // Only github's documented stub lands — nothing for the
    // placeholder-ended name, and the stub on disk is the same render
    // `webhookStubFor` returns, fully substituted.
    expect(readdirSync(join(dir, ".stack", "webhooks"))).toEqual(["github.ts"]);
    expect(readFileSync(stubPath, "utf-8")).toBe(webhookStubFor("github"));
    expect(existsSync(join(dir, ".stack", "webhooks", `${name}.ts`))).toBe(false);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});

    // The hint is a fixed string: a trailing-token name never leaks into it.
    expect(verificationHintFor(name)).toBe(verificationHintFor("zzq"));
  });
});
