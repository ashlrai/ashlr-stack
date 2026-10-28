import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cliPackage from "../../cli/package.json";
import { canonicalUrl } from "../src/lib/og";
import { generateAgentIndex } from "../scripts/agent-index.mjs";

const site = join(import.meta.dir, "..");
const dist = join(site, "dist");
const origin = "https://stack.ashlr.ai";
const pageUrl = (path: string) => origin + (path === "/" ? "" : path);
const read = (path: string) => readFileSync(join(dist, path), "utf8");
type Page = { path: string; title: string; headings: string[]; html: string };
let pages: Page[];

beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "stack-site-test-"));
  try {
    const build = Bun.spawn(["bun", "run", "build"], {
      cwd: site,
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited,
    ]);
    expect(code, `Site build failed:\n${stdout}\n${stderr}`).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  pages = readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".html"))
    .map((file) => {
      const html = read(file);
      const text = (value: string) => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      return {
        path: `/${file}`.replace(/index\.html$/, "").replace(/\.html$/, "").replace(/\/$/, "") || "/",
        title: text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ""),
        headings: [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((match) => text(match[1])),
        html,
      };
    });
  expect(pages.length).toBeGreaterThan(20);
}, 300_000);

async function elements(html: string, selector: string) {
  const results: Array<{ attrs: Record<string, string>; text: string }> = [];
  await new HTMLRewriter().on(selector, {
    element(element) { results.push({ attrs: Object.fromEntries(element.attributes), text: "" }); },
    text(chunk) { results[results.length - 1].text += chunk.text; },
  }).transform(new Response(html)).text();
  return results;
}

test("landing page retains reveal targets and the shared scroll island", async () => {
  const home = pages.find((page) => page.path === "/");
  expect(home).toBeDefined();
  const html = home!.html;
  expect((await elements(html, "[data-reveal]")).length).toBeGreaterThan(0);
  expect(html).toContain("SmoothScroll");
});

test("every rendered page has one canonical, one h1, description and matching OpenGraph", async () => {
  const canonicals = new Set<string>();
  for (const page of pages) {
    const canonical = await elements(page.html, 'link[rel="canonical"]');
    expect(canonical, page.path).toHaveLength(1);
    expect(canonical[0].attrs.href, page.path).toBe(pageUrl(page.path));
    expect(canonicals.has(canonical[0].attrs.href), page.path).toBe(false);
    canonicals.add(canonical[0].attrs.href);
    expect(await elements(page.html, "h1"), page.path).toHaveLength(1);
    const description = await elements(page.html, 'meta[name="description"]');
    expect(description, page.path).toHaveLength(1);
    expect(description[0].attrs.content.length, page.path).toBeGreaterThan(20);
    for (const key of ["title", "description", "image", "url", "type"]) {
      const meta = await elements(page.html, `meta[property="og:${key}"]`);
      expect(meta, `${page.path} og:${key}`).toHaveLength(1);
      expect(meta[0].attrs.content.length).toBeGreaterThan(0);
      if (key === "url") expect(meta[0].attrs.content).toBe(canonical[0].attrs.href);
      if (key === "description") expect(meta[0].attrs.content).toBe(description[0].attrs.content);
    }
  }
});

test("headings start at h1 and never skip a level", async () => {
  for (const page of pages) {
    const levels: number[] = [];
    await new HTMLRewriter().on("h1,h2,h3,h4,h5,h6", {
      element(element) { levels.push(Number(element.tagName.slice(1))); },
    }).transform(new Response(page.html)).text();
    expect(levels[0], page.path).toBe(1);
    levels.slice(1).forEach((level, index) => expect(level, `${page.path}: heading ${index + 2}`).toBeLessThanOrEqual(levels[index] + 1));
  }
});

test("JSON-LD parses and software metadata follows source with honest free license", async () => {
  let softwareCount = 0;
  for (const page of pages) {
    for (const script of await elements(page.html, 'script[type="application/ld+json"]')) {
      const schema = JSON.parse(script.text);
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBeString();
      if (schema["@type"] !== "SoftwareApplication") continue;
      softwareCount++;
      expect(schema.name).toBe("Ashlr Stack");
      expect(schema.softwareVersion).toBe(cliPackage.version);
      expect(schema.license).toBe(`https://spdx.org/licenses/${cliPackage.license}.html`);
      expect(schema.codeRepository).toBe("https://github.com/ashlrai/ashlr-stack");
      expect(schema.operatingSystem).toBe("macOS, Linux, Windows");
      expect(schema.offers.price).toBe("0");
      expect(schema.offers.priceCurrency).toBe("USD");
    }
  }
  expect(softwareCount).toBeGreaterThanOrEqual(2);
  expect(read("docs/capabilities/index.html")).toContain("provider accounts, infrastructure and API usage can cost money");
});

test("sitemap XML is well formed and lists exactly the indexable canonical pages", () => {
  // Python's standard-library XML parser validates structure without fetching a schema.
  const parsed = Bun.spawnSync(["python3", "-c", `
import json, pathlib, xml.etree.ElementTree as ET
root = pathlib.Path(${JSON.stringify(dist)})
ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
index = ET.parse(root / 'sitemap-index.xml').getroot()
assert index.tag == ns + 'sitemapindex'
urls = []
for entry in index:
    loc = entry.find(ns + 'loc').text
    assert loc.startswith('${origin}/')
    path = root / loc.removeprefix('${origin}/')
    assert path.resolve().parent == root.resolve()
    sitemap = ET.parse(path).getroot()
    assert sitemap.tag == ns + 'urlset'
    urls.extend(item.find(ns + 'loc').text for item in sitemap)
print(json.dumps(urls))
`]);
  expect(parsed.exitCode, parsed.stderr.toString()).toBe(0);
  const urls: string[] = JSON.parse(parsed.stdout.toString());
  expect(urls.length).toBe(new Set(urls).size);
  expect(urls.sort()).toEqual(pages.filter((page) => !page.html.includes('content="noindex,nofollow"')).map((page) => pageUrl(page.path)).sort());
  expect(read("robots.txt")).toContain(`Sitemap: ${origin}/sitemap-index.xml`);
});

test("llms.txt parses as an index and is reproducible from README and all docs headings", () => {
  const content = read("llms.txt");
  expect(content).toBe(generateAgentIndex(pages));
  expect(content).toBe(readFileSync(join(site, "public/llms.txt"), "utf8"));
  expect(content.startsWith("# Ashlr Stack\n\n> ")).toBe(true);
  expect(content).not.toContain("\u2014");
  expect(content).toContain(`Source reference: ${cliPackage.version} checkout`);
  const links = [...content.matchAll(/^- \[([^\]]+)\]\((https:\/\/[^)]+)\)/gm)];
  expect(links.length).toBeGreaterThan(20);
  const docLinks = links.filter((match) => new URL(match[2]).origin === origin);
  expect(docLinks.map((match) => new URL(match[2]).pathname).sort()).toEqual(pages.filter((page) => page.path.startsWith("/docs")).map((page) => page.path).sort());
});


test("canonical URLs collapse slash, query and fragment variants", () => {
  expect(canonicalUrl("/docs/quickstart/?utm_source=agent#install")).toBe(`${origin}/docs/quickstart`);
  expect(canonicalUrl("/?ref=agent")).toBe(origin);
});
