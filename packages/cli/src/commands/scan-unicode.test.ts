import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "index.ts");
const workflowNames = ["構建.yml", "部署-🚀.yaml"];
let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test("scan preserves Unicode workflow names in JSON and human reports", () => {
  root = mkdtempSync(join(tmpdir(), "stack-scan-unicode-"));
  const project = join(root, "项目-🚀");
  const workflows = join(project, ".github", "workflows");
  mkdirSync(workflows, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "项目-🚀" }));
  for (const name of workflowNames) writeFileSync(join(workflows, name), "name: CI\n");

  const run = (flags: string[]) =>
    spawnSync("bun", [cli, "scan", "--path", project, ...flags], {
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      timeout: 15_000,
    });

  const json = run(["--json"]);
  expect(json.status).toBe(0);
  expect(json.stderr).toBe("");
  const result: { hits: Array<{ provider: string; confidence: string; sources: string[] }> } =
    JSON.parse(json.stdout);
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0].provider).toBe("github");
  expect(result.hits[0].confidence).toBe("high");
  for (const name of workflowNames) {
    expect(result.hits[0].sources).toContain(`.github/workflows/${name}`);
  }

  const report = run([]);
  expect(report.status).toBe(0);
  expect(report.stderr).toBe("");
  expect(report.stdout).toContain(project);
  expect(report.stdout).toContain("github");
  for (const name of workflowNames) expect(report.stdout).toContain(`.github/workflows/${name}`);
  expect(report.stdout).toContain("scan complete");
}, 30_000);
