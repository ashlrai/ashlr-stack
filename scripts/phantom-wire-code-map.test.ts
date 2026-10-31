import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const sourceText = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);
const map = readFileSync(new URL("../docs/phantom-wire-code-map.md", import.meta.url), "utf8");

describe("Phantom wire code map", () => {
  it("maps every top-level function exactly once in the active code section", () => {
    const source = ts.createSourceFile("phantom-wire.ts", sourceText, ts.ScriptTarget.Latest, true);
    const functions = source.statements
      .filter(ts.isFunctionDeclaration)
      .map((node) => node.name?.text)
      .filter((name): name is string => name !== undefined)
      .sort();
    const active = map.split("## Active code\n")[1]?.split("## Commented follow-up")[0];
    expect(active).toBeDefined();
    const rows = [...(active ?? "").matchAll(/^\| `([^`]+)` \| ([^\n]+) \|$/gm)];
    const mappedFunctions = rows
      .map((row) => row[1])
      .filter((name) => !["WireResult", "WEBHOOK_PROVIDERS"].includes(name))
      .sort();
    expect(functions.length).toBeGreaterThan(0);
    expect(mappedFunctions).toEqual(functions);
    expect(rows.map((row) => row[1])).toContain("WireResult");
    expect(rows.map((row) => row[1])).toContain("WEBHOOK_PROVIDERS");
  });

  it("identifies the emitted verification TODO as a commented follow-up", () => {
    const todo = "TODO(security): signature verification is NOT implemented here.";
    const followUp = map.split("## Commented follow-up and limitations\n")[1];
    expect(sourceText).toContain(`//   // ${todo}`);
    expect(followUp).toContain(todo);
    expect(followUp).toContain("no verification runs during wiring");
    expect(followUp).toContain("recipe manifests are unsigned");
  });
});
