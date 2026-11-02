import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-placeholder-command-history.md");
const doc = readFileSync(docPath, "utf8");
const changelogs = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"].map((path) =>
  readFileSync(join(root, path), "utf8"),
);

function releaseSection(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, `missing heading: ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const end = rest.slice(heading.length).search(/^## /m);
  return end === -1 ? rest : rest.slice(0, heading.length + end);
}

// Extract the value only when both release entries describe failed, past attempts.
function historicalPlaceholderValues(changelog: string): string[] | null {
  const fix = releaseSection(changelog, "## 0.2.1 (2026-10-16)");
  const initial = releaseSection(changelog, "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)");
  const commands = [...fix.matchAll(/Previously, wiring ran `phantom add <KEY> ([A-Z0-9_]+) --rotate`[^\n]*?every call failed/g)];
  const placeholders = [...initial.matchAll(/Historically, wiring attempted to write a `([A-Z0-9_]+)` placeholder[^\n]*?those calls failed/g)];
  if (commands.length !== 1 || placeholders.length !== 1) return null;
  return [commands[0][1], placeholders[0][1]];
}

test("both changelogs agree on the historical placeholder value in both releases", () => {
  for (const changelog of changelogs) {
    expect(historicalPlaceholderValues(changelog)).toEqual(["TODO_STACK_APPLY", "TODO_STACK_APPLY"]);
  }
});

test("the original stack apply entry identifies the placeholder as historical", () => {
  for (const changelog of changelogs) {
    const initial = releaseSection(changelog, "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)");
    const entry = initial.split("\n").find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
    expect(entry).toContain("Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder");
    expect(entry).toContain("those calls failed; the 0.2.1 fix above removed the attempts");
    expect(entry).toContain("Wiring no longer attempts to write placeholder values");
  }
});

test("the historical placeholder check detects drift and loss of historical context", () => {
  const source = changelogs[0];
  expect(historicalPlaceholderValues(source.replace("<KEY> TODO_STACK_APPLY --rotate", "<KEY> OTHER_VALUE --rotate")))
    .not.toEqual(["TODO_STACK_APPLY", "TODO_STACK_APPLY"]);
  expect(historicalPlaceholderValues(source.replace("a `TODO_STACK_APPLY` placeholder", "a `OTHER_VALUE` placeholder")))
    .not.toEqual(["TODO_STACK_APPLY", "TODO_STACK_APPLY"]);
  for (const phrase of ["Previously, wiring ran", "every call failed", "Historically, wiring attempted", "those calls failed"]) {
    expect(historicalPlaceholderValues(source.replace(phrase, ""))).toBeNull();
  }
});

test("both changelogs document the attempted command and its removal", () => {
  for (const changelog of changelogs) {
    const fix = releaseSection(changelog, "## 0.2.1 (2026-10-16)");
    const bugFixes = fix.slice(fix.indexOf("### Bug fixes") + "### Bug fixes".length);
    expect(
      bugFixes
        .trimStart()
        .startsWith("- **`stack apply` stops attempting to write placeholder secrets.**"),
    ).toBe(true);
    expect(fix).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate`");
    expect(fix).toContain("every call failed");
    expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");

    const initial = releaseSection(changelog, "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)");
    expect(initial).toContain(
      "wiring attempted to write a `TODO_STACK_APPLY` placeholder for each declared secret",
    );
    expect(initial).toContain("the 0.2.1 fix above removed the attempts");
  }
});

test("both changelog entries retain the historical --rotate qualifier", () => {
  for (const changelog of changelogs) {
    const fix = releaseSection(changelog, "## 0.2.1 (2026-10-16)");
    const entry = fix.split("\n\n").find((paragraph) =>
      paragraph.startsWith("- **`stack apply` stops attempting to write placeholder secrets.**"),
    );
    expect(entry).toContain(
      "Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`) for every declared secret.",
    );
  }
});

test("the doc records the historical command and where its removal is documented", () => {
  expect(doc).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate`");
  expect(doc).toContain("`phantom add <KEY> TODO_STACK_APPLY`");
  expect(doc.replace(/\s+/g, " ")).toContain(
    "**`stack apply` stops attempting to write placeholder secrets.**",
  );
  for (const release of ["0.1.0", "0.2.1", "0.2.2", "0.3.0"]) {
    expect(doc).toContain(release);
  }
});

test("the doc never presents the placeholder command as a current instruction", () => {
  for (const block of doc.matchAll(/```\w*\n[\s\S]*?```/g)) {
    expect(block[0]).not.toContain("TODO_STACK_APPLY");
  }
  for (const line of doc.split("\n")) {
    if (!line.includes("TODO_STACK_APPLY")) continue;
    const historical =
      /^>/.test(line) ||
      /attempt|histor|remov|fail|do not|no longer|previous|once|old/i.test(line);
    expect(historical, `non-historical mention: ${line}`).toBe(true);
  }
  expect(doc).toMatch(/[Dd]o not run/);
  expect(doc).toContain("historical record only");
  expect(doc).toContain("`phantom add <NAME>` in a trusted terminal");
});

test("blockquotes in the doc are verbatim changelog text", () => {
  const flatChangelog = changelogs[0].replace(/\s+/g, " ");
  const quotes = doc.match(/(^> .+\n?)+/gm) ?? [];
  expect(quotes.length).toBeGreaterThanOrEqual(2);
  for (const quote of quotes) {
    const text = quote
      .split("\n")
      .map((line) => line.replace(/^> ?/, ""))
      .join(" ")
      .trim();
    expect(flatChangelog, `quote not in changelog: ${text.slice(0, 60)}…`).toContain(text);
  }
});

test("every relative link resolves and every changelog fragment names a heading", () => {
  const headings = [...changelogs[0].matchAll(/^#+ (.+)$/gm)].map((heading) =>
    heading[1].toLowerCase().replace(/[^\w\s-]/g, "").replace(/ /g, "-"),
  );
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const [target, fragment] = match[1].split("#");
    if (/^[a-z]+:/.test(target)) continue;
    const path = resolve(dirname(docPath), target);
    expect(existsSync(path), `broken link: ${match[1]}`).toBe(true);
    if (fragment && path === join(root, "CHANGELOG.md")) {
      expect(headings).toContain(fragment);
    }
  }
});
