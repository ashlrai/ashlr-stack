import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  addSecret,
  isPhantomInstalled,
  listSecrets,
  removeSecret,
  revealSecret,
} from "../phantom.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("phantom wrapper against the fake harness", () => {
  let h: Harness;

  beforeEach(() => {
    h = setupFakePhantom({ EXISTING_KEY: "preset-value" });
  });

  afterEach(() => {
    h.cleanup();
  });

  test("isPhantomInstalled resolves true when the fake binary is on PATH", async () => {
    expect(await isPhantomInstalled()).toBe(true);
  });

  test("addSecret writes to the fake vault", async () => {
    await addSecret("NEW_KEY", "new-value");
    expect(await revealSecret("NEW_KEY")).toBe("new-value");
    expect(h.callsTo("add").length).toBe(1);
  });

  test("listSecrets returns vault keys", async () => {
    await addSecret("ANOTHER", "v");
    const keys = await listSecrets();
    expect(keys).toContain("EXISTING_KEY");
    expect(keys).toContain("ANOTHER");
  });

  test("removeSecret deletes from the fake vault", async () => {
    await removeSecret("EXISTING_KEY");
    const keys = await listSecrets();
    expect(keys).not.toContain("EXISTING_KEY");
  });
});
