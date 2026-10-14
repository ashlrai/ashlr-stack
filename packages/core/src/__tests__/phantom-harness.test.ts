import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  addSecret,
  isPhantomInstalled,
  listSecrets,
  removeSecret,
  revealSecret,
} from "../phantom.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

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

  test("addSecret writes to the fake vault over stdin, never argv", async () => {
    await addSecret("NEW_KEY", "new-value");
    expect((await readVault(h.dir)).NEW_KEY).toBe("new-value");
    expect(h.callsTo("add")).toEqual([{ cmd: "add", args: ["NEW_KEY", "--stdin"] }]);
  });

  test("addSecret of an existing name fails with PHANTOM_SECRET_EXISTS", async () => {
    await expect(addSecret("EXISTING_KEY", "other")).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
    expect((await readVault(h.dir)).EXISTING_KEY).toBe("preset-value");
  });

  test("addSecret repeating this process's identical write is a no-op", async () => {
    await addSecret("NEW_KEY", "same");
    await addSecret("NEW_KEY", "same");
    await expect(addSecret("NEW_KEY", "different")).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
  });

  test("revealSecret fails closed without a terminal", async () => {
    await expect(revealSecret("EXISTING_KEY")).rejects.toMatchObject({
      code: "PHANTOM_TRUSTED_TERMINAL_REQUIRED",
    });
  });

  test("listSecrets returns vault keys", async () => {
    await addSecret("ANOTHER", "v");
    const keys = await listSecrets();
    expect(keys).toContain("EXISTING_KEY");
    expect(keys).toContain("ANOTHER");
  });

  test("removeSecret without a terminal reports false and keeps the secret", async () => {
    expect(await removeSecret("EXISTING_KEY")).toBe(false);
    expect(await listSecrets()).toContain("EXISTING_KEY");
  });
});
