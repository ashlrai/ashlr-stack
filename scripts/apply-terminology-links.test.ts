import { describe, expect, test } from "bun:test";
import { statSync, readFileSync } from "node:fs";

const guideUrl = new URL("../docs/apply-wiring-terminology.md", import.meta.url);

// Include inline links and reference definitions; fragments and queries do not
// form part of the local filename. External URLs and fragment-only links are not files.
function relativeFileLinks(markdown: string): string[] {
  const destinations = [
    ...markdown.matchAll(/!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g),
    ...markdown.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
  ];
  return destinations
    .map((match) => match[1])
    .filter((target) => !/^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(target))
    .map((target) => target.split(/[?#]/, 1)[0]);
}

describe("apply wiring terminology links", () => {
  test("extracts local file destinations without fragments or queries", () => {
    expect(relativeFileLinks("[local](../file.md#section) [web](https://example.com) [section](#part)\n[ref]: other.md?raw=1")).toEqual([
      "../file.md",
      "other.md",
    ]);
  });

  test("every relative file link resolves to a file", () => {
    const links = relativeFileLinks(readFileSync(guideUrl, "utf8"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const url = new URL(link, guideUrl);
      expect(statSync(url, { throwIfNoEntry: false })?.isFile(), `Broken relative file link: ${link}`).toBe(true);
    }
  });
});
