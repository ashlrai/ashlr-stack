/**
 * upgrade command tests
 *
 * Exercises version comparison and command behavior with a mocked registry.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

import { isNewer, runUpgrade } from "../commands/upgrade.ts";

afterEach(() => {
  mock.restore();
});

describe("isNewer (upgrade registry comparison)", () => {
  test("remote patch bump → true", () => expect(isNewer("0.2.1", "0.2.0")).toBe(true));
  test("remote minor bump → true", () => expect(isNewer("0.3.0", "0.2.0")).toBe(true));
  test("remote major bump → true", () => expect(isNewer("1.0.0", "0.2.0")).toBe(true));
  test("same version → false", () => expect(isNewer("0.2.0", "0.2.0")).toBe(false));
  test("local ahead of remote → false", () => expect(isNewer("0.1.9", "0.2.0")).toBe(false));
  test("multi-digit segments compared numerically", () =>
    expect(isNewer("0.10.0", "0.9.0")).toBe(true));
});

describe("upgrade command execution", () => {
  async function exercise(
    options: { apply?: boolean; dryRun?: boolean },
    version = "9.9.9",
    failure = false,
  ) {
    const origFetch = globalThis.fetch;
    const origWrite = process.stdout.write;
    const origExit = process.exitCode;
    let output = "";
    const install = mock(async (current: string, latest: string) => {
      if (failure) throw new Error("Upgrade failed; previous version restored.");
      return { status: "upgraded" as const, current, latest };
    });
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ version })),
    ) as unknown as typeof fetch;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await runUpgrade({ ...options, json: true }, "0.2.0", install);
      return { body: JSON.parse(output), calls: install.mock.calls.length, exit: process.exitCode };
    } finally {
      globalThis.fetch = origFetch;
      process.stdout.write = origWrite;
      process.exitCode = origExit ?? 0;
    }
  }

  test("dry-run overrides apply and never installs", async () => {
    const result = await exercise({ apply: true, dryRun: true });
    expect(result.calls).toBe(0);
    expect(result.body.status).toBe("update_available");
  });
  test("default mode only prints an install hint", async () => {
    const result = await exercise({});
    expect(result.calls).toBe(0);
    expect(result.body.install).toContain("@9.9.9");
  });
  test("apply installs and reports success", async () => {
    const result = await exercise({ apply: true });
    expect(result.calls).toBe(1);
    expect(result.body.status).toBe("upgraded");
  });
  test("up-to-date and ahead installs are untouched", async () => {
    for (const version of ["0.2.0", "0.1.0"]) {
      expect((await exercise({ apply: true }, version)).calls).toBe(0);
    }
  });
  test("invalid registry version is rejected before mutation", async () => {
    const result = await exercise({ apply: true }, "../../malicious");
    expect(result.calls).toBe(0);
    expect(result.exit).toBe(1);
  });
  test("rollback is reported as failure rather than successful upgrade", async () => {
    const result = await exercise({ apply: true }, "9.9.9", true);
    expect(result.exit).toBe(1);
    expect(result.body.error).toContain("restored");
  });
});

describe("stack upgrade --json", () => {
  test("buildUpgradeReport names the status and the install command", async () => {
    const { buildUpgradeReport } = await import("../commands/upgrade.ts");
    expect(buildUpgradeReport("0.2.0", "0.3.0")).toEqual({
      schema: "ashlr.stack.upgrade/v1",
      package: "@ashlr/stack",
      current: "0.2.0",
      latest: "0.3.0",
      status: "update_available",
      install: "bun add -g @ashlr/stack@0.3.0",
    });
    expect(buildUpgradeReport("0.3.0", "0.3.0").status).toBe("up_to_date");
    expect(buildUpgradeReport("0.3.0", "0.3.0").install).toBeNull();
    expect(buildUpgradeReport("0.4.0", "0.3.0").status).toBe("ahead");
  });

  async function capture(run: () => Promise<void>): Promise<string> {
    let out = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await run();
    } finally {
      process.stdout.write = orig;
    }
    return out;
  }

  test("prints one JSON report from the registry answer", async () => {
    const { runUpgradeJson } = await import("../commands/upgrade.ts");
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: "9.9.9" }))) as unknown as typeof fetch;
    try {
      const report = JSON.parse(await capture(() => runUpgradeJson("0.2.0")));
      expect(report.status).toBe("update_available");
      expect(report.latest).toBe("9.9.9");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("an unreachable registry fails without throwing out of the command", async () => {
    const origFetch = globalThis.fetch;
    const origExit = process.exitCode;
    globalThis.fetch = mock(async () => {
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;
    try {
      const body = JSON.parse(await capture(() => runUpgrade({ json: true }, "0.2.0")));
      expect(body.error).toBe("network unavailable");
      expect(process.exitCode).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
      process.exitCode = origExit ?? 0;
    }
  });

  test("a registry failure is a JSON error with exit 1", async () => {
    const { runUpgradeJson } = await import("../commands/upgrade.ts");
    const origFetch = globalThis.fetch;
    const origExit = process.exitCode;
    globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    try {
      const body = JSON.parse(await capture(() => runUpgradeJson("0.2.0")));
      expect(body).toEqual({ error: "npm registry returned 503.", current: "0.2.0" });
      expect(process.exitCode).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
      process.exitCode = origExit ?? 0;
    }
  });
});
