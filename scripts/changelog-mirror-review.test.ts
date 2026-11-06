import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const guide = readFileSync(join(root, "docs/changelog-mirror-review.md"), "utf8");
const commands = [...guide.matchAll(/```sh\n([^\n]+)\n```/g)].map((match) => match[1]);

test("the documented apply fix belongs to the 0.2.1 bug fixes in both copies", () => {
  for (const path of ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]) {
    const changelog = readFileSync(join(root, path), "utf8");
    const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    expect(fixes).toContain("`stack apply` stops attempting to write placeholder secrets.");
  }
});

test("documented comparison locates the shared entry and exposes unrelated differences", () => {
  expect(commands).toHaveLength(3);
  const dir = mkdtempSync(join(tmpdir(), "changelog-review-"));
  try {
    const siteDir = join(dir, "packages/site/src/data");
    mkdirSync(siteDir, { recursive: true });
    const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    writeFileSync(join(dir, "CHANGELOG.md"), source);
    writeFileSync(join(siteDir, "CHANGELOG.md"), source);

    const run = (command: string) => spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8" });
    const matches = run(commands[0]);
    expect(matches.status).toBe(0);
    expect(matches.stdout.split("\n").filter(Boolean)).toHaveLength(2);
    expect(matches.stdout).toContain("CHANGELOG.md:");
    expect(matches.stdout).toContain("packages/site/src/data/CHANGELOG.md:");
    expect(run(commands[1]).status).toBe(0);

    writeFileSync(join(siteDir, "CHANGELOG.md"), `${source}\nSite-only note.\n`);
    const diff = run(commands[1]);
    expect(diff.status).toBe(1);
    expect(diff.stdout).toContain("+Site-only note.");
    expect(run(commands[0]).stdout.split("\n").filter(Boolean)).toHaveLength(2);

    rmSync(join(siteDir, "CHANGELOG.md"));
    expect(run(commands[1]).status).toBeGreaterThan(1);
    // A match in just one file is not enough to establish that both contain it.
    expect(run(commands[0]).stdout.split("\n").filter(Boolean)).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the apply checklist locates and compares only the 0.2.1 fix", () => {
  const checklist = readFileSync(join(root, "docs/changelog-mirror-checklist.md"), "utf8");
  const command = checklist.match(/```sh\n\s*(grep [^\n]+)\n\s*```/)?.[1];
  expect(command).toBeDefined();
  const dir = mkdtempSync(join(tmpdir(), "apply-checklist-"));
  try {
    const siteDir = join(dir, "packages/site/src/data");
    mkdirSync(siteDir, { recursive: true });
    const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const site = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
    const entry = (text: string) =>
      text
        .split("## 0.2.1 (2026-10-16)\n")[1]
        ?.split("\n## ")[0]
        ?.split("### Bug fixes\n")[1]
        ?.match(/^- \*\*`stack apply` stops attempting to write placeholder secrets\.[\s\S]*?(?=\n- |\n### |$)/m)?.[0];
    expect(entry(source)).toBeDefined();
    expect(entry(site)).toBe(entry(source));

    writeFileSync(join(dir, "CHANGELOG.md"), source);
    writeFileSync(join(siteDir, "CHANGELOG.md"), `${site}\nUnrelated site note.\n`);
    const search = spawnSync("sh", ["-c", command ?? ""], { cwd: dir, encoding: "utf8" });
    expect(search.status).toBe(0);
    expect(search.stdout.split("\n").filter(Boolean)).toHaveLength(2);
    expect(entry(`${site}\nUnrelated site note.\n`)).toBe(entry(source));
    expect(entry(site.replace("The wiring step never writes", "The wiring step writes"))).not.toBe(
      entry(source),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
