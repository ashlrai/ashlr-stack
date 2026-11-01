import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import cliPackage from "../../cli/package.json";
import { canonicalUrl } from "../src/lib/og";
import { PUBLISHED_VERSION } from "../src/lib/site-facts.generated";
import { generateAgentIndex } from "../scripts/agent-index.mjs";
import { USE_CASES } from "../src/lib/use-cases";

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

test("rendered release guidance uses the recorded publication and verified runtime", () => {
  const text = (path: string) => read(path).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const home = text("index.html");
  expect(home).toContain(`v${PUBLISHED_VERSION} LIVE ON NPM`);
  expect(home).toContain(`control plane · v${PUBLISHED_VERSION}`);
  for (const path of ["docs/quickstart/index.html", "docs/mcp/index.html"]) {
    const page = text(path);
    expect(page).toMatch(/published 0\.3\.0 CLI and MCP packages declare/i);
    expect(page).toContain("Node.js 20");
    expect(page).not.toMatch(/\b(?:published|public)\b.{0,160}\b(?:requires?|needs?)\b.{0,30}\bBun\b/i);
    expect(page).not.toMatch(/\bBun\s+1\.2\+?.{0,80}\brequired\b.{0,60}\b(?:public|published)\b/i);
  }
});

test("quickstart forwards an npm project command without implying Bun is required", async () => {
  const page = pages.find((item) => item.path === "/docs/quickstart");
  expect(page).toBeDefined();
  const text = page!.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain("For a project with an npm dev script");
  expect(text).not.toContain("stack exec -- bun dev");
  expect(text).toContain("For other projects, use their own command and install its required runtime");
  const stepStart = page!.html.search(/<h2\b[^>]*\bid=["']6-run-your-app-with-secrets-injected["'][^>]*>/i);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextHeading = page!.html.slice(stepStart + 1).search(/<h2(?:\s|>)/i);
  expect(nextHeading).toBeGreaterThan(0);
  const stepHtml = page!.html.slice(stepStart, stepStart + 1 + nextHeading);
  const paragraphs = await elements(stepHtml, "p");
  expect(paragraphs.length).toBeGreaterThan(0);
  expect(paragraphs[0].text.replace(/\s+/g, " ")).toContain("stack exec -- npm run dev");
  const codeBlocks = await elements(stepHtml, "pre code");
  expect(codeBlocks).toHaveLength(1);
  expect(codeBlocks[0].text.trim()).toBe("stack exec -- npm run dev");
  const scripts = await elements(page!.html, 'script[type="application/ld+json"]');
  const howTo = scripts.map((item) => JSON.parse(item.text)).find((item) => item["@type"] === "HowTo");
  const step = howTo?.step?.find((item: { name: string }) => item.name === "Forward your app command to Phantom");
  expect(step?.text).toContain("stack exec -- npm run dev");
  expect(step?.text).toContain("other projects need their own command and runtime");
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

test("JSON-LD parses and software metadata follows recorded publication with honest free license", async () => {
  let softwareCount = 0;
  for (const page of pages) {
    for (const script of await elements(page.html, 'script[type="application/ld+json"]')) {
      const schema = JSON.parse(script.text);
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBeString();
      if (schema["@type"] !== "SoftwareApplication") continue;
      softwareCount++;
      expect(schema.name).toBe("Ashlr Stack");
      expect(schema.softwareVersion).toBe(PUBLISHED_VERSION);
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
import datetime, json, pathlib, re, xml.etree.ElementTree as ET
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
    for item in sitemap:
        assert item.tag == ns + 'url'
        assert len(item.findall(ns + 'loc')) == 1
        assert len(item.findall(ns + 'lastmod')) == 1
        modified = item.find(ns + 'lastmod').text
        assert re.fullmatch(r'\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z', modified), modified
        timestamp = datetime.datetime.fromisoformat(modified.replace('Z', '+00:00'))
        assert timestamp <= datetime.datetime.now(datetime.timezone.utc), modified
        urls.append(item.find(ns + 'loc').text)
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


async function assertInternalLink(href: string, context: string) {
  const url = new URL(href, origin);
  expect(url.origin, context).toBe(origin);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const target = pages.find((page) => page.path === path);
  expect(target, `${context}: missing page ${path}`).toBeDefined();
  if (url.hash && target) {
    const ids = await elements(target.html, "[id]");
    expect(ids.map((element) => element.attrs.id), context).toContain(decodeURIComponent(url.hash.slice(1)));
  }
}

test("every use-case claim renders its cited evidence and links to a real repository file or docs page", async () => {
  expect(USE_CASES.length).toBeGreaterThanOrEqual(2);
  expect(USE_CASES.length).toBeLessThanOrEqual(4);
  expect(new Set(USE_CASES.map((guide) => guide.slug)).size).toBe(USE_CASES.length);
  const repo = resolve(site, "../..");
  for (const guide of USE_CASES) {
    const path = `/use-cases/${guide.slug}`;
    const page = pages.find((entry) => entry.path === path);
    expect(page, path).toBeDefined();
    if (!page) throw new Error(`Missing rendered guide: ${path}`);
    expect(JSON.stringify(guide), path).not.toContain("\u2014");
    expect(guide.claims.length, path).toBeGreaterThanOrEqual(3);
    const claims = await elements(page.html, "section[data-claim]");
    expect(claims.map((claim) => claim.attrs["data-claim"]), path).toEqual(guide.claims.map((claim) => claim.id));
    expect(new Set(guide.claims.map((claim) => claim.id)).size, path).toBe(guide.claims.length);
    for (const claim of guide.claims) {
      expect(claim.id).toMatch(/^[a-z0-9-]+$/);
      const context = `${path}#${claim.id}`;
      const selector = `section[data-claim="${claim.id}"]`;
      const sources = await elements(page.html, `${selector} a[data-source]`);
      expect(sources.length, `${context}: every claim needs evidence`).toBeGreaterThan(0);
      expect(sources.map((source) => source.attrs.href), context).toEqual(claim.sources.map((source) => source.href));
      expect((await elements(page.html, `${selector} h2`))[0]?.text.trim(), context).toBe(claim.title);
      if (claim.command) {
        const code = await elements(page.html, `${selector} pre code`);
        expect(code.map((block) => block.text.trim()), context).toContain(claim.command.trim());
      }
      for (const source of sources) {
        expect(source.text.trim().length, context).toBeGreaterThan(3);
        const url = new URL(source.attrs.href, origin);
        if (url.origin === origin) {
          expect(url.pathname, context).toMatch(/^\/docs(?:\/|$)/);
          await assertInternalLink(source.attrs.href, context);
          continue;
        }
        expect(url.origin, context).toBe("https://github.com");
        const prefix = "/ashlrai/ashlr-stack/blob/main/";
        expect(url.pathname.startsWith(prefix), context).toBe(true);
        const relative = decodeURIComponent(url.pathname.slice(prefix.length));
        const sourcePath = resolve(repo, relative);
        expect(sourcePath.startsWith(repo + sep), context).toBe(true);
        const sourceText = readFileSync(sourcePath, "utf8");
        expect(sourceText.trim().length, context).toBeGreaterThan(0);
        if (url.hash) {
          const lines = url.hash.match(/^#L(\d+)(?:-L(\d+))?$/);
          expect(lines, context).not.toBeNull();
          if (lines) {
            const first = Number(lines[1]);
            const last = Number(lines[2] ?? lines[1]);
            expect(first, context).toBeGreaterThan(0);
            expect(last, context).toBeGreaterThanOrEqual(first);
            expect(last, context).toBeLessThanOrEqual(sourceText.split("\n").length);
          }
        }
      }
    }
  }
});

test("use-case guides connect readers to install, docs and related workflows without orphan pages", async () => {
  for (const guide of USE_CASES) {
    const path = `/use-cases/${guide.slug}`;
    const html = read(`use-cases/${guide.slug}/index.html`);
    const hrefs = (await elements(html, "a[href]")).map((link) => link.attrs.href);
    expect(hrefs, path).toContain("/docs/capabilities#install");
    expect(hrefs.some((href) => /^\/docs(?:\/|$)/.test(href)), path).toBe(true);
    for (const related of USE_CASES.filter((candidate) => candidate.slug !== guide.slug)) {
      expect(hrefs.map((href) => new URL(href, origin).pathname.replace(/\/$/, "")), path).toContain(`/use-cases/${related.slug}`);
    }
    for (const href of hrefs.filter((href) => href.startsWith("/") || href.startsWith("#"))) {
      await assertInternalLink(new URL(href, pageUrl(path)).href, path);
    }
    for (const inbound of ["/", "/docs"]) {
      const page = pages.find((candidate) => candidate.path === inbound);
      expect(page).toBeDefined();
      const links = await elements(page?.html ?? "", "a[href]");
      expect(links.map((link) => new URL(link.attrs.href, origin).pathname.replace(/\/$/, "")), `${inbound} links to ${path}`).toContain(path);
    }
  }
});

test("reading pages avoid global motion hydration and images reserve dimensions", async () => {
  for (const page of pages) {
    for (const img of await elements(page.html, "img")) {
      expect(Number(img.attrs.width), `${page.path}: ${img.attrs.src} width`).toBeGreaterThan(0);
      expect(Number(img.attrs.height), `${page.path}: ${img.attrs.src} height`).toBeGreaterThan(0);
    }
    if (page.path !== "/") {
      const islands = await elements(page.html, "astro-island[component-url]");
      for (const island of islands) {
        expect(island.attrs["component-url"], page.path).not.toMatch(/(?:SmoothScroll|StickyInstall)/);
      }
    }
    const resources = await elements(page.html, "link[href]");
    expect(resources.some((link) => /fonts\.(?:googleapis|gstatic)\.com/.test(link.attrs.href)), page.path).toBe(false);
  }
});
