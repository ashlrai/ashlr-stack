import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("Homebrew release step renders every template placeholder from its sidecars", () => {
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  const header =
    /^      - if: steps\.cred_check\.outputs\.method != 'skip'\n        name: Generate Formula\/stack\.rb from template\n        run: \|\n/m.exec(
      workflow,
    );
  expect(header).not.toBeNull();
  if (!header) throw new Error("Homebrew formula render step not found");
  const start = header.index + header[0].length;
  const end = workflow.indexOf("\n      - ", start);
  if (end < 0) throw new Error("Homebrew formula render step is not bounded");
  const script = workflow
    .slice(start, end)
    .split("\n")
    .map((line) => {
      if (line.trim() && !line.startsWith("          "))
        throw new Error("Unexpected YAML indentation");
      return line.slice(10);
    })
    .join("\n");
  const template = readFileSync(join(root, ".github/homebrew-formula.template.rb"), "utf8");
  const version = "12.34.56-rc.4";
  const hashes = {
    DARWIN_ARM64: "a".repeat(64),
    DARWIN_X64: "b".repeat(64),
    LINUX_ARM64: "c".repeat(64),
    LINUX_X64: "d".repeat(64),
  };
  const dir = mkdtempSync(join(tmpdir(), "stack-homebrew-render-"));
  try {
    mkdirSync(join(dir, "stack-repo/.github"), { recursive: true });
    mkdirSync(join(dir, "homebrew-tap/Formula"), { recursive: true });
    mkdirSync(join(dir, "sha256s"), { recursive: true });
    writeFileSync(join(dir, "stack-repo/.github/homebrew-formula.template.rb"), template);
    for (const [key, hash] of Object.entries(hashes)) {
      const asset = `stack-${key.toLowerCase().replace("_", "-")}`;
      writeFileSync(join(dir, `sha256s/${asset}.sha256`), `${hash}  ${asset}\n`);
    }
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF_NAME: `v${version}` },
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const actual = readFileSync(join(dir, "homebrew-tap/Formula/stack.rb"), "utf8");
    let expected = template.replaceAll("$VERSION$", version);
    for (const [key, hash] of Object.entries(hashes)) {
      expected = expected.replaceAll(`$SHA_${key}$`, hash);
    }
    expect(actual).toBe(expected);
    expect(actual).not.toMatch(/\$(?:VERSION|SHA_[A-Z0-9_]+)\$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
