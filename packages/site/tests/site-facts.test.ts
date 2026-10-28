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
  renderAiPluginJson,
  renderLlmsFull,
  renderMcpJson,
  renderOpenApiJson,
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

// ---------------------------------------------------------------------------
// Generated files are fresh
// ---------------------------------------------------------------------------

describe("site facts: sources of truth agree", () => {
  test("cli package.json, VERSION const, server.json and CHANGELOG latest all agree", () => {
    expect(facts.sourceVersion).toBe(JSON.parse(readRepo("packages/cli/package.json")).version);
    expect(facts.latestRelease.version).toBe(facts.sourceVersion);
    expect(JSON.parse(readRepo("packages/mcp/package.json")).version).toBe(facts.sourceVersion);
  });

  test("recorded published version comes from docs/getting-started-ecosystem.md", () => {
    const row = readRepo("docs/getting-started-ecosystem.md").replace(/<!--[^]*?-->/g, "").match(
      /\|\s*Stack `@ashlr\/stack`\s*\|\s*(\d+\.\d+\.\d+)\s*\|\s*(\d+\.\d+\.\d+)\s*\|/,
    );
    expect(row?.[1]).toBe(facts.publishedVersion);
    expect(row?.[2]).toBe(facts.sourceVersion);
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
