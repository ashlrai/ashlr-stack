import { expect, test } from "bun:test";
import { osGate } from "./ci-os-gate.mjs";

const job = (result: string) => ({ result, outputs: {} });

test("a path-gate skip passes and a failure or cancellation does not", () => {
  expect(osGate({
    classify: { result: "success", outputs: { run_os: "false" } },
    "os-windows": job("skipped"),
    "install-smoke-windows": job("skipped"),
  }).ok).toBe(true);
  expect(osGate({
    classify: { result: "success", outputs: { run_os: "false" } },
    "os-windows": job("failure"),
    "install-smoke-windows": job("skipped"),
  }).ok).toBe(false);
  expect(osGate({
    classify: { result: "success", outputs: { run_os: "true" } },
    "os-windows": job("cancelled"),
    "install-smoke-windows": job("success"),
  }).ok).toBe(false);
});

test("linux has no path gate, so a skip fails closed", () => {
  expect(osGate({ fast: job("success"), "install-smoke-linux": job("success") }).ok).toBe(true);
  expect(osGate({ fast: job("success"), "install-smoke-linux": job("skipped") }).ok).toBe(false);
});

test("a failed classify fails the gate", () => {
  expect(osGate({
    classify: { result: "failure", outputs: {} },
    "os-macos": job("skipped"),
  }).ok).toBe(false);
});
