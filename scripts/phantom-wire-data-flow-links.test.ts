import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dir, "..");
const docPath = fileURLToPath(new URL("../docs/phantom-wire-data-flow.md", import.meta.url));
const doc = readFileSync(docPath, "utf8");

test("relative links in the Phantom wire data flow resolve to repository files", () => {
  // The document uses inline Markdown links; strip fragments and queries from file paths.
  const targets = [...doc.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)]
    .map((match) => match[1]!)
    .filter((target) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target));
  expect(targets.length).toBeGreaterThan(0);

  for (const target of targets) {
    const path = resolve(dirname(docPath), decodeURIComponent(target.split(/[?#]/, 1)[0]!));
    const fromRoot = relative(root, path);
    expect(fromRoot.startsWith("..") || fromRoot === "", `link outside repository: ${target}`).toBe(false);
    expect(() => statSync(path).isFile(), `broken link: ${target}`).not.toThrow();
    expect(statSync(path).isFile(), `link is not a file: ${target}`).toBe(true);
  }
});
