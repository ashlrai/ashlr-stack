import { describe, expect, test } from "bun:test";
import {
  STACK_MCP_PREREQUISITES,
  formatOptionalStackMcp,
  planStackAddCommands,
} from "../src/lib/stack-builder-output";

const canonical = new Set(["supabase", "sentry", "posthog", "resend", "neon"]);

describe("Stack Builder copyable output", () => {
  test("uses the exact supported optional Stack control-plane bootstrap", () => {
    const text = formatOptionalStackMcp(true);
    expect(JSON.parse(text)).toEqual({
      mcpServers: { "ashlr-stack": { command: "ashlr-stack-mcp" } },
    });
    expect(text).not.toContain("phantom://");
    expect(text).not.toContain("mcp run");
    expect(text).not.toContain('"env"');
    expect(STACK_MCP_PREREQUISITES).toContain("`stack`");
    expect(STACK_MCP_PREREQUISITES).toContain("`ashlr-stack-mcp`");
    expect(STACK_MCP_PREREQUISITES).toContain("runtime required by the versions you installed");
  });

  test("detail and recipe requests receive identical Stack bootstrap bytes", () => {
    const detail = formatOptionalStackMcp(true);
    const recipe = formatOptionalStackMcp(["supabase", "sentry"].length > 0);
    expect(recipe).toBe(detail);
    expect((recipe.match(/"ashlr-stack"/g) ?? []).length).toBe(1);
  });

  test("planning is pure and returned lists are detached from later calls", () => {
    const selected = ["supabase", "unknownstub"];
    const supported = new Set(canonical);
    const first = planStackAddCommands(selected, supported);
    expect(selected).toEqual(["supabase", "unknownstub"]);
    expect(supported).toEqual(canonical);
    first.unsupported.push("changed-after-return");
    selected.push("sentry");
    expect(planStackAddCommands(selected, supported)).toEqual({
      commands: "stack add supabase && stack add sentry",
      unsupported: ["unknownstub"],
    });
    expect(supported).toEqual(canonical);
  });

  test("mixed provider choices never fabricate provider MCP transports", () => {
    const text = formatOptionalStackMcp(true);
    const config = JSON.parse(text);
    expect(Object.keys(config.mcpServers)).toEqual(["ashlr-stack"]);
    expect(text).not.toContain("supabase");
    expect(text).not.toContain("sentry");
    expect(text).not.toContain("posthog");
  });

  test("empty and no-MCP selections omit optional bootstrap", () => {
    expect(formatOptionalStackMcp(false)).toBe("");
    expect(planStackAddCommands([], canonical)).toEqual({ commands: "", unsupported: [] });
  });

  test("preview catalog metadata cannot turn into claimed provider config", () => {
    const text = formatOptionalStackMcp(true);
    expect(JSON.parse(text)).toEqual({
      mcpServers: { "ashlr-stack": { command: "ashlr-stack-mcp" } },
    });
    expect(text).not.toContain("neon");
  });

  test("one and several selected providers yield one supported add per service", () => {
    expect(planStackAddCommands(["supabase"], canonical).commands).toBe("stack add supabase");
    const two = planStackAddCommands(["supabase", "sentry"], canonical).commands;
    expect(two).toBe("stack add supabase && stack add sentry");
    expect(two).not.toBe("stack add supabase sentry");
  });

  test("unknown catalog stubs never become copyable commands", () => {
    expect(planStackAddCommands(["unknownstub"], canonical)).toEqual({
      commands: "",
      unsupported: ["unknownstub"],
    });
    expect(planStackAddCommands(["supabase", "unknownstub"], canonical)).toEqual({
      commands: "stack add supabase",
      unsupported: ["unknownstub"],
    });
  });

  test("invalid shell names and duplicate selections cannot add extra operations", () => {
    const names = new Set([...canonical, "supabase; echo unsafe"]);
    expect(planStackAddCommands(["supabase", "supabase", "supabase; echo unsafe"], names)).toEqual({
      commands: "stack add supabase",
      unsupported: ["supabase; echo unsafe"],
    });
  });
});
