import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptsCwd, planToolCall, resolveToolCwd } from "../src/cwd.ts";
import { TOOLS, type ToolDef, validateToolInput } from "../src/tools.ts";

let root: string;
let project: string;
let outside: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "mcp-validation-")));
  project = join(root, "project");
  outside = join(root, "project-other");
  mkdirSync(project);
  mkdirSync(outside);
  mkdirSync(join(project, "nested"));
  writeFileSync(join(project, "file"), "fixture");
  symlinkSync(outside, join(project, "escape"));
  symlinkSync(join(project, "nested"), join(project, "internal"));
  symlinkSync(outside, join(project, ".stack"));
  symlinkSync(join(outside, "missing.env"), join(project, ".env"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function validInput(tool: ToolDef): Record<string, unknown> {
  return Object.fromEntries((tool.inputSchema.required ?? []).map((key) => [key, "example"]));
}

for (const tool of TOOLS) {
  describe(tool.name, () => {
    test("accepts its minimal input and never forwards cwd to argv", () => {
      const input = validInput(tool);
      // Import's default file is deliberately an escaping symlink in this fixture.
      if (tool.name === "stack_import") input.from = "file";
      const cwd = tool.name === "stack_apply" ? outside : project;
      const plan = planToolCall(tool, { ...input, ...(acceptsCwd(tool) ? { cwd } : {}) });
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(plan.args).not.toContain(project);
    });

    test("rejects invalid cwd with a tool-specific actionable error", () => {
      for (const cwd of ["relative", "", 42, {}, [], true, join(root, "missing"), join(project, "file")]) {
        const plan = planToolCall(tool, { ...validInput(tool), cwd });
        expect(plan.ok).toBe(false);
        if (!plan.ok) {
          expect(plan.error).toStartWith(`${tool.name}: `);
          expect(plan.error).toContain("cwd");
          expect(plan.error).toMatch(/absolute path|string|not supported|does not exist|not a directory/);
        }
      }
    });

    test("omitted cwd retains the server default", () => {
      expect(resolveToolCwd(tool, {})).toEqual({ cwd: undefined });
    });

    test("unknown arguments explain the accepted usage", () => {
      const error = validateToolInput(tool, { ...validInput(tool), typo: true });
      expect(error).toStartWith(`${tool.name}: unknown argument "typo".`);
      expect(error).toContain(Object.keys(tool.inputSchema.properties).length ? "Accepted:" : "takes no arguments");
    });

    for (const [key, spec] of Object.entries(tool.inputSchema.properties)) {
      test(`${key} rejects wrong types`, () => {
        const value = spec.type === "string" ? 42 : "wrong";
        expect(validateToolInput(tool, { ...validInput(tool), [key]: value })).toBe(
          `${tool.name}: argument "${key}" must be a ${spec.type}.`,
        );
      });
    }

    for (const key of tool.inputSchema.required ?? []) {
      test(`${key} explains missing required input`, () => {
        for (const value of [undefined, null, "", "   "]) {
          expect(validateToolInput(tool, { ...validInput(tool), [key]: value })).toBe(
            `${tool.name}: missing required argument "${key}".`,
          );
        }
      });
    }
  });
}

for (const [name, key] of [["stack_scan", "path"], ["stack_import", "from"]] as const) {
  const tool = TOOLS.find((tool) => tool.name === name) as ToolDef;
  describe(`${name} project containment`, () => {
    test.each(["../project-other", "nested/../../project-other", "escape", "escape/missing/file", "escape/../escape/file"])("refuses %s", (path) => {
      expect(planToolCall(tool, { cwd: project, [key]: path })).toEqual({
        ok: false,
        error: expect.stringContaining(`argument "${key}" must stay inside the project directory`),
      });
    });
    test("refuses an absolute sibling path", () => {
      expect(planToolCall(tool, { cwd: project, [key]: outside }).ok).toBe(false);
    });
    test.each([".", "nested", "internal", "nested/missing/file", "file"])("allows internal %s", (path) => {
      expect(planToolCall(tool, { cwd: project, [key]: path }).ok).toBe(true);
    });
    test("refuses NUL bytes with guidance", () => {
      expect(planToolCall(tool, { cwd: project, [key]: "bad\0path" })).toEqual({
        ok: false,
        error: expect.stringContaining("use a valid path inside the project directory"),
      });
    });
  });
}

test("import validates its default .env path", () => {
  const tool = TOOLS.find((tool) => tool.name === "stack_import") as ToolDef;
  expect(planToolCall(tool, { cwd: project }).ok).toBe(false);
});

test("apply rejects recipe traversal and escaping recipe storage", () => {
  const tool = TOOLS.find((tool) => tool.name === "stack_apply") as ToolDef;
  for (const recipe_id of ["../outside", "/tmp/recipe", "nested/recipe", "bad\0id"]) {
    expect(planToolCall(tool, { cwd: project, recipe_id })).toEqual({
      ok: false,
      error: expect.stringContaining('argument "recipe_id" must be a filename stem'),
    });
  }
  expect(planToolCall(tool, { cwd: project, recipe_id: "example" }).ok).toBe(false);
  expect(planToolCall(tool, { cwd: outside, recipe_id: "example" }).ok).toBe(true);
});
