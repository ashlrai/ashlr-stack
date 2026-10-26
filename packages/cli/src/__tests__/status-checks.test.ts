import { describe, expect, test } from "bun:test";
import type { StackConfig } from "@ashlr/stack-core";
import { buildStatusReport, loadStatus, statusLines } from "../commands/status.ts";
import { type StatusCheck, runStatusChecks } from "../lib/status-checks.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fastOpts = { timeoutMs: 500, concurrency: 3 };

const config: StackConfig = {
  stack: { version: "1", project_id: "stk_test0001" },
  services: {
    supabase: {
      provider: "supabase",
      secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
      resource_id: "abcd1234",
      region: "us-east-1",
      created_at: "2026-01-01T00:00:00.000Z",
      mcp: "supabase",
    },
    openai: {
      provider: "openai",
      secrets: ["OPENAI_API_KEY"],
      created_at: "2026-01-01T00:00:00.000Z",
    },
  },
  environments: [{ name: "dev", default: true }],
};

describe("runStatusChecks", () => {
  test("results stay in input order when checks finish out of order", async () => {
    const finished: string[] = [];
    const checks: Array<StatusCheck<string>> = [
      {
        name: "config",
        run: async () => {
          await delay(40);
          finished.push("config");
          return "config-value";
        },
      },
      {
        name: "phantom",
        run: async () => {
          await delay(10);
          finished.push("phantom");
          return "phantom-value";
        },
      },
      {
        name: "secrets",
        run: async () => {
          await delay(20);
          finished.push("secrets");
          return "secrets-value";
        },
      },
    ];
    const results = await runStatusChecks(checks, fastOpts);
    expect(finished).toEqual(["phantom", "secrets", "config"]);
    expect(results.map((result) => result.name)).toEqual(["config", "phantom", "secrets"]);
    expect(results.map((result) => (result.state === "ok" ? result.value : result.state))).toEqual([
      "config-value",
      "phantom-value",
      "secrets-value",
    ]);
  });

  test("a failing check is reported and the others still finish", async () => {
    const err = new Error("vault down");
    const results = await runStatusChecks(
      [
        { name: "config", run: async () => "cfg" },
        {
          name: "phantom",
          run: async () => {
            throw err;
          },
        },
        { name: "secrets", run: async () => 2 },
      ],
      fastOpts,
    );
    expect(results.map((result) => result.name)).toEqual(["config", "phantom", "secrets"]);
    expect(results[0]).toEqual({ name: "config", state: "ok", value: "cfg" });
    expect(results[1]).toEqual({ name: "phantom", state: "error", error: err });
    expect(results[2]).toEqual({ name: "secrets", state: "ok", value: 2 });
  });

  test("a hanging check times out and does not drop the other results", async () => {
    const started = Date.now();
    const results = await runStatusChecks(
      [
        { name: "config", run: async () => "ok" },
        { name: "phantom", run: () => new Promise(() => {}) },
        { name: "secrets", run: async () => 3 },
      ],
      { timeoutMs: 40, concurrency: 3 },
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(results.map((result) => result.name)).toEqual(["config", "phantom", "secrets"]);
    expect(results[0]).toMatchObject({ state: "ok", value: "ok" });
    expect(results[1]?.state).toBe("timeout");
    if (results[1]?.state === "timeout") {
      expect(results[1].error.checkName).toBe("phantom");
      expect(results[1].error.timeoutMs).toBe(40);
    }
    expect(results[2]).toMatchObject({ state: "ok", value: 3 });
  });

  test("at most `concurrency` checks run at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const checks: Array<StatusCheck<number>> = Array.from({ length: 6 }, (_, index) => ({
      name: `check-${index}`,
      run: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(30);
        inFlight -= 1;
        return index;
      },
    }));
    const results = await runStatusChecks(checks, { timeoutMs: 500, concurrency: 2 });
    expect(maxInFlight).toBe(2);
    expect(results.map((result) => (result.state === "ok" ? result.value : result.state))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
});

describe("loadStatus failure reporting", () => {
  test("rendered lines stay in a fixed order when checks finish out of order", async () => {
    const loaded = await loadStatus(
      {
        hasConfig: () => true,
        readConfig: async () => {
          await delay(30);
          return config;
        },
        isPhantomInstalled: async () => {
          await delay(5);
          return true;
        },
        countSecrets: async () => {
          await delay(15);
          return 2;
        },
      },
      fastOpts,
    );
    const text = statusLines(loaded).join("\n");
    const toml = text.indexOf(".stack.toml");
    const phantom = text.indexOf("phantom");
    const services = text.indexOf("services");
    const supabase = text.indexOf("supabase");
    const openai = text.indexOf("openai");
    expect(toml).toBeGreaterThan(-1);
    expect(toml).toBeLessThan(phantom);
    expect(phantom).toBeLessThan(services);
    expect(services).toBeLessThan(supabase);
    expect(supabase).toBeLessThan(openai);
    expect(text).toContain("stk_test0001");
    expect(text).toContain("2 secrets in vault");
    expect(text).toContain("2 configured");
    expect(text).toContain("abcd1234");
  });

  test("a failing phantom check is reported as not installed", async () => {
    const loaded = await loadStatus(
      {
        hasConfig: () => false,
        readConfig: async () => {
          throw new Error("should not read");
        },
        isPhantomInstalled: async () => {
          throw new Error("enoent");
        },
        countSecrets: async () => 5,
      },
      fastOpts,
    );
    expect(loaded.phantomInstalled).toBe(false);
    expect(loaded.secretCount).toBeNull();
    expect(statusLines(loaded).join("\n")).toContain("not installed");
    expect(
      buildStatusReport({
        config: loaded.config,
        phantomInstalled: loaded.phantomInstalled,
        secretCount: loaded.secretCount,
      }).phantom,
    ).toEqual({ installed: false, secret_count: null });
  });

  test("a failing secrets check is reported as an unreadable vault", async () => {
    const loaded = await loadStatus(
      {
        hasConfig: () => true,
        readConfig: async () => config,
        isPhantomInstalled: async () => true,
        countSecrets: async () => {
          throw new Error("vault down");
        },
      },
      fastOpts,
    );
    expect(loaded.phantomInstalled).toBe(true);
    expect(loaded.secretCount).toBeNull();
    expect(statusLines(loaded).join("\n")).toContain("0 secrets in vault");
    expect(
      buildStatusReport({
        config: loaded.config,
        phantomInstalled: loaded.phantomInstalled,
        secretCount: loaded.secretCount,
      }).phantom,
    ).toEqual({ installed: true, secret_count: null });
  });

  test("a failing config check still throws the original error", async () => {
    const err = new Error("invalid toml");
    await expect(
      loadStatus(
        {
          hasConfig: () => true,
          readConfig: async () => {
            throw err;
          },
          isPhantomInstalled: async () => true,
          countSecrets: async () => 1,
        },
        fastOpts,
      ),
    ).rejects.toBe(err);
  });

  test("a hanging phantom check times out and is reported as not installed", async () => {
    const started = Date.now();
    const loaded = await loadStatus(
      {
        hasConfig: () => true,
        readConfig: async () => config,
        isPhantomInstalled: () => new Promise(() => {}),
        countSecrets: async () => 4,
      },
      { timeoutMs: 40, concurrency: 3 },
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(loaded.config?.stack.project_id).toBe("stk_test0001");
    expect(loaded.phantomInstalled).toBe(false);
    expect(loaded.secretCount).toBeNull();
    expect(statusLines(loaded).join("\n")).toContain("not installed");
  });
});
