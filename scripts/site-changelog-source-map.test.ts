import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/site-changelog-source-map.md");
const rawDoc = readFileSync(docPath, "utf8");
const doc = rawDoc.replace(/\s+/g, " ");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

// [release heading, `### ` subsection heading, text the entry begins with,
// GitHub anchor for the release heading]
const rows = [
  ["Unreleased", "Changed", "`stack apply` does not create placeholder secrets.", "unreleased"],
  [
    "0.3.0 (2026-10-31)",
    "Changed and fixed",
    "Apply wiring checks existing secret names without storing placeholders",
    "030-2026-10-31",
  ],
  [
    "0.3.0 (2026-10-31)",
    "Changed",
    "After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names",
    "030-2026-10-31",
  ],
  [
    "0.2.2 (2026-10-25)",
    "Bug fixes",
    "**`stack apply` with a missing recipe writes nothing.**",
    "022-2026-10-25",
  ],
  [
    "0.2.2 (2026-10-25)",
    "Bug fixes",
    "**`stack apply` and `stack init --template` keep going after a provider fails.**",
    "022-2026-10-25",
  ],
  [
    "0.2.1 (2026-10-16)",
    "Bug fixes",
    "**`stack apply` stops attempting to write placeholder secrets.**",
    "021-2026-10-16",
  ],
  [
    "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    "AI recommendation layer — `stack recommend` + `stack apply`",
    "**`stack apply [recipe-id]`**",
    "010--2026-04-19-superseded-by-011",
  ],
];

function section(text: string, release: string, subsection: string): string {
  const body = text.split(`## ${release}\n`)[1]?.split("\n## ")[0] ?? "";
  return body.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
}

function applyBullets(changelog: string): string[] {
  return changelog.split("\n").filter((line) => line.startsWith("- ") && line.includes("`stack apply"));
}

test("the map points each apply entry at the same section in both changelogs", () => {
  const copies = paths.map((path) => readFileSync(join(root, path), "utf8"));
  expect(copies[0]).toBe(copies[1]);
  for (const [release, subsection, lead, anchor] of rows) {
    expect(doc).toContain(`](../CHANGELOG.md#${anchor})`);
    expect(doc).toContain(`](../packages/site/src/data/CHANGELOG.md#${anchor})`);
    expect(doc).toContain(lead.replace(/\s+/g, " "));
    for (const copy of copies) {
      const bullets = section(copy, release, subsection)
        .split("\n")
        .filter((line) => line.startsWith(`- ${lead}`));
      expect(bullets, `${release} → ${subsection}: ${lead}`).toHaveLength(1);
    }
  }
});

test("every changelog bullet spelling `stack apply` is mapped or noted as a mention", () => {
  const changelog = readFileSync(join(root, paths[1]), "utf8");
  const verbatimRows = rows.filter(([, , lead]) => lead.includes("`stack apply")).length;
  const bullets = applyBullets(changelog);
  expect(bullets.length).toBeGreaterThanOrEqual(verbatimRows);
  for (const bullet of bullets) {
    // Titled entries are identified by their bold lead; untitled entries by
    // their first 40 characters. Either way the doc must account for them.
    const signature = bullet.match(/^- \*\*([^*]+)\*\*/)?.[1] ?? bullet.slice(2, 42);
    expect(doc, `unaccounted apply bullet: ${signature}`).toContain(signature.replace(/\s+/g, " "));
  }
});

test("the documented commands locate the apply bullets and compare the copies", () => {
  const commands = [...rawDoc.matchAll(/```sh\n([^\n]+)\n```/g)].map((match) => match[1]);
  expect(commands).toHaveLength(3);
  const dir = mkdtempSync(join(tmpdir(), "site-changelog-map-"));
  try {
    mkdirSync(join(dir, dirname(paths[1])), { recursive: true });
    const source = readFileSync(join(root, paths[0]), "utf8");
    for (const path of paths) writeFileSync(join(dir, path), source);
    const run = (command: string) => spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8" });

    const search = run(commands[0]);
    expect(search.status).toBe(0);
    const hits = search.stdout.trim().split("\n");
    expect(hits).toHaveLength(applyBullets(source).length * 2);
    const lineNumbers = (file: string) =>
      hits.filter((line) => line.startsWith(`${file}:`)).map((line) => line.split(":")[1]);
    expect(lineNumbers(paths[0])).toEqual(lineNumbers(paths[1]));
    expect(run(commands[1]).status).toBe(0);

    writeFileSync(
      join(dir, paths[1]),
      source.replace("stops attempting to write placeholder secrets", "continues attempting them"),
    );
    expect(run(commands[1]).status).toBe(1);
    rmSync(join(dir, paths[1]));
    expect(run(commands[1]).status).toBeGreaterThan(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("map links resolve", () => {
  for (const match of rawDoc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
