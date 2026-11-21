import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Guards docs/site-changelog-review.md, which merges the former
// site-changelog-entry-location, site-changelog-review-checklist and
// site-changelog-source-reference guides and their tests.
const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/site-changelog-review.md");
const doc = readFileSync(docPath, "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";
const bareTitle = "`stack apply` stops attempting to write placeholder secrets.";

function section(text: string, release: string, subsection: string): string {
  return text.split(`## ${release}\n`)[1]?.split("\n## ")[0]?.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
}

function commands(): string[] {
  return [...doc.matchAll(/```sh\n([^\n]+)\n```/g)].map((match) => match[1]);
}

test("the guide identifies the same first 0.2.1 bug fix in both changelogs", () => {
  expect(doc).toContain("0.2.1 (2026-10-16) → Bug fixes");
  expect(doc).toContain(title.slice(2));
  expect(doc).toContain("../CHANGELOG.md#021-2026-10-16");
  expect(doc).toContain("../packages/site/src/data/CHANGELOG.md#021-2026-10-16");
  expect(doc).toContain("wording differences");
  const copies = paths.map((path) => readFileSync(join(root, path), "utf8"));
  const entries = copies.map((changelog) => {
    const fixes = section(changelog, "0.2.1 (2026-10-16)", "Bug fixes");
    expect(fixes.trimStart().startsWith(title)).toBe(true);
    expect(changelog.split(title)).toHaveLength(2);
    const lines = changelog.split("\n").filter((line) => line.startsWith(title));
    expect(lines).toHaveLength(1);
    return lines[0];
  });
  expect(entries[0]).toBe(entries[1]);
  expect(copies[0]).toBe(copies[1]);
});

test("the worked example's reviewable facts are in both entries", () => {
  for (const path of paths) {
    const fixes = section(readFileSync(join(root, path), "utf8"), "0.2.1 (2026-10-16)", "Bug fixes");
    const entries = fixes.split("\n").filter((line) => line.includes(bareTitle));
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

test("later context described by the guide is present in each copy", () => {
  for (const path of paths) {
    const copy = readFileSync(join(root, path), "utf8");
    const released = section(copy, "0.3.0 (2026-10-31)", "Changed");
    const unreleased = section(copy, "Unreleased", "Changed");
    expect(released).toContain("After at least one provider succeeds, `stack apply` wiring checks");
    expect(unreleased).toContain("including providers that failed");
    expect(unreleased).toContain("even if the vault is unreadable");
    expect(unreleased).toContain("`--noWire` skips both checks and stubs");
  }
});

test("documented search and diff expose missing, duplicate and changed copies", () => {
  const [search, diff] = commands();
  expect(commands()).toHaveLength(2);
  expect(search).toStartWith("grep ");
  expect(diff).toStartWith("diff ");
  const dir = mkdtempSync(join(tmpdir(), "site-changelog-review-"));
  try {
    const source = readFileSync(join(root, paths[0]), "utf8");
    mkdirSync(join(dir, dirname(paths[1])), { recursive: true });
    for (const path of paths) writeFileSync(join(dir, path), source);
    const sitePath = join(dir, paths[1]);
    const run = (command: string) => spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8" });
    expect(run(search).status).toBe(0);
    expect(run(search).stdout.trim().split("\n")).toHaveLength(2);
    expect(run(diff).status).toBe(0);

    writeFileSync(sitePath, `${source}\nUnrelated site-only text.\n`);
    expect(run(search).stdout.trim().split("\n")).toHaveLength(2);

    writeFileSync(sitePath, source.replace("The wiring step never writes", "The wiring step writes"));
    const changed = run(diff);
    expect(changed.status).toBe(1);
    expect(changed.stdout).toContain("The wiring step writes");

    writeFileSync(sitePath, source.replace(title, "- Removed entry."));
    const missing = run(search);
    expect(missing.status).toBe(0);
    expect(missing.stdout.trim().split("\n")).toHaveLength(1);

    writeFileSync(sitePath, `${source}\n${bareTitle}\n`);
    expect(run(search).stdout.trim().split("\n")).toHaveLength(3);

    rmSync(sitePath);
    expect(run(diff).status).toBeGreaterThan(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guide links resolve", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const [file, anchor] = match[1].split("#");
    const target = resolve(dirname(docPath), file);
    expect(existsSync(target), `broken link: ${match[1]}`).toBe(true);
    // The only anchors are the 0.2.1 release headings, checked above via section().
    if (anchor) expect(anchor).toBe("021-2026-10-16");
  }
});
