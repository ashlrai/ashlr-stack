import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

setDefaultTimeout(30_000);

const recipe: Recipe = {
  id: "vault-case",
  query: "q",
  createdAt: "2026-04-18T00:00:00.000Z",
  providers: [{ name: "github" }],
};

describe("ai/phantom-wire vault secret name case", () => {
  let harness: Harness | undefined;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wire-vault-case-"));
  });
  afterEach(() => {
    harness?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it("treats the exact-case vault name as present", async () => {
    harness = setupFakePhantom({ GITHUB_TOKEN: "x" });
    const result = await wirePhantomForRecipe(recipe, { cwd: dir });
    expect(result.present).toEqual(["github:GITHUB_TOKEN"]);
    expect(result.missing).toEqual([]);
  });

  it.each(["github_token", "Github_Token"])(
    "treats the differently cased vault name %s as missing",
    async (stored) => {
      harness = setupFakePhantom({ [stored]: "x" });
      const result = await wirePhantomForRecipe(recipe, { cwd: dir });
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual(["github:GITHUB_TOKEN"]);
    },
  );
});
