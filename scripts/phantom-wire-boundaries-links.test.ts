import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";

const docUrl = new URL("../docs/phantom-wire-example-boundaries.md", import.meta.url);

test("relative file links in the Phantom wire boundaries resolve locally", () => {
  const doc = readFileSync(docUrl, "utf8");
  const links = [...doc.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)]
    .map((match) => match[1])
    .filter((link) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(link));

  expect(links.length).toBeGreaterThan(0);
  const missing = links.filter((link) => {
    try {
      return !statSync(new URL(link, docUrl)).isFile();
    } catch {
      return true;
    }
  });
  expect(missing).toEqual([]);
});
