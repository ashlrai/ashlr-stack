import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  __resetPhantomCache,
  addSecret,
  assertProjectInitialized,
  completionForClose,
  countSecrets,
  exec,
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

  test.each(["one\ntwo", "one\rtwo", "one\r\ntwo", "one\n", "one\r"])(
    "addSecret refuses unsupported CR/LF input before spawning (%j)",
    async (value) => {
      await expect(addSecret("NEW_KEY", value)).rejects.toMatchObject({
        code: "PHANTOM_SECRET_VALUE_UNSUPPORTED",
      });
      expect(h.calls()).toEqual([]);
      expect((await readVault(h.dir)).NEW_KEY).toBeUndefined();
    },
  );

  test("the inert producer fixture matches 0.7.9 read_line and CR/LF stripping", async () => {
    await exec(["add", "DIRECT_KEY", "--stdin"], { stdin: "first\r\nsecond" });
    expect((await readVault(h.dir)).DIRECT_KEY).toBe("first");
  });

  test("signal-terminated add fails and never authorizes a later collision", async () => {
    const bin = join(h.dir, "phantom");
    const original = readFileSync(bin, "utf8");
    writeFileSync(
      bin,
      '#!/bin/sh\ncase "$1" in --version) echo fixture;; *) kill -TERM $$;; esac\n',
    );
    await expect(addSecret("NEW_KEY", "same")).rejects.toMatchObject({
      code: "PHANTOM_EXEC_FAILED",
    });
    writeFileSync(h.vaultPath, JSON.stringify({ NEW_KEY: "foreign" }));
    writeFileSync(bin, original);
    await expect(addSecret("NEW_KEY", "same")).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
    expect((await readVault(h.dir)).NEW_KEY).toBe("foreign");
  });

  test("signal-terminated remove reports failure; subsequent collision still refuses", async () => {
    await addSecret("NEW_KEY", "same");
    const bin = join(h.dir, "phantom");
    const original = readFileSync(bin, "utf8");
    writeFileSync(bin, "#!/bin/sh\nkill -TERM $$\n");
    const result = await exec(["remove", "NEW_KEY"], { allowFailure: true });
    expect(result).toMatchObject({ code: 1, signal: "SIGTERM", completion: "signal" });
    expect(await removeSecret("NEW_KEY")).toBe(false);
    writeFileSync(bin, original);
    await expect(addSecret("NEW_KEY", "same")).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
    expect((await readVault(h.dir)).NEW_KEY).toBe("same");
  });

  test("collision wording from a killed repeat never becomes confirmed success", async () => {
    await addSecret("NEW_KEY", "same");
    const bin = join(h.dir, "phantom");
    const original = readFileSync(bin, "utf8");
    writeFileSync(bin, "#!/bin/sh\necho 'already protected' >&2\nkill -TERM $$\n");
    await expect(addSecret("NEW_KEY", "same")).rejects.toMatchObject({
      code: "PHANTOM_EXEC_FAILED",
      message: "Phantom add did not complete; secret storage is unconfirmed.",
    });
    writeFileSync(bin, original);
    await expect(addSecret("NEW_KEY", "same")).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
    expect((await readVault(h.dir)).NEW_KEY).toBe("same");
  });

  test("null close fields remain unknown without a signal; signals never attest completion", () => {
    expect(completionForClose(null, null)).toBe("unknown");
    expect(completionForClose(null, "SIGTERM")).toBe("signal");
    expect(completionForClose(0, "SIGTERM")).toBe("signal");
    expect(completionForClose(0, null)).toBe("exited");
    expect(completionForClose(9, null)).toBe("exited");
  });

  test("initialization preflight consumes only metadata status", async () => {
    await assertProjectInitialized(h.dir);
    expect(h.callsTo("status")).toEqual([{ cmd: "status", args: ["--json"] }]);
    expect(h.callsTo("list")).toEqual([]);
    expect(h.callsTo("init")).toEqual([]);
    expect(h.callsTo("reveal")).toEqual([]);
    expect(h.callsTo("add")).toEqual([]);
  });

  test("failed inventory stays unknown instead of appearing empty", async () => {
    writeFileSync(
      join(h.dir, "phantom"),
      '#!/bin/sh\ncase "$1" in --version) echo fixture;; *) exit 9;; esac\n',
    );
    await expect(listSecrets()).rejects.toMatchObject({ code: "PHANTOM_METADATA_UNAVAILABLE" });
  });

  test("addSecret of an existing name fails with PHANTOM_SECRET_EXISTS", async () => {
    await expect(addSecret("EXISTING_KEY", "other")).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
    expect((await readVault(h.dir)).EXISTING_KEY).toBe("preset-value");
  });

  test("addSecret refuses identical and different completed repeats", async () => {
    await addSecret("NEW_KEY", "same");
    await expect(addSecret("NEW_KEY", "same")).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
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

  test("countSecrets reports the vault size, including when the install probe is skipped", async () => {
    expect(await countSecrets()).toBe(1);
    expect(await countSecrets(undefined, { skipInstallCheck: true })).toBe(1);
  });

  test("exec timeout kills a hung phantom and the install probe reports not installed", async () => {
    writeFileSync(join(h.dir, "phantom"), "#!/bin/sh\nexec sleep 5\n");
    __resetPhantomCache();
    const started = Date.now();
    const result = await exec(["--version"], { allowFailure: true, timeoutMs: 200 });
    expect(result.completion).toBe("signal");
    expect(result.code).not.toBe(0);
    __resetPhantomCache();
    expect(await isPhantomInstalled({ timeoutMs: 200 })).toBe(false);
    __resetPhantomCache();
    expect(await countSecrets(undefined, { skipInstallCheck: true, timeoutMs: 200 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
