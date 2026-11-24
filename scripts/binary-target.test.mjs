import { expect, test } from "bun:test";
import {
  binaryTarget,
  missingBinaryMessage,
  selectLaunch,
} from "../packages/cli/bin/binary-target.mjs";

test("Windows x64 and arm64 map to .exe names", () => {
  expect(binaryTarget("win32", "x64")).toEqual({
    file: "stack-windows-x64.exe",
    bunTarget: "bun-windows-x64",
  });
  expect(binaryTarget("win32", "arm64")).toEqual({
    file: "stack-windows-arm64.exe",
    bunTarget: "bun-windows-arm64",
  });
});

test("an unknown platform fails and names what is supported", () => {
  const message = missingBinaryMessage("freebsd", "x64");
  expect(message).toContain("No stack binary for freebsd x64");
  expect(message).toContain("stack-windows-x64.exe");
  expect(
    selectLaunch({ platform: "freebsd", arch: "x64", nativeExists: false, jsExists: true }),
  ).toEqual({ kind: "error", message });
});

test("a known platform without the native file uses the JavaScript build", () => {
  expect(
    selectLaunch({ platform: "win32", arch: "x64", nativeExists: false, jsExists: true }),
  ).toEqual({ kind: "javascript", file: "dist/index.js" });
});

test("a known platform with neither file names the expected Windows exe", () => {
  const result = selectLaunch({
    platform: "win32",
    arch: "x64",
    nativeExists: false,
    jsExists: false,
  });
  expect(result.kind).toBe("error");
  expect(result.message).toContain("stack-windows-x64.exe");
});

test("a present native file is preferred over the JavaScript build", () => {
  expect(
    selectLaunch({ platform: "win32", arch: "arm64", nativeExists: true, jsExists: true }),
  ).toEqual({ kind: "native", file: "stack-windows-arm64.exe" });
});
