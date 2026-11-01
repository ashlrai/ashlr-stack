import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("fast check detects package changes and reports type errors", () => {
  const temp = mkdtempSync(join(tmpdir(), "stack-fast-check-"));
  try {
    // A minimal real workspace keeps this integration test fast and isolated.
    mkdirSync(join(temp, "scripts"));
    mkdirSync(join(temp, "packages", "sample"), { recursive: true });
    cpSync(join(root, "scripts", "fast-check.sh"), join(temp, "scripts", "fast-check.sh"));
    symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
    writeFileSync(join(temp, "packages/sample/package.json"), '{"name":"sample"}\n');
    writeFileSync(join(temp, "packages/sample/tsconfig.json"), '{"compilerOptions":{"strict":true,"skipLibCheck":true,"noEmit":true},"include":["*.ts"]}\n');
    const source = join(temp, "packages/sample/index.ts");
    writeFileSync(source, 'const value: string = "ok";\n');
    const git = (...args) => execFileSync("git", args, { cwd: temp, stdio: "pipe" });
    git("init", "-q");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    const check = () => spawnSync("bash", ["scripts/fast-check.sh"], { cwd: temp, encoding: "utf8" });

    const clean = check();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /PASS no changed packages/);
    assert.match(clean.stdout, /Total: \d+s/);

    writeFileSync(source, "const value: string = 123;\n");
    const broken = check();
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stdout, /FAIL sample typecheck/);
    assert.match(broken.stdout, /PASS sample test/);
    assert.match(broken.stdout, /Total: \d+s/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
