import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const supportPath = resolve(root, "SUPPORT.md");
const support = readFileSync(supportPath, "utf8");

// Inline markdown links: [text](target). Reference-style links are not used in SUPPORT.md.
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

function linkTargets(markdown: string): string[] {
  return [...markdown.matchAll(LINK)].map((match) => match[1] as string);
}

function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

test("SUPPORT.md exists at the repository root", () => {
  expect(existsSync(supportPath)).toBe(true);
});

test("every relative link in SUPPORT.md resolves to an existing file or directory", () => {
  // SUPPORT.md sits at the root, so relative targets resolve from there.
  const relative = linkTargets(support).filter((target) => !isExternal(target) && !target.startsWith("#"));
  expect(relative.length).toBeGreaterThan(0);

  const broken = relative.filter((target) => !existsSync(resolve(root, target.split("#")[0]!)));

  expect(broken).toEqual([]);
});

test("SUPPORT.md links to SECURITY.md and CONTRIBUTING.md", () => {
  const targets = linkTargets(support);
  expect(targets).toContain("./SECURITY.md");
  expect(targets).toContain("./CONTRIBUTING.md");
});

test("SUPPORT.md routes security reports to the private advisory flow, not public issues", () => {
  const section = support.split("## Report a security issue")[1]?.split("\n## ")[0] ?? "";
  expect(section).toContain("Do not open a public issue");
  expect(section).toContain("./SECURITY.md");
  expect(section).not.toMatch(/issues\/new\?template=bug_report/);
});
