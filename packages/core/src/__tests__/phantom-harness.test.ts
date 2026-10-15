import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetPhantomCache,
  addSecret,
  countSecrets,
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

  test("listSecrets returns exactly the vault keys, never human-format lines", async () => {
    await addSecret("ANOTHER", "v");
    expect(await listSecrets()).toEqual(["EXISTING_KEY", "ANOTHER"]);
    expect(h.callsTo("list").at(-1)?.args).toEqual(["--json"]);
    expect(await countSecrets()).toBe(2);
  });

  test("listSecrets on an empty vault is [] (not the '! No secrets stored.' line)", async () => {
    await removeSecret("EXISTING_KEY");
    expect(await listSecrets()).toEqual([]);
    expect(await countSecrets()).toBe(0);
  });

  test("removeSecret deletes from the fake vault", async () => {
    await removeSecret("EXISTING_KEY");
    const keys = await listSecrets();
    expect(keys).not.toContain("EXISTING_KEY");
  });
});

describe("listSecrets when the vault is unreadable", () => {
  let dir: string;
  let previousPath: string;

  function fake(listBody: string): void {
    writeFileSync(
      join(dir, "phantom"),
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "phantom 0.7.9"; exit 0; fi',
        'if [ "$1" = "list" ]; then',
        listBody,
        "fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(join(dir, "phantom"), 0o755);
    __resetPhantomCache();
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stack-phantom-unreadable-"));
    previousPath = process.env.PATH ?? "";
    process.env.PATH = `${dir}:${previousPath}`;
  });

  afterEach(() => {
    process.env.PATH = previousPath;
    __resetPhantomCache();
    rmSync(dir, { recursive: true, force: true });
  });

  test("non-zero exit (no .phantom.toml) throws instead of returning []", async () => {
    fake("  echo 'Error: No .phantom.toml found. Run phantom init first.' >&2; exit 1");
    await expect(listSecrets()).rejects.toThrow(/No \.phantom\.toml/);
    expect(await countSecrets()).toBeNull();
  });

  test("output that is not a JSON array of named entries throws", async () => {
    fake("  echo '-> 1 secret(s) in vault (keychain):'; exit 0");
    await expect(listSecrets()).rejects.toThrow(/valid JSON/);
    fake("  echo '[{\"detected_service\": null}]'; exit 0");
    await expect(listSecrets()).rejects.toThrow(/string name/);
  });

  test("a hung phantom times out", async () => {
    fake("  sleep 5");
    await expect(listSecrets(undefined, 100)).rejects.toThrow(/timed out/);
  });
});
