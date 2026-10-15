import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS_REF } from "../catalog.ts";
import { getProvider, listProviderNames } from "../providers/index.ts";

/**
 * A provider is registered in several places (docs/adding-a-provider.md).
 * These checks catch a provider added to one list and forgotten in another.
 */

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");

function matrixRows(): Array<{ name: string; category: string; authKind: string }> {
  const md = readFileSync(join(repoRoot, "docs", "provider-auth-matrix.md"), "utf8");
  return [...md.matchAll(/^\| ([a-z0-9]+) \| ([a-z]+) \| ([a-z_]+) \|/gm)].map((m) => ({
    name: m[1] as string,
    category: m[2] as string,
    authKind: m[3] as string,
  }));
}

describe("provider registration parity", () => {
  test("the loader registry and the catalog name the same providers", () => {
    const catalog = PROVIDERS_REF.map((p) => p.name).sort();
    expect(listProviderNames()).toEqual(catalog);
  });

  test("docs/provider-auth-matrix.md has one row per provider, matching its module", async () => {
    const rows = matrixRows();
    expect(rows.map((r) => r.name).sort()).toEqual(listProviderNames());
    for (const row of rows) {
      const provider = await getProvider(row.name);
      expect(row).toEqual({
        name: provider.name,
        category: provider.category,
        authKind: provider.authKind,
      });
    }
  });

  test("the matrix header states the current provider count", () => {
    const md = readFileSync(join(repoRoot, "docs", "provider-auth-matrix.md"), "utf8");
    expect(md).toContain(`(${listProviderNames().length} providers)`);
  });
});
