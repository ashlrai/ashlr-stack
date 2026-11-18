import { describe, expect, test } from "bun:test";
import type { StackConfig } from "@ashlr/stack-core";
import { type LoadedStatus, buildStatusReport, statusLines } from "../commands/status.ts";
import { reportsEnvelope } from "../lib/doctor-envelope.ts";
import { formatNextStep } from "../lib/next-step.ts";

const config: StackConfig = {
  stack: { version: "1", project_id: "stk_fixture" },
  services: {
    openai: { provider: "openai", secrets: ["OPENAI_API_KEY"], created_at: "2026-11-18" },
  },
  environments: [],
};

describe("one next step from status", () => {
  const ready = { hasStack: true, config, phantomInstalled: true, secretCount: 1 };
  const fixtures: Array<[string, LoadedStatus, string]> = [
    ["configured", ready, "stack doctor"],
    ["no project", { ...ready, hasStack: false, config: undefined }, "stack init"],
    ["no Phantom", { ...ready, phantomInstalled: false }, "brew install ashlrai/phantom/phantom"],
    [
      "slow Phantom",
      { ...ready, phantomInstalled: false, installedError: "timeout" as const },
      "stack status",
    ],
    ["unreadable vault", { ...ready, secretCount: null }, "phantom list --json"],
    ["no services", { ...ready, config: { ...config, services: {} } }, "stack providers"],
  ];
  for (const [name, input, command] of fixtures) {
    test(name, () => {
      const report = buildStatusReport(input);
      expect(report.schema).toBe("ashlr.stack.status/v1");
      expect(report.next_step.command).toBe(command);
      const text = statusLines(input).join("\n");
      expect(text).toContain(formatNextStep(report.next_step));
      expect(text.match(/Next step:/g)).toHaveLength(1);
    });
  }
});

describe("one next step from doctor", () => {
  for (const [serviceStatus, detail, expectedStatus, command] of [
    ["ok", undefined, "ok", null],
    ["error", "missing", "fail", "stack doctor --fix"],
    ["warn", "HTTP 503", "warn", null],
    ["unchecked", "no healthcheck implemented", "warn", null],
    ["unchecked", "OPENAI_API_KEY stored in Phantom", "warn", "phantom validate --check-all"],
  ] as const) {
    test(`${serviceStatus}: ${detail ?? "healthy"}`, () => {
      const native = {
        reports: [
          { project: "fixture", services: [{ name: "openai", status: serviceStatus, detail }] },
        ],
      };
      const report = reportsEnvelope(native, false);
      expect(report.schema_version).toBe(1);
      expect(report.reports).toEqual(native.reports);
      expect(report.status).toBe(expectedStatus);
      expect(report.next_step.command).toBe(command);
      expect(report.next_step.summary).toEqual(
        serviceStatus === "ok" ? "No action needed." : expect.any(String),
      );
    });
  }

  test("safety failures take priority; repairs keep --all", () => {
    const native = {
      reports: [{ project: "fixture", services: [{ name: "openai", status: "error" }] }],
    };
    expect(reportsEnvelope(native, true).next_step.command).toBe("phantom agent doctor");
    expect(reportsEnvelope(native, false, true).next_step.command).toBe("stack doctor --all --fix");
    expect(reportsEnvelope({ reports: [] }, false).next_step.command).toBe("stack providers");
  });
});
