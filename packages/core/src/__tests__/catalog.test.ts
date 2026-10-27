import { expect, test } from "bun:test";
import {
  PROVIDERS_REF,
  PROVIDER_CATEGORIES,
  findProviderRef,
  groupByCategory,
} from "../catalog.ts";

test.each(PROVIDERS_REF)("catalog resolves $name by identity", (provider) => {
  expect(findProviderRef(provider.name)).toBe(provider);
  expect(PROVIDER_CATEGORIES).toContain(provider.category);
});

test.each(["", "OPENAI", " openai", "openai ", "constructor", "__proto__", "missing"])(
  "catalog rejects noncanonical name %s",
  (name) => expect(findProviderRef(name)).toBeUndefined(),
);

test("category groups partition the catalog without sharing mutable buckets", () => {
  const groups = groupByCategory();
  expect(Object.values(groups).flat()).toHaveLength(PROVIDERS_REF.length);
  expect(new Set(PROVIDERS_REF.map((p) => p.name)).size).toBe(PROVIDERS_REF.length);
  for (const [category, providers] of Object.entries(groups)) {
    expect(providers).toEqual(PROVIDERS_REF.filter((p) => p.category === category));
  }
  const first = PROVIDERS_REF[0]!;
  groups[first.category]!.pop();
  expect(groupByCategory()[first.category]).toEqual(
    PROVIDERS_REF.filter((p) => p.category === first.category),
  );
});
