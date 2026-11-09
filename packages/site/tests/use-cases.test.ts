import { describe, expect, test } from "bun:test";
import { USE_CASES, type UseCase } from "../src/lib/use-cases";

function assertUniqueIdentifiers(useCases: UseCase[]) {
  const slugs = new Set<string>();
  for (const useCase of useCases) {
    expect(slugs.has(useCase.slug), `Duplicate use-case slug: ${useCase.slug}`).toBe(false);
    slugs.add(useCase.slug);

    const claimIds = new Set<string>();
    for (const claim of useCase.claims) {
      expect(claimIds.has(claim.id), `Duplicate claim ID "${claim.id}" in use case "${useCase.slug}"`).toBe(false);
      claimIds.add(claim.id);
    }
  }
}

describe("use-case identifiers", () => {
  test("are unique in their page or anchor scope", () => {
    assertUniqueIdentifiers(USE_CASES);
  });

  test("reports duplicate slugs and claim IDs with their context", () => {
    const guide = USE_CASES[0];
    expect(() => assertUniqueIdentifiers([guide, guide])).toThrow(`Duplicate use-case slug: ${guide.slug}`);
    expect(() =>
      assertUniqueIdentifiers([{ ...guide, claims: [guide.claims[0], guide.claims[0]] }]),
    ).toThrow(`Duplicate claim ID "${guide.claims[0].id}" in use case "${guide.slug}"`);
  });
});
