import { expect, test } from "bun:test";
import { compileTarget, commitInstallPath } from "./ci-install-smoke.mjs";
import { firstTestFailure, firstTscDiagnostic } from "./ci-os-test.mjs";

test("compile targets and the documented install path come from the OS", () => {
  expect(compileTarget("linux", "x64")).toBe("bun-linux-x64");
  expect(compileTarget("darwin", "arm64")).toBe("bun-darwin-arm64");
  expect(compileTarget("win32", "x64")).toBe("bun-windows-x64");
  expect(compileTarget("linux", "mips")).toBe("");
  expect(commitInstallPath("linux", "/home/runner")).toBe("/home/runner/.ashlr/bin/stack");
  expect(commitInstallPath("win32", "C:\\Users\\runner")).toMatch(/stack\.exe$/);
});

test("the first failing test and the first typecheck error keep file and line", () => {
  const bun = [
    "fail.test.ts:",
    "3 |   expect(1).toBe(2);",
    "error: expect(received).toBe(expected)",
    "      at <anonymous> (/tmp/work/fail.test.ts:3:13)",
    "(fail) adds [0.40ms]",
  ].join("\n");
  expect(firstTestFailure(bun, "/tmp/work")).toEqual({ file: "fail.test.ts", line: "3", message: "adds" });
  const tsc = "packages/cli/src/index.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.";
  expect(firstTscDiagnostic(tsc)).toEqual({
    file: "packages/cli/src/index.ts",
    line: "10",
    message: "Type 'string' is not assignable to type 'number'.",
  });
});
