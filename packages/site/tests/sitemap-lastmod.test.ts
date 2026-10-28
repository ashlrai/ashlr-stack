import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createGitLastmod, pageInputs } from "../scripts/sitemap-lastmod.mjs";

const root = resolve(import.meta.dir, "../../..");
const origin = "https://stack.ashlr.ai";

function gitDate(paths: string[]) {
  const value = execFileSync("git", ["log", "-1", "--format=%cI", "--", ...paths], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return value ? new Date(value).toISOString() : undefined;
}

describe("sitemap content provenance", () => {
  const routes = [
    ["/", "packages/site/src/pages/index.astro"],
    ["/docs", "packages/site/src/pages/docs/index.astro"],
    ["/docs/quickstart", "packages/site/src/pages/docs/quickstart.astro"],
    ["/launch/blog", "packages/site/src/pages/launch/blog.mdx"],
    ["/launch/hn", "packages/site/src/pages/launch/hn.md"],
    ["/providers/supabase", "packages/site/src/pages/providers/[slug].astro"],
    ["/use-cases/detect-project-services", "packages/site/src/pages/use-cases/[slug].astro"],
  ];

  for (const [route, source] of routes) {
    test(`${route} maps to its rendered source and shared layout inputs`, () => {
      const inputs = pageInputs(root, origin + route);
      expect(inputs).toContain(source);
      expect(inputs).toContain("packages/site/src/layouts");
      expect(inputs).toContain("packages/site/src/components");
      expect(inputs).toContain("packages/site/src/styles");
      expect(inputs).toContain("packages/site/src/lib");
      expect(inputs).toContain("packages/cli/package.json");
      expect(inputs).not.toContain(".");
      expect(inputs).not.toContain(".github");
      expect(inputs).not.toContain("README.md");
    });
  }

  test("slash, query and fragment variants use the same content inputs", () => {
    const plain = pageInputs(root, `${origin}/docs/quickstart`);
    expect(pageInputs(root, `${origin}/docs/quickstart/?ref=search#install`)).toEqual(plain);
    expect(pageInputs(root, `${origin}/?ref=search#main`)).toEqual(pageInputs(root, origin));
  });

  test("generated content includes its repository sources", () => {
    for (const route of ["/", "/docs/cli", "/docs/templates", "/providers/supabase", "/use-cases/plan-saas-stack"]) {
      const inputs = pageInputs(root, origin + route);
      for (const source of ["packages/core/src", "packages/cli/src", "packages/mcp/src", "templates", "packages/site/src/lib/providers-ref.ts"]) {
        expect(inputs, route).toContain(source);
      }
    }
    expect(pageInputs(root, `${origin}/docs/changelog`)).toContain("CHANGELOG.md");
    expect(pageInputs(root, `${origin}/docs/quickstart`)).not.toContain("CHANGELOG.md");
    expect(pageInputs(root, `${origin}/use-cases/plan-saas-stack`)).toContain("packages/site/src/lib/use-cases.ts");
    expect(pageInputs(root, `${origin}/launch/blog`)).not.toContain("packages/core/src");
  });

  test("lastmod equals path-scoped Git history rather than the build clock or unrelated files", () => {
    const lastmod = createGitLastmod(root);
    for (const [route] of routes) {
      const url = origin + route;
      const inputs = pageInputs(root, url);
      const expected = gitDate(inputs);
      expect(expected, `Tracked inputs must have history: ${route}`).toBeDefined();
      expect(lastmod(url), route).toBe(expected);
      expect(lastmod(url), `${route}: repeat calls remain stable`).toBe(expected);
    }
  });

  test("a source archive without Git omits lastmod instead of inventing a date", () => {
    const archive = mkdtempSync(resolve(tmpdir(), "stack-sitemap-archive-"));
    try {
      const lastmod = createGitLastmod(archive);
      expect(lastmod(origin)).toBeUndefined();
      expect(lastmod(`${origin}/docs/quickstart`)).toBeUndefined();
      expect(lastmod(`${origin}/use-cases/plan-saas-stack`)).toBeUndefined();
    } finally {
      rmSync(archive, { recursive: true, force: true });
    }
  });
});
