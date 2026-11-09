import { describe, expect, test } from "bun:test";
import { PROVIDERS } from "../src/lib/providers";

describe("site provider identifiers", () => {
  for (const field of ["name", "slug"] as const) {
    test(`${field} values are nonempty and unique`, () => {
      const seen = new Set<string>();
      const empty: number[] = [];
      const duplicates: string[] = [];

      for (const [index, provider] of PROVIDERS.entries()) {
        const value = provider[field].trim();
        if (!value) empty.push(index);
        if (seen.has(value)) duplicates.push(value);
        seen.add(value);
      }

      expect(empty).toEqual([]);
      expect(duplicates).toEqual([]);
    });
  }
});
