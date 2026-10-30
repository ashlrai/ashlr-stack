import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetCollisions } from "./fleet-collisions.ts";

const pr = (number: number, paths = ["hot.ts"]) => ({
  number,
  state: "OPEN",
  mergeable: "CONFLICTING",
  files: paths.map((path) => ({ path })),
});
const fixture = [
  pr(4),
  pr(2, ["hot.ts", "warm.ts", "hot.ts"]),
  pr(3),
  pr(1, ["hot.ts", "warm.ts"]),
  pr(1),
  { ...pr(5), state: "CLOSED" },
  { ...pr(6), state: "MERGED" },
  { ...pr(7), mergeable: "MERGEABLE" },
  { ...pr(8), mergeable: "UNKNOWN" },
  pr(9, ["z.ts", "a.ts", "__proto__"]),
  pr(10, []),
];

test("fixture ranks four distinct conflicting PRs first and breaks ties by path", () => {
  const report = collectFleetCollisions(fixture);
  expect(report).toEqual({
    schemaVersion: 1,
    files: [
      { path: "hot.ts", prCount: 4, prs: [1, 2, 3, 4] },
      { path: "warm.ts", prCount: 2, prs: [1, 2] },
      ...["__proto__", "a.ts", "z.ts"].map((path) => ({ path, prCount: 1, prs: [9] })),
    ],
  });
  expect(collectFleetCollisions([...fixture].reverse())).toEqual(report);
  expect(collectFleetCollisions([]).files).toEqual([]);
  expect(collectFleetCollisions([{ ...pr(1), mergeable: "UNKNOWN" }]).files).toEqual([]);
});

test("rejects malformed or incomplete evidence instead of reporting zero collisions", () => {
  for (const input of [
    null,
    {},
    [null],
    [pr(0)],
    [pr(1.5)],
    [{ ...pr(1), state: null }],
    [{ ...pr(1), mergeable: null }],
    [{ ...pr(1), files: null }],
    [{ ...pr(1), files: [null] }],
    [{ ...pr(1), files: [{ path: "" }] }],
  ])
    expect(() => collectFleetCollisions(input)).toThrow();
});

test("CLI reads stdin and files, fails safely, and appears in help and completions", async () => {
  const home = await mkdtemp(join(tmpdir(), "fleet-collisions-"));
  const text = JSON.stringify(fixture);
  const file = join(home, "prs.json");
  const cli = async (args: string[], input = "", code = 0) => {
    const child = Bun.spawn([process.execPath, "run", "packages/cli/src/index.ts", ...args], {
      env: { HOME: home, PATH: "", STACK_NO_UPDATE_CHECK: "1", STACK_TELEMETRY: "0" },
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(await child.exited).toBe(code);
    if (code === 0) expect(stderr).toBe("");
    else {
      expect(stdout).toBe("");
      expect(stderr).not.toContain("private-input");
    }
    return stdout;
  };
  try {
    await writeFile(file, text);
    for (const args of [[], ["--file", "-"], ["--file", file, "--json"]])
      expect(JSON.parse(await cli(["fleet-collisions", ...args], text))).toEqual(
        collectFleetCollisions(fixture),
      );
    expect(await readFile(file, "utf8")).toBe(text);
    await cli(["fleet-collisions"], "private-input", 1);
    await cli(["fleet-collisions"], "{}", 1);
    await cli(["fleet-collisions", "--file", join(home, "private-input")], "", 1);
    expect(await cli(["fleet-collisions", "--help"])).toContain("--file");
    expect(await cli(["--help"])).toContain("fleet-collisions");
    for (const shell of ["bash", "zsh", "fish"])
      expect(await cli(["completion", shell])).toContain("fleet-collisions");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
