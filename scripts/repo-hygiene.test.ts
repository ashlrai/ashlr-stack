import { expect, test } from "bun:test";
import {
  extractExports,
  extractMarkdownLinks,
  extractPackageSpecifiers,
  findUnusedImports,
  gitGrepCount,
  packageNameOf,
  parseBunOutdated,
  parseCargoDryRun,
  parseNpmOutdated,
  parseWorktreesPorcelain,
  resolveDocLink,
  stripMarkdownCode,
  TODO_MARKER_PATTERN,
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
    for (const name of ["docs-only", "mixed", "spaced-filename"]) {
      const repo = join(root, name);
      await mkdir(repo);
      expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
      await writeFile(join(repo, "README.md"), "TODO: documentation marker\n");
      // These tracked files contain valid markers, but none has a counted extension.
      for (const file of ["config.json", "script.py", "script.sh", "source.ts.md", "NOTES"]) {
        await writeFile(join(repo, file), "TODO: excluded\nFIXME: excluded\nXXX: excluded\nHACK: excluded\n");
      }
      if (name === "mixed") await writeFile(join(repo, "source.ts"), "// FIXME: code marker\nconst TODO_suffix = 1;\n");
      if (name === "spaced-filename") {
        await writeFile(join(repo, "source with spaces.ts"), "// TODO: standalone marker\n// TODO another marker\nconst TODO_suffix = 1;\n");
        await writeFile(join(repo, "other.js"), "// TODO\nconst MYTODOS = 1;\n");
      }
      expect(spawnSync("git", ["-C", repo, "add", "."]).status).toBe(0);
      if (name === "spaced-filename") await writeFile(join(repo, "untracked.ts"), "// TODO: untracked\n");
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
    expect(counts).toEqual({ "docs-only": 0, mixed: 1, "spaced-filename": 3 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI excludes untracked source markers from the tracked-source count", async () => {
  const { chmod, mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "hygiene-untracked-"));
  try {
    const bin = join(dir, "bin");
    const root = join(dir, "repos");
    const repo = join(root, "fixture");
    await mkdir(bin);
    await mkdir(repo, { recursive: true });
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    await writeFile(join(repo, "tracked.ts"), "// FIXME: tracked marker\n");
    expect(spawnSync("git", ["-C", repo, "add", "tracked.ts"]).status).toBe(0);
    await writeFile(join(bin, "gh"), "#!/bin/sh\necho public\n");
    await chmod(join(bin, "gh"), 0o755);
    const count = () => {
      const result = spawnSync(process.execPath, [join(import.meta.dir, "repo-hygiene.ts"), "--root", root, "--json"], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.repos).toHaveLength(1);
      return json.repos[0].deadCode.todoFixmeCount;
    };
    expect(count()).toBe(1);
    await writeFile(join(repo, "untracked.ts"), "// TODO: untracked marker\n");
    expect(count()).toBe(1);
    expect(spawnSync("git", ["-C", repo, "add", "untracked.ts"]).status).toBe(0);
    expect(count()).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI counts a HACK marker in an eligible code file toward the TODO count", async () => {
  const { chmod, mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "hygiene-hack-"));
  try {
    const bin = join(dir, "bin");
    const root = join(dir, "repos");
    await mkdir(bin);
    await mkdir(root);
    const repo = join(root, "hack-fixture");
    await mkdir(repo);
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    // One real HACK marker in code; HACKY/HACKS suffixes and a HACK in a
    // non-code file must not count.
    await writeFile(join(repo, "source.ts"), "// HACK: work around upstream bug\nconst HACKY = 1;\n");
    await writeFile(join(repo, "NOTES.md"), "HACK: documentation marker\n");
    expect(spawnSync("git", ["-C", repo, "add", "."]).status).toBe(0);
    const gh = join(bin, "gh");
    await writeFile(gh, "#!/bin/sh\necho public\n");
    await chmod(gh, 0o755);
    const result = spawnSync(process.execPath, [join(import.meta.dir, "repo-hygiene.ts"), "--root", root, "--json"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.repos[0].deadCode.todoFixmeCount).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI counts each supported marker in a tracked source file", async () => {
  const { chmod, mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "hygiene-all-markers-"));
  try {
    const bin = join(dir, "bin");
    const root = join(dir, "repos");
    const repo = join(root, "markers");
    await mkdir(bin);
    await mkdir(repo, { recursive: true });
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    await writeFile(join(repo, "source.ts"), "// TODO: one\n// FIXME: two\n// XXX: three\n// HACK: four\n");
    expect(spawnSync("git", ["-C", repo, "add", "source.ts"]).status).toBe(0);
    const gh = join(bin, "gh");
    await writeFile(gh, "#!/bin/sh\necho public\n");
    await chmod(gh, 0o755);
    const result = spawnSync(process.execPath, [join(import.meta.dir, "repo-hygiene.ts"), "--root", root, "--json"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.repos).toHaveLength(1);
    expect(json.repos[0].deadCode.todoFixmeCount).toBe(4);
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
    const publicRepo = join(root, "public-fixture");
    await writeFile(join(publicRepo, "clean.ts"), "export const answer = 42;\n");
    expect(spawnSync("git", ["-C", publicRepo, "add", "clean.ts"]).status).toBe(0);
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
    expect(json.repos[0].code.files).toBe(1);
    expect(json.repos[0].deadCode.todoFixmeCount).toBe(0);
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

test("gitGrepCount returns 0 for an empty eligible file list (TODO count)", async () => {
  // An empty pathspec list must short-circuit: no git call, so even a
  // nonexistent repo path succeeds with a zero count.
  const todoPattern = String.raw`\b(TODO|FIXME|XXX|HACK)\b`;
  await expect(gitGrepCount("/nonexistent/repo-hygiene-empty", todoPattern, [])).resolves.toBe(0);
});

test("counts a TODO comment in a temporary source file offline", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "repo-hygiene-todo-"));
  try {
    expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
    await writeFile(join(dir, "source.ts"), "// TODO: finish this locally\nexport const value = 1;\n");
    expect(spawnSync("git", ["-C", dir, "add", "source.ts"]).status).toBe(0);
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, ["source.ts"])).resolves.toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gitGrepCount counts markers across eligible paths containing spaces", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "repo-hygiene-spaces-"));
  try {
    expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
    await mkdir(join(dir, "source files"));
    await writeFile(join(dir, "source files", "first file.ts"), "// TODO: one\n// FIXME: two\n");
    await writeFile(join(dir, "source files", "second file.rs"), "// HACK: three\n");
    await writeFile(join(dir, "source files", "notes.md"), "TODO: excluded\n");
    expect(spawnSync("git", ["-C", dir, "add", "."]).status).toBe(0);

    const first = "source files/first file.ts";
    const second = "source files/second file.rs";
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, [first])).resolves.toBe(2);
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, [second])).resolves.toBe(1);
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, [first, second])).resolves.toBe(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gitGrepCount finds no marker in an eligible file without marker words", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "repo-hygiene-marker-"));
  try {
    const gitRun = (args: string[]) =>
      spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
    expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
    await writeFile(join(dir, "clean.ts"), "export const answer = 42;\n// Plain comment, nothing to flag.\n");
    await writeFile(join(dir, "marked.ts"), "// TODO: tidy this up\nexport const x = 1;\n");
    expect(gitRun(["add", "."]).status).toBe(0);
    expect(gitRun(["commit", "-q", "-m", "fixture"]).status).toBe(0);

    // Plain alternation, not `\b`: BSD/macOS git grep -E does not support `\b`, so the
    // control below would read 0 there and the test would not prove anything.
    const todoPattern = "(TODO|FIXME|XXX|HACK)";
    // Clean file: git grep exits 1 (no match), which must surface as a zero count, not an error.
    await expect(gitGrepCount(dir, todoPattern, ["clean.ts"])).resolves.toBe(0);
    // Control: the same pattern does count a real marker, so the zero above is meaningful.
    await expect(gitGrepCount(dir, todoPattern, ["marked.ts"])).resolves.toBe(1);
    await expect(gitGrepCount(dir, todoPattern, ["clean.ts", "marked.ts"])).resolves.toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gitGrepCount finds a marker on the first line of an eligible file", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "repo-hygiene-line1-"));
  try {
    const gitRun = (args: string[]) =>
      spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
        encoding: "utf8",
      });
    expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
    await writeFile(join(dir, "first-line.ts"), "// FIXME: marker on line 1\nexport const a = 1;\nexport const b = 2;\n");
    await writeFile(join(dir, "other.ts"), "export const c = 3;\n");
    expect(gitRun(["add", "."]).status).toBe(0);
    expect(gitRun(["commit", "-q", "-m", "fixture"]).status).toBe(0);

    const pattern = "(TODO|FIXME|XXX|HACK)";
    // gitGrepCount only returns totals, so it sees the line-1 marker (not skipped as a header)
    // and attributes it to the right file alone.
    await expect(gitGrepCount(dir, pattern, ["first-line.ts"])).resolves.toBe(1);
    await expect(gitGrepCount(dir, pattern, ["other.ts"])).resolves.toBe(0);
    await expect(gitGrepCount(dir, pattern, ["first-line.ts", "other.ts"])).resolves.toBe(1);

    // Same pattern and pathspecs with -n: the one finding is first-line.ts, line 1.
    const located = gitRun(["grep", "-n", "-E", pattern, "--", "first-line.ts", "other.ts"]);
    expect(located.status).toBe(0);
    expect(located.stdout.trim().split("\n")).toEqual(["first-line.ts:1:// FIXME: marker on line 1"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TODO_MARKER_PATTERN ignores marker words embedded in longer identifiers", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "repo-hygiene-embedded-"));
  try {
    expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
    const files: Record<string, string> = {
      "embedded.ts": [
        "const TODO_suffix = 1;",
        "const prefix_TODO = 2;",
        "const MYTODOS = 3;",
        "const TODOList = 4;",
        "const aFIXMEb = 5;",
        "const HACK2 = 6;",
        "",
      ].join("\n"),
      "standalone.ts": "// TODO: real marker\n",
      "end-of-line.ts": "// remember to fix this: HACK\n",
      "start-of-line.ts": "XXX leading marker\n",
    };
    // Exercise both boundaries for every marker, including digits and underscores.
    files["boundary-matrix.ts"] = ["TODO", "FIXME", "XXX", "HACK"]
      .flatMap((marker) => ["a", "Z", "0", "_"].flatMap((neighbor) => [
        `${neighbor}${marker}`,
        `${marker}${neighbor}`,
        `${neighbor}${marker}${neighbor}`,
      ]))
      .join("\n");
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
    expect(spawnSync("git", ["-C", dir, "add", "."]).status).toBe(0);

    // Embedded-only files contribute nothing; each standalone form counts exactly once.
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, ["boundary-matrix.ts"])).resolves.toBe(0);
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, ["embedded.ts"])).resolves.toBe(0);
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, ["standalone.ts"])).resolves.toBe(1);
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, ["end-of-line.ts"])).resolves.toBe(1);
    await expect(gitGrepCount(dir, TODO_MARKER_PATTERN, ["start-of-line.ts"])).resolves.toBe(1);
    await expect(
      gitGrepCount(dir, TODO_MARKER_PATTERN, ["embedded.ts", "boundary-matrix.ts", "standalone.ts", "end-of-line.ts", "start-of-line.ts"]),
    ).resolves.toBe(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI reports zero markers when a repository has no tracked source files", async () => {
  const { chmod, mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "hygiene-empty-index-"));
  try {
    const bin = join(dir, "bin");
    const root = join(dir, "repos");
    const repo = join(root, "empty-index");
    await mkdir(bin);
    await mkdir(repo, { recursive: true });
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    await writeFile(join(repo, "untracked.ts"), "// TODO: untracked marker\n");
    const gh = join(bin, "gh");
    await writeFile(gh, "#!/bin/sh\necho public\n");
    await chmod(gh, 0o755);
    const result = spawnSync(process.execPath, [join(import.meta.dir, "repo-hygiene.ts"), "--root", root, "--json"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.repos).toHaveLength(1);
    expect(json.repos[0].name).toBe("empty-index");
    expect(json.repos[0].deadCode.todoFixmeCount).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI reports a zero TODO count for a fixture repo with no markers", async () => {
  const { chmod, mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "hygiene-no-markers-"));
  try {
    const bin = join(dir, "bin");
    const root = join(dir, "repos");
    await mkdir(bin);
    await mkdir(root);
    const repo = join(root, "clean-fixture");
    await mkdir(repo);
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    // Several eligible code types, none with a marker; marker-like substrings
    // inside longer words are not markers either.
    const files: Record<string, string> = {
      "a.ts": "export const answer = 42;\nconst TODO_suffix = 1;\nconst MYTODOS = 2;\n",
      "b.js": "module.exports = { ok: true };\n",
      "c.rs": "pub fn ok() -> bool { true }\n",
      "README.md": "# Clean fixture\nNothing to flag here.\n",
    };
    for (const [name, body] of Object.entries(files)) await writeFile(join(repo, name), body);
    expect(spawnSync("git", ["-C", repo, "add", "."]).status).toBe(0);
    const gh = join(bin, "gh");
    await writeFile(gh, "#!/bin/sh\necho public\n");
    await chmod(gh, 0o755);
    const result = spawnSync(process.execPath, [join(import.meta.dir, "repo-hygiene.ts"), "--root", root, "--json"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.repos).toHaveLength(1);
    expect(json.repos[0].deadCode.todoFixmeCount).toBe(0);
    await expect(gitGrepCount(repo, TODO_MARKER_PATTERN, ["a.ts", "b.js", "c.rs"])).resolves.toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
