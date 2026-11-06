import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const cli = join(import.meta.dir, "../packages/cli/src/index.ts");
const docs = readFileSync(join(import.meta.dir, "../docs/scan-output-examples.md"), "utf8");
const examples = [...docs.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "scan-output-examples-"));
  roots.push(root);
  return root;
}

function scan(cwd: string) {
  const result = spawnSync("bun", [cli, "scan", "--json"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", CI: "1" },
    timeout: 30_000,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

test("documented empty and populated JSON match the scan command", () => {
  expect(examples).toHaveLength(3);
  const empty = project();
  writeFileSync(join(empty, "package.json"), "{}");
  expect(scan(empty)).toEqual(JSON.parse(examples[0]));

  const populated = project();
  writeFileSync(join(populated, "package.json"), examples[1]);
  writeFileSync(join(populated, "vercel.json"), "");
  expect(scan(populated)).toEqual(JSON.parse(examples[2]));
}, 70_000);
