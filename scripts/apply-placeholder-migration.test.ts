import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readVault, setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const docPath = resolve(import.meta.dir, "../docs/apply-placeholder-migration.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

test("migration examples match the changelog and local links resolve", () => {
  const examples = (text: string) =>
    [...text.matchAll(/```text\n([\s\S]*?)\n\s*```/g)].map((match) =>
      match[1]
        .split("\n")
        .map((line) => line.trim())
        .join("\n"),
    );
  expect(examples(doc)).toHaveLength(2);
  for (const sample of examples(doc)) expect(examples(changelog)).toContain(sample);
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/.test(target)) {
      expect(existsSync(resolve(dirname(docPath), target)), match[1]).toBe(true);
    }
  }
  expect(doc).toContain("Those calls failed");
  expect(doc).toContain("enter the real value when prompted");
});

test("documented core result counts provider entries without writing values", async () => {
  const phantom = setupFakePhantom();
  const recipe = {
    id: "migration",
    query: "ai",
    createdAt: "2026-10-17T00:00:00.000Z",
    providers: [{ name: "openai" }, { name: "openai" }],
  };
  try {
    const result = await wirePhantomForRecipe(recipe, { cwd: phantom.dir });
    expect(result).toEqual({
      present: [],
      missing: ["openai:OPENAI_API_KEY", "openai:OPENAI_API_KEY"],
      webhooks: [],
      skipped: [],
    });
    expect(phantom.callsTo("add")).toEqual([]);
    expect(await readVault(phantom.dir)).toEqual({});
    expect(await wirePhantomForRecipe(recipe, { cwd: phantom.dir, noWire: true })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [],
    });
    expect(phantom.callsTo("list")).toHaveLength(1);
    expect(doc).toContain("Repeated providers can produce repeated entries");
    expect(doc).toContain("that result means wiring was disabled");
  } finally {
    phantom.cleanup();
  }
});
