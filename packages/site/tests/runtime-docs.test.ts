import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const version = JSON.parse(read("packages/cli/package.json")).version as string;

describe("Stack release and credential guidance", () => {
  for (const path of ["README.md", "docs/phantom-locus.md"]) {
    test(`${path} tracks the checkout without shell secret extraction`, () => {
      const doc = read(path);
      expect(doc).toContain(`checkout${path === "README.md" ? " is version " : ": "}${version}`);
      expect(doc).not.toMatch(/\$\(phantom\s+reveal\b/);
      expect(doc).not.toContain("\u2014");
    });
  }

  test("runtime guidance uses the exec boundary and describes MCP limitations", () => {
    const doc = read("docs/phantom-locus.md");
    expect(doc).toContain("phantom exec -- bun dev");
    expect(doc).toContain("stack exec -- bun dev");
    expect(doc).toContain("not evaluated by JSON itself");
    expect(doc).toContain("does not automatically repair");
  });

  test("README tells readers to check both published package versions", () => {
    const doc = read("README.md");
    expect(doc).toContain("npm view @ashlr/stack version");
    expect(doc).toContain("npm view ashlr-stack-mcp version");
    expect(doc).not.toContain("registry currently serves");
  });
});
