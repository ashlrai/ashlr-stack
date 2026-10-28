import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const shared = [
  "packages/site/src/layouts",
  "packages/site/src/components",
  "packages/site/src/styles",
  "packages/site/src/lib",
  "packages/cli/package.json",
];

/**
 * Content dependency groups, including sources behind generated routes.
 * Shared libraries cover navigation, guide titles, generated references and
 * schema data. These conservative groups can advance several related pages
 * together; they do not claim to identify the last edit to only a page's prose.
 */
export function pageInputs(root, url) {
  const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
  const stem = `packages/site/src/pages${path === "/" ? "/index" : path}`;
  const page = [".astro", ".mdx", ".md", "/index.astro"]
    .map((extension) => stem + extension)
    .find((file) => existsSync(join(root, file)));
  const inputs = [...shared];
  if (page) inputs.push(page);
  if (path.startsWith("/use-cases/")) {
    inputs.push("packages/site/src/pages/use-cases/[slug].astro", "packages/site/src/lib/use-cases.ts");
  }
  if (path.startsWith("/providers/")) {
    inputs.push("packages/site/src/pages/providers/[slug].astro");
  }
  // Provider, CLI and template references are generated from these sources.
  if (path === "/" || path.startsWith("/docs") || path.startsWith("/providers/") || path.startsWith("/use-cases/")) {
    inputs.push("packages/site/src/lib/providers-ref.ts", "packages/core/src", "packages/cli/src", "packages/mcp/src", "templates");
  }
  if (path === "/docs/changelog") inputs.push("CHANGELOG.md");
  return inputs;
}

/**
 * Never use the build clock as a content date. A shallow checkout can only
 * attest to its available boundary commit; an archive without Git omits lastmod.
 * A missing path history or Git error also omits the date. Never substitute an
 * unrelated repository commit for evidence about the content inputs.
 * Uncommitted preview changes acquire their real timestamp when committed.
 */
export function createGitLastmod(root) {
  const cache = new Map();
  function dateFor(paths) {
    try {
      const value = execFileSync("git", ["log", "-1", "--format=%cI", ...paths], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
    } catch {
      return undefined;
    }
  }
  return (url) => {
    const inputs = pageInputs(root, url);
    const key = inputs.join("\n");
    if (!cache.has(key)) cache.set(key, dateFor(["--", ...inputs]));
    return cache.get(key);
  };
}
