import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { verificationHintFor, webhookStubFor, wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// The wiring check spawns the fake `phantom` shim (bash + python3); keep the
// sibling files' raised timeout.
setDefaultTimeout(30_000);

describe("ai/phantom-wire empty template (the empty name as replacement text)", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "wire-empty-template-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "empty-template",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  it("substitutes the empty string at every expansion site", () => {
    // The name is the empty template: every slot the name feeds resolves
    // to the empty string. Substitution returns "" — the slot vanishes
    // between the template's own fixed text instead of leaving residue.
    const stub = webhookStubFor("");

    // Case-preserving sites collapse to nothing: `forge a  webhook.` keeps
    // the double space where the name sat, proving the slot emitted ""
    // rather than being skipped (a skipped slot would print `${provider}`).
    expect(stub).toContain("webhook handler stub for .");
    expect(stub).toContain("forge a  webhook.");

    // `capitalize("")` must return "": its `s === ""` early return is the
    // only thing keeping `codePointAt(0)`'s undefined out of
    // `String.fromCodePoint`, which would throw a RangeError on NaN.
    expect(stub).toContain("handleWebhook(req: Request)");

    // `"".toUpperCase()` is "" at both reveal sites — the secret-key slot
    // ran through the default switch case and emitted the bare suffix.
    expect(stub.split("phantom reveal _WEBHOOK_SECRET").length - 1).toBe(2);

    // Single pass, every slot resolved: the render holds zero `${...}`
    // spans and no doubled placeholder text.
    expect(stub).not.toContain("${");

    // The sibling slots took their generic defaults in the same pass — ""
    // reaches none of the known-provider switch cases.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(stub).toContain("//   // Verify per the provider's documented signature scheme.");
    expect(verificationHintFor("")).toBe(verificationHintFor("zzq"));
  });

  it("reports the empty name in skipped byte-for-byte and writes nothing for it", async () => {
    // "" matches no catalog provider and no webhook set: `skipped` is a
    // single-element array holding the empty string itself — pushed, not
    // dropped — and no stub lands on disk.
    const result = await wirePhantomForRecipe(recipe(""), { cwd: dir });

    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [""] });
    expect(result.skipped).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);

    // The whole call log is reads (`--version`, `list`); the vault file
    // still parses to an empty object — an empty name provokes no write.
    expect(harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list")).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
  });
});
