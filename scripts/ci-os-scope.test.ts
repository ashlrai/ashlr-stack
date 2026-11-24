import { expect, test } from "bun:test";
import { isOsSensitive, runOsLegs } from "./ci-os-scope.mjs";

test("docs-only diffs skip the Windows and macOS legs", () => {
  expect(runOsLegs("pull_request", ["README.md", "docs/guide.md"])).toBe(false);
  expect(runOsLegs("merge_group", [])).toBe(false);
});

test("the path gate includes path handling, scripts, installers, manifests, lockfiles and the workflow", () => {
  const paths = [
    "packages/cli/src/lib/doctor-fix.ts",
    "packages/cli/src/lib/doctor-install.ts",
    "packages/cli/src/commands/open.ts",
    "packages/mcp/src/cwd.ts",
    "packages/mcp/src/stack-bin.ts",
    "packages/cli/src/commands/scan-path-spaces.test.ts",
    "scripts/install.sh",
    "scripts/install.ps1",
    "packages/site/public/install.sh",
    "package.json",
    "bun.lock",
    ".github/workflows/ci.yml",
    ".github/homebrew-formula.template.rb",
    ".gitattributes",
    "scripts/ci-os-scope.mjs",
    "scripts/ci-install-smoke.mjs",
  ];
  for (const path of paths) expect(isOsSensitive(path), path).toBe(true);
  expect(runOsLegs("pull_request", ["packages/core/src/errors.ts", ".github/workflows/ci.yml"])).toBe(true);
});

test("unrelated product code skips, and an unreadable diff or a schedule runs", () => {
  expect(isOsSensitive("packages/core/src/errors.ts")).toBe(false);
  expect(runOsLegs("pull_request", ["packages/core/src/errors.ts"])).toBe(false);
  expect(runOsLegs("pull_request", null)).toBe(true);
  expect(runOsLegs("schedule", [])).toBe(true);
  expect(runOsLegs("workflow_dispatch", [])).toBe(true);
});
