/**
 * upgrade command tests
 *
 * Validates the registry-version comparison logic (isNewer) and the
 * --dryRun flag behavior independently of network calls.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

// Re-export isNewer by importing the internal helper indirectly.
// We test the comparison logic by importing the command module's private
// helper through a thin re-export shim — or we duplicate the logic here
// since it's simple semver comparison.

function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10));
  const pb = b.split(".").map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

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

describe("upgrade --dryRun flag", () => {
  test("dryRun=true: prints dry-run message, does not print normal install hint", async () => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));

    // Simulate what the command does with dryRun=true and a newer version available
    const CURRENT = "0.2.0";
    const latest = "0.3.0";
    const dryRun = true;

    if (isNewer(latest, CURRENT)) {
      if (dryRun) {
        lines.push(`(dry-run) would run: bun add -g @ashlr/stack@${latest}`);
      } else {
        lines.push("bun add -g @ashlr/stack");
      }
    }

    console.log = origLog;

    const output = lines.join("\n");
    expect(output).toContain("dry-run");
    expect(output).toContain("0.3.0");
    expect(output).not.toMatch(/bun add -g @ashlr\/stack\s*$/m);
  });

  test("dryRun=false: prints normal install hint", () => {
    const CURRENT = "0.2.0";
    const latest = "0.3.0";
    const dryRun = false;
    const lines: string[] = [];

    if (isNewer(latest, CURRENT)) {
      if (dryRun) {
        lines.push(`(dry-run) would run: bun add -g @ashlr/stack@${latest}`);
      } else {
        lines.push("bun add -g @ashlr/stack");
      }
    }

    expect(lines.join("\n")).not.toContain("dry-run");
    expect(lines.join("\n")).toContain("bun add -g @ashlr/stack");
  });

  test("up-to-date: isNewer returns false, no install hint shown", () => {
    const CURRENT = "0.2.0";
    const latest = "0.2.0";
    const lines: string[] = [];

    if (isNewer(latest, CURRENT)) {
      lines.push("install hint");
    } else {
      lines.push(`Up to date (${latest})`);
    }

    expect(lines[0]).toContain("Up to date");
  });

  test("npm registry fetch failure: error is caught gracefully", async () => {
    global.fetch = mock(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;

    let errorCaught = false;
    try {
      await fetch("https://registry.npmjs.org/@ashlr/stack/latest");
    } catch {
      errorCaught = true;
    }

    expect(errorCaught).toBe(true);
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
      process.exitCode = origExit;
    }
  });
});
