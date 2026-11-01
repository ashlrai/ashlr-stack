import { afterEach, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import type { Recipe } from "../ai/recipe.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

setDefaultTimeout(30_000);

const doc = readFileSync(
  new URL("../../../../docs/apply-terminology-examples.md", import.meta.url),
  "utf-8",
);
const examples = [...doc.matchAll(/```json\n([^\n]+)\n```/g)].map((match) => JSON.parse(match[1]));
const recipe: Recipe = {
  id: "example",
  query: "example",
  createdAt: "2026-04-18T00:00:00.000Z",
  providers: [{ name: "openai" }],
};

let harness: Harness;
beforeEach(() => {
  harness = setupFakePhantom({ OPENAI_API_KEY: "test-value" });
});
afterEach(() => harness.cleanup());

it("documents the readable inventory examples without writing placeholders", async () => {
  expect(examples).toHaveLength(3);
  expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual(examples[0]);
  writeFileSync(harness.vaultPath, "{}");
  expect(await wirePhantomForRecipe(recipe, { cwd: harness.dir })).toEqual(examples[1]);
  expect(harness.callsTo("add")).toEqual([]);
});

it("documents an unreadable inventory alongside the generated Stripe stub", async () => {
  writeFileSync(harness.vaultPath, "not json");
  const result = await wirePhantomForRecipe(
    { ...recipe, providers: [{ name: "stripe" }] },
    { cwd: harness.dir },
  );
  expect({
    ...result,
    webhooks: result.webhooks.map((path) => path.replace(harness.dir, "<project>")),
  }).toEqual(examples[2]);
  expect(harness.callsTo("add")).toEqual([]);
});
