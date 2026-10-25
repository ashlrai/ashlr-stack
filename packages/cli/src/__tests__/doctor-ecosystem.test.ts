import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ProbeRunner,
  checkEcosystem,
  defaultProbeRunner,
  ecosystemNextSteps,
  formatEcosystem,
  probeEnv,
} from "../lib/ecosystem.ts";

/** A handshake that conforms to the v1 contract. */
const hs = (version: string, caps: string[], health = "ok") =>
  JSON.stringify({
    kind: "ashlr.handshake",
    schema_version: 1,
    name: "locus",
    command: "locus",
    version,
    protocols: { "ashlr.handshake": 1 },
    capabilities: caps,
    health: { status: health, checks: [] },
    edits: ["~/.locus/"],
    receipts: [],
  });

const onlyLocus =
  (stdout: string): ProbeRunner =>
  async (cmd) =>
    cmd === "locus" ? { kind: "ran", code: 0, stdout } : { kind: "missing" };

describe("stack doctor --ecosystem", () => {
  test("reports name, version, capabilities; missing and old tools are not failures", async () => {
    const seen: Array<[string, number]> = [];
    const runner: ProbeRunner = async (cmd, t) => {
      seen.push([cmd, t]);
      if (cmd === "locus")
        return { kind: "ran", code: 0, stdout: hs("0.5.1", ["recall", "index"]) };
      if (cmd === "lexicon") return { kind: "ran", code: 1, stdout: "error: unknown option" };
      if (cmd === "phm") return { kind: "timeout" };
      return { kind: "missing" };
    };
    const out = await checkEcosystem(runner);
    expect(seen.every(([, t]) => t === 2000)).toBe(true);
    const by = Object.fromEntries(out.map((e) => [e.name, e]));
    expect(by.locus).toMatchObject({
      status: "ok",
      version: "0.5.1",
      capabilities: ["recall", "index"],
    });
    expect(by.lexicon.status).toBe("no-handshake");
    expect(by.phantom).toMatchObject({ status: "no-handshake", detail: "did not answer in time" });
    expect(by["ashlr-md"]).toMatchObject({ status: "missing", command: "mdopener-mcp" });
    const text = formatEcosystem(out).join("\n");
    expect(text).toContain("locus 0.5.1 [recall, index]");
    expect(text).toContain("ashlr-plugin (ashlr-plugin): not installed");
  });

  test("a throwing runner is reported as missing, not thrown", async () => {
    const out = await checkEcosystem(async () => {
      throw new Error("boom");
    });
    expect(out.every((e) => e.status === "missing")).toBe(true);
  });

  test("probe env drops secrets", () => {
    const env = probeEnv({ PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "sk-x", GITHUB_TOKEN: "t" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", NO_COLOR: "1" });
  });

  test("default runner: a missing binary is missing", async () => {
    expect(await defaultProbeRunner("ashlr-definitely-not-installed-xyz", 500)).toEqual({
      kind: "missing",
    });
  });

  test("degraded locus that advertises doctor-fix gets the --fix next step", async () => {
    const out = await checkEcosystem(onlyLocus(hs("0.5.2", ["doctor-fix"], "degraded")));
    expect(ecosystemNextSteps(out)).toEqual([
      "locus doctor --fix   # preview safe repairs (writes nothing); add --apply to make them",
    ]);
    const text = formatEcosystem(out).join("\n");
    expect(text).toContain("Next steps:");
    expect(text).toContain("locus doctor --fix");
  });

  test("healthy locus with doctor-fix: nothing extra", async () => {
    const out = await checkEcosystem(onlyLocus(hs("0.5.2", ["doctor-fix"], "ok")));
    expect(ecosystemNextSteps(out)).toEqual([]);
    expect(formatEcosystem(out).join("\n")).not.toContain("Next steps");
  });

  test("degraded locus without the doctor-fix capability: no guess from version", async () => {
    for (const v of ["0.5.1", "0.6.0", "9.9.9"]) {
      const out = await checkEcosystem(onlyLocus(hs(v, ["doctor-json"], "degraded")));
      expect(ecosystemNextSteps(out)).toEqual([]);
    }
  });

  test("missing or old locus: no suggestion", async () => {
    expect(ecosystemNextSteps(await checkEcosystem(async () => ({ kind: "missing" })))).toEqual([]);
    expect(ecosystemNextSteps(await checkEcosystem(onlyLocus("not json")))).toEqual([]);
  });
});

describe("stack doctor --ecosystem: v1 contract drift", () => {
  test("the bundled contract is byte-identical to contract/ashlr-handshake.v1.json", () => {
    const root = join(import.meta.dir, "..", "..", "..", "..");
    expect(readFileSync(join(import.meta.dir, "..", "lib", "handshake-contract.v1.json"))).toEqual(
      readFileSync(join(root, "contract", "ashlr-handshake.v1.json")),
    );
  });

  test("a conforming handshake is contract ok and shown as before", async () => {
    const [e] = await checkEcosystem(onlyLocus(hs("0.5.1", ["doctor-fix"])), [
      { name: "locus", command: "locus" },
    ]);
    expect(e).toMatchObject({ status: "ok", contract: "ok" });
    expect(e!.contract_problems).toBeUndefined();
    expect(formatEcosystem([e!]).join("\n")).toContain("  ok   locus 0.5.1");
  });

  test("a drifting handshake is flagged with short problems and an upgrade hint", async () => {
    const drift = JSON.stringify({
      ...JSON.parse(hs("0.5.1", ["Doctor_Fix"], "ok")),
      edits: ["/etc/passwd"],
      health: { status: "ok", checks: [{ id: "home", status: "missing" }] },
    });
    const [e] = await checkEcosystem(onlyLocus(drift), [{ name: "locus", command: "locus" }]);
    expect(e!.contract).toBe("drift");
    expect(e!.contract_problems!.length).toBeGreaterThan(0);
    expect(e!.contract_problems!.length).toBeLessThanOrEqual(3);
    expect(e!.contract_problems!.every((p) => p.length <= 100)).toBe(true);
    const text = formatEcosystem([e!]).join("\n");
    expect(text).toContain("  !!   locus 0.5.1");
    expect(text).toContain("contract drift");
    const steps = ecosystemNextSteps([e!]);
    expect(steps[0]).toContain("upgrade locus");
    expect(steps[0]).toContain("does not match the v1 contract");
  });

  test("a minimal v1 handshake missing required fields is drift, not a crash", async () => {
    const minimal = JSON.stringify({
      kind: "ashlr.handshake",
      schema_version: 1,
      version: "1.0.0",
    });
    const [e] = await checkEcosystem(onlyLocus(minimal), [{ name: "locus", command: "locus" }]);
    expect(e).toMatchObject({ status: "ok", contract: "drift" });
    expect(e!.contract_problems![0]).toBe("missing field name");
  });
});
