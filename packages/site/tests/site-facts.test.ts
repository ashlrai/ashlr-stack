/**
 * Site freshness: every version string, install command, feature count and
 * MCP tool list the site publishes must match the repo sources of truth.
 *
 * Two halves:
 *  1. The committed generated files equal what scripts/gen-site-facts.ts
 *     produces right now, so a stale generated file fails here (re-run
 *     `bun run scripts/gen-cli-ref.ts`).
 *  2. Every literal version/command left in covered pages and manifests is
 *     checked against the generated facts, so a hand-edited drift fails too.
 *
 * No network, no subprocesses.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS_REF } from "../../core/src/catalog";
import { listProviderNames } from "../../core/src/providers/index";
import { listTemplates } from "../../core/src/templates";
import { TOOLS } from "../../mcp/src/tools";
import {
  computeFacts,
  placeholders,
  publishedVersionFromDocs,
  renderAiPluginJson,
  renderLlmsFull,
  renderMcpJson,
  renderOpenApiJson,
  renderSiteFactsTs,
  substitute,
} from "../scripts/gen-site-facts";
import { CLI_COMMANDS } from "../src/lib/cli-ref.generated";
import { MCP_RESOURCES, MCP_TOOLS } from "../src/lib/mcp-ref";
import * as F from "../src/lib/site-facts.generated";
import { TEMPLATES_REF } from "../src/lib/templates-ref";

const SITE = join(import.meta.dir, "..");
const ROOT = join(SITE, "..", "..");
const readSite = (rel: string) => readFileSync(join(SITE, rel), "utf8");
const readRepo = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The historical native release; a dated artifact, not the current source. */
const HISTORICAL_NATIVE = "0.2.0";
/** Reviewed Phantom Secrets version (external product, not repo-derived). */
const PHANTOM_REVIEWED = "0.7.9";

const facts = await computeFacts();
const ph = await placeholders(facts);
const nextPatch = (version: string) => {
  const parts = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!parts) throw new Error(`Expected a stable semver, got ${version}`);
  return `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
};

// ---------------------------------------------------------------------------
// Generated files are fresh
// ---------------------------------------------------------------------------

describe("site facts: sources of truth agree", () => {
  test("cli package.json, VERSION const, server.json and CHANGELOG latest all agree", () => {
    expect(facts.sourceVersion).toBe(JSON.parse(readRepo("packages/cli/package.json")).version);
    expect(facts.latestRelease.version).toBe(facts.sourceVersion);
    expect(facts.latestRelease.scope).toBe("source-changelog");
    expect(JSON.parse(readRepo("packages/mcp/package.json")).version).toBe(facts.sourceVersion);
  });

  test("recorded published version comes from docs/getting-started-ecosystem.md", () => {
    const row = readRepo("docs/getting-started-ecosystem.md").replace(/<!--[^]*?-->/g, "").match(
      /\|\s*Stack `@ashlr\/stack`\s*\|\s*(\d+\.\d+\.\d+)\s*\|\s*(\d+\.\d+\.\d+)\s*\|/,
    );
    expect(row?.[1]).toBe(facts.publishedVersion);
    expect(row?.[2]).toBe(facts.sourceVersion);
    expect(
      publishedVersionFromDocs(readRepo("docs/getting-started-ecosystem.md"), facts.sourceVersion),
    ).toBe(facts.publishedVersion);
  });

  test("a future source version does not become a published version", async () => {
    const recorded = readRepo("docs/getting-started-ecosystem.md");
    const nextSource = nextPatch(facts.sourceVersion);
    const futureSource =
      nextSource === facts.publishedVersion ? nextPatch(nextSource) : nextSource;
    let changedRows = 0;
    const futureDoc = recorded.replace(
      /(\|\s*Stack(?: MCP)? `(?:@ashlr\/stack|ashlr-stack-mcp)`\s*\|\s*[^|]+\|\s*<!-- fresh:begin version-pin -->)\d+\.\d+\.\d+(<!-- fresh:end -->)/g,
      (_match, prefix: string, suffix: string) => {
        changedRows++;
        return `${prefix}${futureSource}${suffix}`;
      },
    );
    expect(changedRows).toBe(2);
    expect(futureDoc).not.toBe(recorded);
    expect(publishedVersionFromDocs(futureDoc, futureSource)).toBe(facts.publishedVersion);
    expect(() => publishedVersionFromDocs(recorded, futureSource)).toThrow();
    const futureFacts = {
      ...facts,
      sourceVersion: futureSource,
      publishedVersion: publishedVersionFromDocs(futureDoc, futureSource),
    };
    const future = await placeholders(futureFacts);
    expect(future.SOURCE_VERSION).toBe(futureSource);
    expect(future.PUBLISHED_VERSION).toBe(facts.publishedVersion);
    expect(future.INSTALL_NPM).toBe(`npm i -g @ashlr/stack@${facts.publishedVersion}`);
    expect(renderSiteFactsTs(futureFacts, future)).toContain(
      `export const PUBLISHED_VERSION = ${JSON.stringify(facts.publishedVersion)}`,
    );
    expect(await renderMcpJson(futureFacts)).toContain(`@ashlr/stack@${facts.publishedVersion}`);
  });

  test("root registry install guidance does not pin the source version", () => {
    const readme = readRepo("README.md");
    const section = readme.split("npm / bun registry:")[1]?.split("**Dev install**")[0];
    expect(section).toBeDefined();
    expect(section).toContain("npm i -g @ashlr/stack ashlr-stack-mcp");
    expect(section).not.toMatch(/(?:@ashlr\/stack|ashlr-stack-mcp)@\d+\.\d+\.\d+/);
  });

  test("a verified publication may be newer than the source version", () => {
    const recorded = [
      "| Stack `@ashlr/stack` | 0.3.1 | 0.3.0 |",
      "| Stack MCP `ashlr-stack-mcp` | 0.3.1 | 0.3.0 |",
    ].join("\n");
    expect(publishedVersionFromDocs(recorded, "0.3.0")).toBe("0.3.1");
  });

  test("shared public pins fail closed for divergent, missing or duplicate observations", () => {
    const recorded = readRepo("docs/getting-started-ecosystem.md");
    const divergent = recorded.replace(
      /(\| Stack MCP `ashlr-stack-mcp` \| )\d+\.\d+\.\d+( \|)/,
      (_match, prefix: string, suffix: string) =>
        `${prefix}${nextPatch(facts.publishedVersion)}${suffix}`,
    );
    const missing = recorded.replace("| Stack MCP `ashlr-stack-mcp` |", "| missing MCP row |");
    expect(divergent).not.toBe(recorded);
    expect(missing).not.toBe(recorded);
    expect(() => publishedVersionFromDocs(divergent, facts.sourceVersion)).toThrow();
    expect(() => publishedVersionFromDocs(missing, facts.sourceVersion)).toThrow();
    expect(() =>
      publishedVersionFromDocs(`${recorded}\n${recorded}`, facts.sourceVersion),
    ).toThrow();
    for (const row of [
      "| Stack MCP `ashlr-stack-mcp` | 0.4.0 | TBD |",
      "| Stack MCP `ashlr-stack-mcp` | 0.4.0-rc.1 | 0.3.0 |",
    ]) {
      expect(() => publishedVersionFromDocs(`${recorded}\n${row}`, facts.sourceVersion)).toThrow();
    }
  });

  test("a later recorded publication is not attributed to the 0.3.0 observation date", async () => {
    const later = { ...facts, publishedVersion: nextPatch(facts.publishedVersion) };
    const guide = substitute(readSite("src/data/agent-guide.txt"), await placeholders(later));
    const full = await renderLlmsFull(later);
    for (const text of [guide, full]) {
      expect(text).toContain(`recorded public CLI/MCP version is ${later.publishedVersion}`);
      expect(text).not.toContain(
        `November 1, 2026 reported CLI/MCP version ${later.publishedVersion}`,
      );
    }
  });
  test("a later public pointer does not extend the verified 0.3.1 runtime claim", async () => {
    // The public pointer records a version, not that release's engines metadata.
    const later = { ...facts, publishedVersion: "0.3.2" };
    const mcp = JSON.parse(await renderMcpJson(later));
    const plugin = JSON.parse(renderAiPluginJson(later));
    const openapi = JSON.parse(renderOpenApiJson(later));
    for (const description of [
      mcp.description,
      plugin.description_for_model,
      openapi.info.description,
    ]) {
      expect(description).toContain(
        "0.3.1 CLI and MCP packages declare Node.js 20 or newer; inspect other releases’ engines.",
      );
      expect(description).not.toContain("0.3.2 CLI and MCP packages declare Node.js");
      expect(description).toContain("is 0.3.2.");
    }
    const expectedArgs = [
      "-y", "-p", "@ashlr/stack@0.3.2", "-p", "ashlr-stack-mcp@0.3.2", "ashlr-stack-mcp",
    ];
    expect(mcp.install.args).toEqual(expectedArgs);
    expect(mcp.install.mcpConfigSnippet.mcpServers.stack.args).toEqual(expectedArgs);
    expect(mcp.version).toBe(facts.sourceVersion);
    expect(openapi.info.version).toBe(facts.sourceVersion);
  });
  test("counts match the registries", () => {
    expect(facts.providerCount).toBe(listProviderNames().length);
    expect(facts.categoryCount).toBe(new Set(PROVIDERS_REF.map((p) => p.category)).size);
    expect(facts.templateCount).toBe(listTemplates().length);
    expect(facts.mcpToolCount).toBe(TOOLS.length);
    expect(facts.cliCommandCount).toBe(CLI_COMMANDS.length);
  });
});

describe("site facts: generated files are current", () => {
  test("src/lib/site-facts.generated.ts values match the sources", () => {
    expect(F.SOURCE_VERSION).toBe(facts.sourceVersion);
    expect(F.PUBLISHED_VERSION).toBe(facts.publishedVersion);
    expect(F.LATEST_RELEASE_VERSION).toBe(facts.latestRelease.version);
    expect(F.LATEST_RELEASE_DATE).toBe(facts.latestRelease.date);
    expect(F.PROVIDER_COUNT).toBe(facts.providerCount);
    expect(F.PROVIDER_CATEGORY_COUNT).toBe(facts.categoryCount);
    expect(F.TEMPLATE_COUNT).toBe(facts.templateCount);
    expect(F.CLI_COMMAND_COUNT).toBe(facts.cliCommandCount);
    expect(F.MCP_TOOL_COUNT).toBe(facts.mcpToolCount);
    expect(F.MCP_TOOL_NAMES).toEqual(facts.mcpToolNames);
    expect(F.INSTALL_CMD).toBe(ph.INSTALL_CMD);
    expect(F.MCP_STDIO_CONFIG).toContain(`@ashlr/stack@${facts.publishedVersion}`);
  });

  test("public/mcp.json equals a fresh render", async () => {
    expect(readSite("public/mcp.json")).toBe(await renderMcpJson(facts));
  });

  test("public/.well-known/ai-plugin.json equals a fresh patch", () => {
    expect(readSite("public/.well-known/ai-plugin.json")).toBe(renderAiPluginJson(facts));
  });

  test("public/openapi.json equals a fresh patch", () => {
    expect(readSite("public/openapi.json")).toBe(renderOpenApiJson(facts));
  });

  test("public/llms-full.txt equals a fresh render of its template", async () => {
    expect(readSite("public/llms-full.txt")).toBe(await renderLlmsFull(facts));
  });

  test("src/data/site-facts.json placeholders match a fresh computation", () => {
    const json = JSON.parse(readSite("src/data/site-facts.json")) as {
      facts: typeof facts;
      placeholders: typeof ph;
    };
    expect(json.facts).toEqual(facts);
    expect(json.facts.latestRelease.scope).toBe("source-changelog");
    expect(json.placeholders).toEqual(ph);
  });

  test("mcp.json and mcp-ref mirror TOOLS and server resources", () => {
    const manifest = JSON.parse(readSite("public/mcp.json")) as {
      tools: Array<{ name: string }>;
      resources: Array<{ uri: string }>;
      version: string;
    };
    expect(manifest.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(manifest.resources.map((r) => r.uri)).toEqual(MCP_RESOURCES.map((r) => r.uri));
    expect(manifest.version).toBe(facts.sourceVersion);
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(facts.mcpToolNames);
  });

  test("agent-guide.txt placeholders all exist and llms.txt has none left over", () => {
    const unresolved = new Set<string>();
    for (const m of readSite("src/data/agent-guide.txt").matchAll(/\{\{(\w+)\}\}/g))
      unresolved.add(m[1]);
    for (const key of unresolved) {
      expect(ph, `{{${key}}} in agent-guide.txt`).toHaveProperty(key);
    }
    expect(readSite("public/llms.txt")).not.toMatch(/\{\{\w+\}\}/);
  });
});

// ---------------------------------------------------------------------------
// Literal scan: no covered surface may carry a version or command that
// differs from the sources of truth
// ---------------------------------------------------------------------------

function* coveredFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* coveredFiles(path);
    } else if (/\.(astro|tsx?|mdx?|txt|json)$/.test(entry)) {
      yield path;
    }
  }
}

const SEMVER = /(?<![\w.])\d+\.\d+\.\d+(?![\w.])/g;
const KEYWORDS =
  /(historical|native|phantom|source|checkout|reviewed|public|published|npm|registry|recorded|as of)/gi;

/** Extra literal versions a file is allowed to carry on top of the facts. */
const FILE_ALLOWLIST: Record<string, string[]> = {
  "src/pages/docs/privacy.astro": ["1.0.0"], // the privacy document's own version
  "public/openapi.json": ["3.1.0"], // the OpenAPI spec version
};

function scanFiles(): Array<{ rel: string; text: string }> {
  const files: Array<{ rel: string; text: string }> = [];
  const push = (rel: string) => files.push({ rel, text: readSite(rel) });
  for (const dir of ["src/pages", "src/components", "src/lib"]) {
    for (const abs of coveredFiles(join(SITE, dir))) {
      const rel = abs.slice(SITE.length + 1);
      if (rel.startsWith("src/pages/launch/") || /\/_[^/]+\.md$/.test(rel)) continue;
      files.push({ rel, text: readFileSync(abs, "utf8") });
    }
  }
  for (const rel of [
    "src/data/agent-guide.txt",
    "src/data/llms-full.txt",
    "public/llms.txt",
    "public/llms-full.txt",
    "public/mcp.json",
    "public/openapi.json",
    "public/.well-known/ai-plugin.json",
  ]) {
    push(rel);
  }
  return files;
}

/**
 * Classify a version literal by the keyword nearest before it (60 chars of
 * context): "source 0.2.x", "public npm 0.1.x", "historical native 0.2.0".
 * Unclassified matches fall back to the allowlist check.
 */
function classify(context: string): string | null {
  let found: string | null = null;
  for (const m of context.matchAll(KEYWORDS)) found = m[1].toLowerCase();
  if (found === null) return null;
  if (found === "historical" || found === "native") return HISTORICAL_NATIVE;
  if (found === "phantom") return PHANTOM_REVIEWED;
  if (found === "source" || found === "checkout" || found === "reviewed") return F.SOURCE_VERSION;
  return F.PUBLISHED_VERSION; // public|published|npm|registry|recorded|as of
}

describe("site facts: no stale literal versions or commands", () => {
  const allowed = new Set([
    F.SOURCE_VERSION,
    F.PUBLISHED_VERSION,
    HISTORICAL_NATIVE,
    PHANTOM_REVIEWED,
  ]);

  test("every semver literal matches its context and the sources", () => {
    const failures: string[] = [];
    for (const { rel, text } of scanFiles()) {
      const extra = FILE_ALLOWLIST[rel] ?? [];
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        // Skip SVG path data and generated docs-index link lines.
        if (line.includes('d="') || line.startsWith("- [")) return;
        for (const m of line.matchAll(SEMVER)) {
          const v = m[0];
          if (allowed.has(v) || extra.includes(v)) {
            const expected = classify(line.slice(Math.max(0, m.index - 60), m.index));
            if (expected !== null && expected !== v) {
              failures.push(`${rel}:${i + 1} shows "${v}" where context requires ${expected}`);
            }
            continue;
          }
          failures.push(`${rel}:${i + 1} has version "${v}" not in ${[...allowed, ...extra].join(", ")}`);
        }
      });
    }
    expect(failures).toEqual([]);
  });

  test("package pins always equal the recorded published version", () => {
    const failures: string[] = [];
    for (const { rel, text } of scanFiles()) {
      for (const m of text.matchAll(/(@ashlr\/stack|ashlr-stack-mcp)@(\d+\.\d+\.\d+)/g)) {
        if (m[2] !== F.PUBLISHED_VERSION)
          failures.push(`${rel} pins ${m[1]}@${m[2]}, recorded published is ${F.PUBLISHED_VERSION}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("install one-liners equal the generated commands", () => {
    const allowedCmds = new Set([F.INSTALL_CMD, F.INSTALL_CMD_HTTPS]);
    const failures: string[] = [];
    for (const { rel, text } of scanFiles()) {
      for (const m of text.matchAll(/curl[^\n`"']*install\.sh[^\n`"']*/g)) {
        if (!allowedCmds.has(m[0])) failures.push(`${rel}: "${m[0]}" is not the canonical installer`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("`stack <verb>` in the plain-text references is a real CLI command", () => {
    const commandNames = new Set(CLI_COMMANDS.map((c) => c.name.replace(/^stack /, "")));
    const failures: string[] = [];
    for (const rel of ["src/data/agent-guide.txt", "src/data/llms-full.txt", "public/llms.txt"]) {
      for (const m of readSite(rel).matchAll(/`stack ([a-z][\w-]*)`/g)) {
        if (!commandNames.has(m[1])) failures.push(`${rel}: \`stack ${m[1]}\` is not a CLI command`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("site facts: template list coverage", () => {
  test("TEMPLATES_REF covers exactly the shipped templates", () => {
    expect(TEMPLATES_REF.map((t) => t.name).sort()).toEqual([...listTemplates()].sort());
  });

  test("agent-guide.txt template bullets name every shipped template", () => {
    const section = readSite("src/data/agent-guide.txt").split("## Templates")[1] ?? "";
    const names = [...section.matchAll(/^- `([\w-]+)`/gm)].map((m) => m[1]).sort();
    expect(names).toEqual([...listTemplates()].sort());
  });
});
