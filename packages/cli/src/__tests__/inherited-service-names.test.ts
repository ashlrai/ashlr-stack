import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyConfig, getService } from "@ashlr/stack-core";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const created: string[] = [];
afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

function project(): string {
  const d = mkdtempSync(join(tmpdir(), "stack-inherited-"));
  created.push(d);
  writeFileSync(join(d, ".stack.toml"), '[stack]\nversion = "1"\n');
  return d;
}

function stack(args: string[], cwd: string) {
  const r = spawnSync("bun", [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: cwd, NO_COLOR: "1", STACK_NO_TELEMETRY: "1" },
  });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("names of Object.prototype members are not configured services", () => {
  test("getService ignores inherited members", () => {
    const config = emptyConfig();
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(getService(config, name)).toBeUndefined();
    }
  });

  // Before the fix these crashed ("entry.secrets.length", "secret of secrets")
  // or printed "undefined has no dashboard URL" instead of "not in this stack".
  test.each([
    [["remove", "constructor"]],
    [["remove", "constructor", "--json"]],
    [["open", "toString"]],
    [["info", "constructor"]],
    [["info", "constructor", "--json"]],
  ])("stack %p says the service is not in this stack", (args) => {
    const r = stack(args, project());
    expect(r.out).toContain("is not in this stack");
    expect(r.out).not.toContain("undefined");
  });
});
