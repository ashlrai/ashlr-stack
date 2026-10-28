import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { affectedTests, changedPaths } from "./affected-tests.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const executable = fileURLToPath(new URL("./affected-tests", import.meta.url));
const product = ["./packages/cli", "./packages/core", "./packages/mcp", "./packages/site"];
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/affected-tests/${name}.txt`, import.meta.url), "utf8")
    .trim()
    .split("\n");

describe("affected test selection", () => {
  test("docs-only fixture skips tests", () => {
    expect(affectedTests(fixture("docs-only"))).toEqual([]);
  });
  test("single-module fixture selects its package", () => {
    expect(affectedTests(fixture("single-module"))).toEqual(["./packages/telemetry-worker"]);
  });
  test("lockfile fixture selects ALL", () => {
    expect(affectedTests(fixture("lockfile"))).toBe("ALL");
  });
  test("empty diff skips tests", () => {
    expect(affectedTests([])).toEqual([]);
  });
  test("full-suite inputs override selected packages regardless of ordering", () => {
    for (const path of ["bun.lock", "scripts/install.sh", "packages/new/src/index.ts"]) {
      const module = "packages/telemetry-worker/src/index.ts";
      expect(affectedTests([module, "README.md", path])).toBe("ALL");
      expect(affectedTests([path, "README.md", module])).toBe("ALL");
    }
  });
  test("shared product sources include indirect and source-inspection consumers", () => {
    expect(affectedTests(["packages/core/src/providers/openai.ts"])).toEqual(product);
  });
  test("deduplicates and sorts mixed targets", () => {
    expect(
      affectedTests([
        "packages/telemetry-worker/src/index.ts",
        "packages/core/src/env.ts",
        "packages/mcp/src/tools.ts",
        "README.md",
      ]),
    ).toEqual([...product, "./packages/telemetry-worker"]);
  });
  test("config overrides docs and package classification", () => {
    for (const path of [
      "bun.lockb",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "Cargo.lock",
      "packages/core/package.json",
      "packages/core/tsconfig.json",
      "biome.jsonc",
      "bunfig.toml",
      "packages/site/astro.config.mjs",
      ".npmrc",
      ".github/workflows/ci.yml",
      "docs/example.config.ts",
      "packages/core/.env.test",
    ])
      expect(affectedTests(["README.md", path])).toBe("ALL");
  });
  test("site and plugin Markdown are product inputs", () => {
    for (const path of [
      "packages/plugin/commands/add.md",
      "packages/site/src/pages/launch/blog.mdx",
    ]) {
      expect(affectedTests([path])).toEqual(product);
    }
  });
  test("unknown inputs fail closed", () => {
    for (const path of [
      "packages/new/src/index.ts",
      "scripts/install.sh",
      "templates/new/file.ts",
    ]) {
      expect(affectedTests([path])).toBe("ALL");
    }
  });
  test("selector and fixtures select their own test", () => {
    for (const path of [
      "scripts/affected-tests",
      "scripts/affected-tests.ts",
      "scripts/affected-tests.test.ts",
      "scripts/__fixtures__/affected-tests/docs-only.txt",
    ]) {
      expect(affectedTests([path])).toEqual(["./scripts/affected-tests.test.ts"]);
    }
  });
  test("deleted test paths select a surviving package target", () => {
    expect(affectedTests(["packages/core/src/__tests__/removed.test.ts"])).toEqual(product);
  });
  test("rename endpoints and unusual filenames retain both package impacts", () => {
    expect(
      affectedTests([
        "packages/telemetry-worker/src/old name.ts",
        "packages/core/src/new\nname.ts",
      ]),
    ).toEqual([...product, "./packages/telemetry-worker"]);
  });
  test("Git HEAD comparison has no committed changes", () => {
    expect(changedPaths("HEAD", root)).toEqual([]);
  });
  test("invalid and option-like revisions fail closed", () => {
    expect(() => changedPaths("refs/heads/affected-tests-missing-base", root)).toThrow();
    expect(() => changedPaths("--help", root)).toThrow();
  });
  test("executable works outside the repository", () => {
    const result = spawnSync(executable, ["HEAD"], { cwd: "/", encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("[]\n");
  });
  test("CLI failures emit no target list", () => {
    for (const args of [[], ["HEAD", "extra"], ["refs/heads/affected-tests-missing-base"]]) {
      const result = spawnSync(executable, args, { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });
});
