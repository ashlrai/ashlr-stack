import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listProviderNames } from "../providers/index.ts";

/**
 * What users install: the npm tarballs for the CLI and MCP server, and the
 * one-line installers (scripts/ plus the copies the site serves).
 */

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

describe("npm tarballs ship their bins", () => {
  // `npm pack` runs prepack but not prepublishOnly, so a build hooked only to
  // prepublishOnly packs a tarball with no dist/ and a global install of it has
  // no bin. `npm publish` runs prepack as well.
  for (const [dir, bin, entry] of [
    ["packages/cli", "stack", "dist/index.js"],
    ["packages/mcp", "ashlr-stack-mcp", "dist/server.js"],
  ] as const) {
    test(`${dir} builds ${entry} in prepack`, () => {
      const pkg = JSON.parse(read(`${dir}/package.json`));
      expect(pkg.bin).toEqual({ [bin]: `./${entry}` });
      expect(pkg.scripts.prepack).toBe("bun run build");
      expect(pkg.scripts.prepublishOnly).toBeUndefined();
      expect(pkg.scripts.build).toContain(`const f='${entry}'`);
      expect(pkg.files).toContain("dist/**/*");
    });
  }
});

describe("one-line installers", () => {
  for (const name of ["install.sh", "install.ps1"]) {
    test(`the site serves the same ${name} as scripts/`, () => {
      expect(read(`packages/site/public/${name}`)).toBe(read(`scripts/${name}`));
    });

    test(`${name} states the real provider count`, () => {
      const counts = [...read(`scripts/${name}`).matchAll(/the (\d+) curated providers/g)].map(
        (m) => Number(m[1]),
      );
      expect(counts.length).toBeGreaterThan(0);
      for (const count of counts) expect(count).toBe(listProviderNames().length);
    });
  }

  test("install.sh tells binary-path users how to get the MCP server", () => {
    const sh = read("scripts/install.sh");
    const binaryBranch = sh.slice(sh.indexOf("if install_via_binary; then"));
    expect(binaryBranch.slice(0, binaryBranch.indexOf("elif"))).toContain(
      "npm i -g ashlr-stack-mcp",
    );
  });
});
