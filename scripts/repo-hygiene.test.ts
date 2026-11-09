import { expect, test } from "bun:test";
import {
  extractExports,
  extractMarkdownLinks,
  extractPackageSpecifiers,
  findUnusedImports,
  packageNameOf,
  parseBunOutdated,
  parseCargoDryRun,
  parseNpmOutdated,
  parseWorktreesPorcelain,
  resolveDocLink,
  stripMarkdownCode,
} from "./repo-hygiene.ts";

test("parseWorktreesPorcelain counts worktrees, detached and prunable", () => {
  const porcelain = [
    "worktree /repo/main",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /repo/wt1",
    "HEAD def456",
    "detached",
    "",
    "worktree /repo/wt2",
    "HEAD 789abc",
    "branch refs/heads/feature",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");
  expect(parseWorktreesPorcelain(porcelain)).toEqual({ total: 3, detached: 1, prunable: 1 });
  expect(parseWorktreesPorcelain("")).toEqual({ total: 0, detached: 0, prunable: 0 });
});

test("parseBunOutdated reads the table including dev markers", () => {
  const text = [
    "bun outdated v1.3.14",
    "| Package          | Current | Update | Latest |",
    "|------------------|---------|--------|--------|",
    "| @clack/prompts   | 0.8.2   | 0.8.2  | 1.8.1  |",
    "| @types/bun (dev) | 1.3.12  | 1.4.4  | 1.4.4  |",
    "| citty            | 0.1.6   | 0.1.6  | 0.2.2  |",
  ].join("\n");
  const rows = parseBunOutdated(text);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toEqual({ name: "@clack/prompts", current: "0.8.2", wanted: "0.8.2", latest: "1.8.1", dev: false });
  expect(rows[1]!.dev).toBe(true);
  expect(rows[1]!.name).toBe("@types/bun");
});

test("parseNpmOutdated reads the JSON map and tolerates garbage", () => {
  const rows = parseNpmOutdated(
    JSON.stringify({ vitest: { current: "5.0.5", wanted: "5.1.0", latest: "5.1.0" } }),
  );
  expect(rows).toEqual([{ name: "vitest", current: "5.0.5", wanted: "5.1.0", latest: "5.1.0", dev: false }]);
  expect(parseNpmOutdated("not json")).toEqual([]);
  expect(parseNpmOutdated("[]")).toEqual([]);
});

test("parseCargoDryRun counts drift lines", () => {
  const text = [
    "    Updating crates.io index",
    "    Locking 85 packages to latest compatible versions",
    "    Updating bitflags v2.13.1 -> v2.13.2",
    "      Adding borsh v1.8.1",
    "    Removing futures-channel v0.3.33",
  ].join("\n");
  expect(parseCargoDryRun(text)).toEqual({ updating: 1, adding: 1, removing: 1 });
});

test("extractExports covers declarations, export lists and star-as", () => {
  const source = `
    export function run() {}
    export async function load() {}
    export class Store {}
    export interface Opts { a: string }
    export type Id = string;
    export const LIMIT = 3;
    export enum Mode { A }
    const local = 1;
    export { local, local as renamed };
    export * as ns from "./x";
    export default function main() {}
    export { thing } from "./re";
  `;
  const names = extractExports(source).map((e) => e.name);
  expect(names).toContain("run");
  expect(names).toContain("load");
  expect(names).toContain("Store");
  expect(names).toContain("Opts");
  expect(names).toContain("Id");
  expect(names).toContain("LIMIT");
  expect(names).toContain("Mode");
  expect(names).toContain("renamed");
  expect(names).toContain("ns");
  expect(names).toContain("thing");
  expect(names).toContain("local");
  expect(names).not.toContain("main");
});

test("findUnusedImports flags fully-unused imports only", () => {
  const source = `
    import { used, unused } from "pkg-a";
    import totallyUnused from "pkg-b";
    import "side-effect";
    import type { TypeOnly } from "pkg-c";
    const x = used + TypeOnly.name;
  `;
  const hits = findUnusedImports(source);
  // pkg-b's default binding is the only fully-unused statement.
  expect(hits).toHaveLength(1);
  expect(hits[0]!.clause).toContain("totallyUnused");
});

test("packageNameOf maps specifiers to package names", () => {
  expect(packageNameOf("react")).toBe("react");
  expect(packageNameOf("react-dom/client")).toBe("react-dom");
  expect(packageNameOf("@scope/pkg/sub")).toBe("@scope/pkg");
  expect(packageNameOf("./local")).toBeNull();
  expect(packageNameOf("../up")).toBeNull();
  expect(packageNameOf("node:fs")).toBeNull();
  expect(packageNameOf("bun:test")).toBeNull();
  expect(packageNameOf("#alias/x")).toBeNull();
});

test("extractPackageSpecifiers covers import forms", () => {
  const source = `
    import a from "pkg-a";
    import { b } from "pkg-b/sub";
    export { c } from "@scope/pkg-c";
    const d = await import("pkg-d");
    const e = require("pkg-e");
    import "./relative";
    import x from "node:path";
  `;
  const names = extractPackageSpecifiers(source);
  expect([...names].sort()).toEqual(["@scope/pkg-c", "pkg-a", "pkg-b", "pkg-d", "pkg-e"]);
});

test("extractMarkdownLinks and resolveDocLink handle local targets", () => {
  const md = `
    [a](./other.md) [b](docs/x.md#sec) [c](https://example.com) [d](mailto:a@b.c)
    [e](../up/file.ts) ![img](img.png)
  `;
  const targets = extractMarkdownLinks(md);
  expect(targets).toContain("./other.md");
  expect(targets).toContain("docs/x.md#sec");
  expect(targets).toContain("../up/file.ts");
  expect(targets).toContain("img.png");
  expect(targets).not.toContain("https://example.com");
  expect(resolveDocLink("docs/guide.md", "./other.md")).toBe("docs/other.md");
  expect(resolveDocLink("docs/guide.md", "../root.md")).toBe("root.md");
  expect(resolveDocLink("docs/guide.md", "docs/x.md#sec")).toBe("docs/docs/x.md");
  expect(resolveDocLink("README.md", "/abs/path.md")).toBe(null);
});

test("stripMarkdownCode removes fenced blocks and inline code", () => {
  const md = [
    "real [link](./a.md) and `code [notalink](./b.md)`",
    "```",
    "example [fenced](./c.md)",
    "```",
    "after [link2](./d.md)",
  ].join("\n");
  const stripped = stripMarkdownCode(md);
  expect(extractMarkdownLinks(stripped)).toEqual(["./a.md", "./d.md"]);
});

test("CLI counts code markers without counting markers in non-code files", async () => {
  const { chmod, mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "hygiene-markers-"));
  try {
    const bin = join(dir, "bin");
    const root = join(dir, "repos");
    await mkdir(bin);
    await mkdir(root);
    for (const name of ["docs-only", "mixed"]) {
      const repo = join(root, name);
      await mkdir(repo);
      expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
      await writeFile(join(repo, "README.md"), "TODO: documentation marker\n");
      if (name === "mixed") await writeFile(join(repo, "source.ts"), "// FIXME: code marker\nconst TODO_suffix = 1;\n");
      expect(spawnSync("git", ["-C", repo, "add", "."]).status).toBe(0);
    }
    const gh = join(bin, "gh");
    await writeFile(gh, "#!/bin/sh\necho public\n");
    await chmod(gh, 0o755);
    const result = spawnSync(process.execPath, [join(import.meta.dir, "repo-hygiene.ts"), "--root", root, "--json"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    const counts = Object.fromEntries(
      json.repos.map((repo: { name: string; deadCode: { todoFixmeCount: number } }) => [
        repo.name,
        repo.deadCode.todoFixmeCount,
      ]),
    );
    expect(counts).toEqual({ "docs-only": 0, mixed: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI excludes private, unknown and failed visibility checks from JSON and Markdown", async () => {
  const { mkdtemp, mkdir, readFile, rm, writeFile, chmod } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "hygiene-test-"));
  try {
    const bin = join(dir, "bin");
    const root = join(dir, "repos");
    await mkdir(bin);
    await mkdir(root);
    for (const name of ["public-fixture", "private-fixture", "unknown-fixture", "error-fixture"]) {
      const repo = join(root, name);
      await mkdir(repo);
      expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    }
    const gh = join(bin, "gh");
    await writeFile(gh, '#!/bin/sh\ncase "$2" in\n  repos/ashlrai/public-fixture) echo public ;;\n  repos/ashlrai/private-fixture) echo private ;;\n  repos/ashlrai/unknown-fixture) echo unknown ;;\n  *) exit 1 ;;\nesac\n');
    await chmod(gh, 0o755);
    const md = join(dir, "report.md");
    const result = spawnSync(process.execPath, [join(import.meta.dir, "repo-hygiene.ts"), "--root", root, "--json", "--md", md], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.repos.map((repo: { name: string }) => repo.name)).toEqual(["public-fixture"]);
    const markdown = await readFile(md, "utf8");
    expect(markdown).toContain("public-fixture");
    for (const name of ["private-fixture", "unknown-fixture", "error-fixture"]) {
      expect(result.stdout).not.toContain(name);
      expect(markdown).not.toContain(name);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
