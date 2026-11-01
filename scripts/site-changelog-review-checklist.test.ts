import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const checklist = readFileSync(join(root, "docs/site-changelog-review-checklist.md"), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "`stack apply` stops attempting to write placeholder secrets.";

test("worked example points to the actual fix and its reviewable facts in both files", () => {
  expect(checklist).toContain("0.2.1 (2026-10-16) → Bug fixes");
  for (const path of paths) {
    const source = readFileSync(join(root, path), "utf8");
    const release = source.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    const entries = fixes?.split("\n").filter((line) => line.includes(title)) ?? [];
    expect(entries).toHaveLength(1);
    for (const fact of [
      "never writes to the vault or fills in missing values",
      "Provider setup may already store real values",
      "users must supply each required missing value",
      "When the vault is readable",
      "reports providers as skipped",
      "Previously, wiring ran",
      "`WireResult.envelopes` is replaced by `present` and `missing`",
    ]) expect(entries[0]).toContain(fact);
  }
});

test("documented search finds each entry independently despite surrounding changes", () => {
  const command = checklist.match(/```sh\n([^\n]+)\n```/)?.[1];
  expect(command).toBeDefined();
  const dir = mkdtempSync(join(tmpdir(), "site-changelog-review-"));
  try {
    const source = readFileSync(join(root, paths[0]), "utf8");
    mkdirSync(join(dir, "packages/site/src/data"), { recursive: true });
    writeFileSync(join(dir, paths[0]), source);
    const sitePath = join(dir, paths[1]);
    writeFileSync(sitePath, `${source}\nUnrelated site-only text.\n`);
    const search = () => spawnSync("sh", ["-c", command ?? ""], { cwd: dir, encoding: "utf8" });
    expect(search().stdout.trim().split("\n")).toHaveLength(2);
    writeFileSync(sitePath, source.replace(title, "Removed entry"));
    const missing = search();
    expect(missing.status).toBe(0);
    expect(missing.stdout.trim().split("\n")).toHaveLength(1);
    writeFileSync(sitePath, `${source}\n${title}\n`);
    expect(search().stdout.trim().split("\n")).toHaveLength(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
