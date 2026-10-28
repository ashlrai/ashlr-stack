import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const product = ["./packages/core", "./packages/cli", "./packages/mcp", "./packages/site"];

/** Conservative package targets, including runtime and source-inspection consumers. */
export function affectedTests(paths: readonly string[]): string[] | "ALL" {
  const targets = new Set<string>();
  for (const path of paths) {
    // Configuration always wins over documentation classification.
    const name = path.split("/").at(-1) ?? "";
    if (
      /\.config\.[cm]?[jt]s$/i.test(name) ||
      /^\.env(?:\.|$)/.test(name) ||
      /^(?:package\.json|tsconfig.*\.json|bunfig\.toml|Cargo\.toml|.*\.lockb?|.*rc(?:\..*)?)$/i.test(
        name,
      ) ||
      /\.(?:jsonc?|ya?ml|toml)$/i.test(name) ||
      path.startsWith(".github/")
    )
      return "ALL";

    // Plugin commands and site content are executable/product inputs, even as Markdown.
    if (
      (path.startsWith("docs/") && /\.(?:md|mdx|txt)$/i.test(name)) ||
      (!path.includes("/") && /\.(?:md|txt)$/i.test(name)) ||
      /^packages\/[^/]+\/(?:README(?:\.[^/]+)?|LICENSE)$/.test(path) ||
      path === "scripts/affected-tests.md"
    )
      continue;

    if (/^packages\/(?:core|cli|mcp|site|plugin)\//.test(path)) {
      for (const target of product) targets.add(target);
    } else if (path.startsWith("packages/telemetry-worker/")) {
      targets.add("./packages/telemetry-worker");
    } else if (
      /^scripts\/affected-tests(?:\.ts|\.test\.ts)?$/.test(path) ||
      path.startsWith("scripts/__fixtures__/affected-tests/")
    ) {
      targets.add("./scripts/affected-tests.test.ts");
    } else {
      // New packages, shared scripts, templates and unrecognized inputs fail closed.
      return "ALL";
    }
  }
  return [...targets].sort();
}

export function changedPaths(base: string, cwd: string): string[] {
  if (!base || base.startsWith("-")) throw new Error("Expected a base Git revision");
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "-z", "--no-renames", `${base}...HEAD`, "--"],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (diff.error || diff.status !== 0) {
    throw new Error("Cannot read base...HEAD diff; fetch the base and its merge history first");
  }
  return diff.stdout.split("\0").filter(Boolean);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(
      "Usage: scripts/affected-tests <base>\nPrints a JSON target array, [] for docs only, or ALL.",
    );
  } else {
    try {
      if (args.length !== 1) throw new Error("Usage: scripts/affected-tests <base>");
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
      const result = affectedTests(changedPaths(args[0], root));
      console.log(result === "ALL" ? result : JSON.stringify(result));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Cannot select affected tests");
      process.exitCode = 1;
    }
  }
}
