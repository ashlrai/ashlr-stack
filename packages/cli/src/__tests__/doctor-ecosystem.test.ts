import { describe, expect, test } from "bun:test";
import {
  type ProbeRunner,
  checkEcosystem,
  defaultProbeRunner,
  ecosystemNextSteps,
  formatEcosystem,
  probeEnv,
} from "../lib/ecosystem.ts";

const hs = (version: string, caps: string[], health = "ok") =>
  JSON.stringify({
    kind: "ashlr.handshake",
    schema_version: 1,
    version,
    capabilities: caps,
    health: { status: health, checks: [] },
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
