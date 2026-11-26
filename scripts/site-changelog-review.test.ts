import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Guards docs/site-changelog-review.md, which merges the former
// site-changelog-entry-location, site-changelog-review-checklist,
// site-changelog-source-reference, site-changelog-source-map and
// site-changelog-placeholder-timeline guides and their tests.
const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/site-changelog-review.md");
const doc = readFileSync(docPath, "utf8");
const flatDoc = doc.replace(/\s+/g, " ");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const sitePath = "../packages/site/src/data/CHANGELOG.md";
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";
const bareTitle = "`stack apply` stops attempting to write placeholder secrets.";

// Release headings the guide links to, with their GitHub anchors.
const releases = [
  ["Unreleased", "unreleased"],
  ["0.3.0 (2026-10-31)", "030-2026-10-31"],
  ["0.2.2 (2026-10-25)", "022-2026-10-25"],
  ["0.2.1 (2026-10-16)", "021-2026-10-16"],
  ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011"],
];

// Source map rows: [release heading, `### ` subsection heading, text the entry
// begins with, GitHub anchor for the release heading]
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
  return text.split(`## ${release}\n`)[1]?.split("\n## ")[0]?.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
}

function commands(): string[] {
  return [...doc.matchAll(/```sh\n([^\n]+)\n```/g)].map((match) => match[1]);
}

function applyBullets(changelog: string): string[] {
  return changelog.split("\n").filter((line) => line.startsWith("- ") && line.includes("`stack apply"));
}

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
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
  expect(commands()).toHaveLength(3);
  expect(search).toStartWith("grep -n -F ");
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

    writeFileSync(sitePath, source.replace("stops attempting to write placeholder secrets", "continues attempting them"));
    expect(run(diff).status).toBe(1);

    rmSync(sitePath);
    expect(run(diff).status).toBeGreaterThan(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the source map points each apply entry at the same section in both changelogs", () => {
  const copies = paths.map((path) => readFileSync(join(root, path), "utf8"));
  expect(copies[0]).toBe(copies[1]);
  for (const [release, subsection, lead, anchor] of rows) {
    expect(doc).toContain(`](../CHANGELOG.md#${anchor})`);
    expect(doc).toContain(`](${sitePath}#${anchor})`);
    expect(flatDoc).toContain(lead.replace(/\s+/g, " "));
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
    expect(flatDoc, `unaccounted apply bullet: ${signature}`).toContain(signature.replace(/\s+/g, " "));
  }
});

test("the source map search lists the apply bullets at matching lines in both copies", () => {
  const mapSearch = commands()[2];
  expect(mapSearch).toStartWith("grep -n -E ");
  const dir = mkdtempSync(join(tmpdir(), "site-changelog-map-"));
  try {
    mkdirSync(join(dir, dirname(paths[1])), { recursive: true });
    const source = readFileSync(join(root, paths[0]), "utf8");
    for (const path of paths) writeFileSync(join(dir, path), source);
    const search = spawnSync("sh", ["-c", mapSearch], { cwd: dir, encoding: "utf8" });
    expect(search.status).toBe(0);
    const hits = search.stdout.trim().split("\n");
    expect(hits).toHaveLength(applyBullets(source).length * 2);
    const lineNumbers = (file: string) =>
      hits.filter((line) => line.startsWith(`${file}:`)).map((line) => line.split(":")[1]);
    expect(lineNumbers(paths[0])).toEqual(lineNumbers(paths[1]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the placeholder timeline identifies the stop entry and its operational qualifications", () => {
  const changelog = readFileSync(join(root, paths[1]), "utf8");
  const timeline = doc.split("\n## Apply placeholder timeline\n")[1] ?? "";
  for (const [heading, anchor] of releases) {
    expect(changelog).toContain(`\n## ${heading}\n`);
    expect(timeline).toContain(`](${sitePath}#${anchor})`);
  }
  const fixes = section(changelog, "0.2.1 (2026-10-16)", "Bug fixes");
  expect(fixes.trimStart()).toStartWith(title);
  for (const phrase of ["TODO_STACK_APPLY", "`WireResult.envelopes`", "`present` and `missing`"]) {
    expect(fixes).toContain(phrase);
    expect(timeline).toContain(phrase);
  }
  const flatTimeline = timeline.replace(/\s+/g, " ");
  for (const phrase of [
    "0.2.1 was tagged but its npm publish failed",
    "unreadable",
    "provider failures do",
    "`--noWire`",
  ]) {
    expect(flatTimeline).toContain(phrase);
  }
});

test("the placeholder timeline links 0.1.0 before 0.2.1", () => {
  const timeline = doc.split("\n## Apply placeholder timeline\n")[1]?.split("\n## ")[0] ?? "";
  const links = [...timeline.matchAll(/^\| (\[[^\]]+\]\([^)]+\)) \|/gm)].map(
    (match) => match[1],
  );
  const initial = links.indexOf(
    `[0.1.0](${sitePath}#010--2026-04-19-superseded-by-011)`,
  );
  const stop = links.indexOf(`[0.2.1 (2026-10-16)](${sitePath}#021-2026-10-16)`);

  expect(initial, "missing linked 0.1.0 timeline row").toBeGreaterThanOrEqual(0);
  expect(stop, "missing linked 0.2.1 timeline row").toBeGreaterThanOrEqual(0);
  expect(stop, "linked 0.2.1 must follow linked 0.1.0").toBeGreaterThan(initial);
});

test("guide links and anchors resolve", () => {
  const headings = new Set([...doc.matchAll(/^#{2,3} (.+)$/gm)].map((match) => slug(match[1])));
  const releaseAnchors = new Set(releases.map(([, anchor]) => anchor));
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const [file, anchor] = match[1].split("#");
    if (file === "") {
      expect(headings.has(anchor), `missing in-page heading: ${match[1]}`).toBe(true);
      continue;
    }
    expect(existsSync(resolve(dirname(docPath), file)), `broken link: ${match[1]}`).toBe(true);
    // Changelog anchors are the release headings checked against both copies above.
    if (anchor) expect(releaseAnchors.has(anchor), `unexpected anchor: ${match[1]}`).toBe(true);
  }
});
