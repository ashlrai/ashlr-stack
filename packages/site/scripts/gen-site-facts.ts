#!/usr/bin/env bun
/**
 * scripts/gen-site-facts.ts
 *
 * Freshness generator for packages/site. Every version string, install
 * command, feature count and MCP tool list the site publishes is derived
 * here from the repo sources of truth, so a release cannot leave stale
 * numbers behind:
 *
 *   - source version   -> packages/cli/package.json (checked against the
 *                         VERSION const in packages/cli/src/index.ts, the
 *                         mcp package.json, packages/mcp/server.json and the
 *                         latest release heading in CHANGELOG.md)
 *   - published npm    -> the version-lag table in
 *                         docs/getting-started-ecosystem.md (the repo's
 *                         recorded registry observation)
 *   - MCP tool list    -> TOOLS in packages/mcp/src/tools.ts (+ the `cli`
 *                         synopsis strings in TOOL_CLI_EXTRAS below)
 *   - MCP resources    -> the resources.push({...}) blocks in
 *                         packages/mcp/src/server.ts
 *   - providers        -> packages/core catalog + provider registry
 *   - templates        -> templates/ via packages/core listTemplates()
 *   - CLI commands     -> subCommands block of packages/cli/src/index.ts
 *   - plugin commands  -> packages/plugin/commands/*.md
 *   - site host        -> astro.config.mjs `site:` URL
 *
 * Outputs (all committed; tests in tests/site-facts.test.ts fail on drift):
 *   src/lib/site-facts.generated.ts  - typed constants for .astro/.tsx pages
 *   src/lib/mcp-ref.generated.ts     - MCP_TOOLS + MCP_RESOURCES
 *   src/data/site-facts.json         - flat placeholder map for agent-index.mjs
 *   public/mcp.json                  - full manifest
 *   public/.well-known/ai-plugin.json- patched description_for_model
 *   public/openapi.json              - patched info.version/description
 *   public/llms-full.txt             - rendered from src/data/llms-full.txt
 *
 * packages/site/package.json is a frozen path, so this is invoked from
 * scripts/gen-cli-ref.ts (already wired into dev/build via `gen:cli-ref`).
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = (import.meta as { dir?: string }).dir ?? resolve(process.cwd());
const SITE_DIR = resolve(SCRIPT_DIR, "..");
const ROOT = resolve(SITE_DIR, "..", "..");

const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, unknown>;
const sitePath = (rel: string) => resolve(SITE_DIR, rel);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteFacts {
  /** Reviewed source version (all release surfaces must agree on it). */
  sourceVersion: string;
  /** Published npm version recorded in docs/getting-started-ecosystem.md. */
  publishedVersion: string;
  /** Latest release heading in CHANGELOG.md. */
  latestRelease: { version: string; date: string };
  providerCount: number;
  categoryCount: number;
  templateCount: number;
  /** Template slugs in `listTemplates()` order. */
  templateSlugs: string[];
  cliCommandCount: number;
  mcpToolCount: number;
  mcpToolNames: string[];
  /** Plugin slash commands: bare name, `/stack:x [args]` signature, one-line doc. */
  pluginCommands: Array<{ name: string; signature: string; description: string }>;
  /** Bare host of the deployed site, e.g. stack.ashlr.ai. */
  siteHost: string;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

interface McpResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Per-tool `cli` synopsis (the one field not derivable from TOOLS)
// ---------------------------------------------------------------------------

const TOOL_CLI_EXTRAS: Record<string, string> = {
  stack_init: "stack init --noInteractive [--template <name>] [--force]",
  stack_import: "stack import --json [--from <path>] [--dryRun]",
  stack_scan: "stack scan [--path <dir>] [--confidence low|medium|high]",
  stack_add: "stack add <service> [--use <id>]",
  stack_remove: "stack remove <service> --json [--keepRemote]",
  stack_list: "stack list [--json]",
  stack_info: "stack info <service> [--json]",
  stack_status: "stack status [--json]",
  stack_env_show: "stack env show [--json]",
  stack_env_diff: "stack env diff [--json]",
  stack_doctor: "stack doctor [--fix] [--all] [--json]",
  stack_sync: "stack sync --platform <name>",
  stack_providers: "stack providers [--category <category>] [--json]",
  stack_projects_list: "stack projects list [--json]",
  stack_deps: "stack deps [--json]",
  stack_templates_list: "stack templates list [--json]",
  stack_upgrade: "stack upgrade --json",
  stack_recommend: 'stack recommend "<query>" --json [--k <n>] [--category <name>] [--save]',
  stack_apply: "stack apply <recipe_id> [--noWire]",
};

// ---------------------------------------------------------------------------
// Fact extraction
// ---------------------------------------------------------------------------

/** Latest `## X.Y.Z (date)` heading in CHANGELOG.md (skips `## Unreleased`). */
function latestChangelogRelease(): { version: string; date: string } {
  const m = read("CHANGELOG.md").match(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/m);
  if (!m) throw new Error("no `## X.Y.Z (date)` release heading found in CHANGELOG.md");
  return { version: m[1], date: m[2] };
}

/** Recorded published npm version from the docs version-lag table. */
function publishedVersion(sourceVersion: string): string {
  // The source column is a fresh:begin version-pin block; read the rendered text.
  const doc = read("docs/getting-started-ecosystem.md").replace(/<!-- fresh:(?:begin [\w-]+|end) -->/g, "");
  const row = doc.match(
    /\|\s*Stack `@ashlr\/stack`\s*\|\s*(\d+\.\d+\.\d+)\s*\|\s*(\d+\.\d+\.\d+)\s*\|/,
  );
  if (!row)
    throw new Error(
      "docs/getting-started-ecosystem.md: no `| Stack `@ashlr/stack` | pub | src |` row; the published version has no recorded source of truth",
    );
  if (row[2] !== sourceVersion)
    throw new Error(
      `docs/getting-started-ecosystem.md records source ${row[2]} but packages/cli is ${sourceVersion}; update the table`,
    );
  return row[1];
}

/** Top-level CLI command names from the subCommands block of cli/src/index.ts. */
function cliCommands(): string[] {
  const src = read("packages/cli/src/index.ts");
  const block = src.match(/\n {2}subCommands: \{\n([\s\S]*?)\n {2}\},/);
  if (!block) throw new Error("no subCommands block in packages/cli/src/index.ts");
  return [...block[1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
}

/** Resource objects the MCP server can advertise (server.ts resources.push). */
function mcpResources(): McpResourceDef[] {
  const src = read("packages/mcp/src/server.ts");
  const out: McpResourceDef[] = [];
  for (const m of src.matchAll(/resources\.push\(\{([\s\S]*?)\}\);/g)) {
    const field = (name: string) => {
      const f = m[1].match(new RegExp(`${name}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      if (!f) throw new Error(`server.ts resource block missing ${name}: ${m[1]}`);
      return f[1];
    };
    out.push({
      uri: field("uri"),
      name: field("name"),
      description: field("description"),
      mimeType: field("mimeType"),
    });
  }
  if (out.length === 0) throw new Error("no resources.push blocks found in packages/mcp/src/server.ts");
  return out;
}

export async function computeFacts(): Promise<SiteFacts> {
  const cliVersion = (readJson("packages/cli/package.json").version ?? "") as string;
  const mcpVersion = (readJson("packages/mcp/package.json").version ?? "") as string;
  const coreVersion = (readJson("packages/core/package.json").version ?? "") as string;
  const serverJson = readJson("packages/mcp/server.json") as {
    version?: string;
    packages?: Array<{ version?: string }>;
  };
  const versionConst = read("packages/cli/src/index.ts").match(/^const VERSION = ["']([^"']+)["'];$/m)?.[1];
  const release = latestChangelogRelease();

  const versions: Record<string, string | undefined> = {
    "packages/cli/package.json": cliVersion,
    "packages/mcp/package.json": mcpVersion,
    "packages/core/package.json": coreVersion,
    "packages/mcp/server.json": serverJson.version,
    "packages/mcp/server.json packages[]": serverJson.packages?.[0]?.version,
    "packages/cli/src/index.ts VERSION": versionConst,
    "CHANGELOG.md latest release": release.version,
  };
  const drift = Object.entries(versions).filter(([, v]) => v !== cliVersion);
  if (drift.length > 0)
    throw new Error(
      `source version disagreement: ${drift.map(([k, v]) => `${k} is ${v}, expected ${cliVersion}`).join("; ")}`,
    );

  const { TOOLS } = (await import(resolve(ROOT, "packages/mcp/src/tools.ts"))) as {
    TOOLS: McpToolDef[];
  };
  for (const t of TOOLS) {
    if (!TOOL_CLI_EXTRAS[t.name])
      throw new Error(`no TOOL_CLI_EXTRAS["${t.name}"] in scripts/gen-site-facts.ts; add its cli synopsis`);
  }

  const { PROVIDERS_REF } = (await import(resolve(ROOT, "packages/core/src/catalog.ts"))) as {
    PROVIDERS_REF: Array<{ name: string; category: string }>;
  };
  const { listProviderNames } = (await import(
    resolve(ROOT, "packages/core/src/providers/index.ts")
  )) as { listProviderNames: () => string[] };
  const { listTemplates } = (await import(resolve(ROOT, "packages/core/src/templates.ts"))) as {
    listTemplates: () => string[];
  };

  const providerNames = listProviderNames();
  const templateSlugs = listTemplates();
  const pluginCommands = readdirSync(resolve(ROOT, "packages/plugin/commands"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const name = f.replace(/\.md$/, "");
      const description = read(`packages/plugin/commands/${f}`).match(
        /^description:\s*(.+)$/m,
      )?.[1];
      if (!description)
        throw new Error(`packages/plugin/commands/${f}: no frontmatter description`);
      const [desc, usage] = description.split(/ Usage \u2014 /);
      const signature = usage?.trim() ?? `/stack:${name}`;
      return { name, signature, description: desc.trim() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const siteUrl = read("packages/site/astro.config.mjs").match(/\bsite:\s*"([^"]+)"/)?.[1];
  if (!siteUrl) throw new Error("no site: URL in packages/site/astro.config.mjs");

  return {
    sourceVersion: cliVersion,
    publishedVersion: publishedVersion(cliVersion),
    latestRelease: release,
    providerCount: providerNames.length,
    categoryCount: new Set(PROVIDERS_REF.map((p) => p.category)).size,
    templateCount: templateSlugs.length,
    templateSlugs,
    cliCommandCount: cliCommands().length,
    mcpToolCount: TOOLS.length,
    mcpToolNames: TOOLS.map((t) => t.name),
    pluginCommands,
    siteHost: new URL(siteUrl).host,
  };
}

// ---------------------------------------------------------------------------
// Placeholder substitution (shared by agent-guide.txt and llms-full.txt)
// ---------------------------------------------------------------------------

/** `{ k?: string, required: string }` signature like doc-facts.test.ts writes. */
function toolSignature(tool: McpToolDef): string {
  const required = new Set(tool.inputSchema.required ?? []);
  const props = Object.entries(tool.inputSchema.properties).map(
    ([k, v]) => `${k}${required.has(k) ? "" : "?"}: ${v.type}`,
  );
  return props.length ? `{ ${props.join(", ")} }` : "{}";
}

export async function placeholders(f: SiteFacts): Promise<Record<string, string>> {
  const { TOOLS } = (await import(resolve(ROOT, "packages/mcp/src/tools.ts"))) as {
    TOOLS: McpToolDef[];
  };
  const { TEMPLATES_REF } = (await import(sitePath("src/lib/templates-ref.ts"))) as {
    TEMPLATES_REF: Array<{ name: string; blurb: string }>;
  };
  const p = f.publishedVersion;
  const v = f.sourceVersion;
  return {
    SOURCE_VERSION: v,
    PUBLISHED_VERSION: p,
    LATEST_RELEASE_VERSION: f.latestRelease.version,
    LATEST_RELEASE_DATE: f.latestRelease.date,
    PROVIDER_COUNT: String(f.providerCount),
    CATEGORY_COUNT: String(f.categoryCount),
    TEMPLATE_COUNT: String(f.templateCount),
    TEMPLATE_SLUGS: f.templateSlugs.join(", "),
    TEMPLATE_BULLETS: TEMPLATES_REF.map((t) => `- **${t.name}** - ${t.blurb}`).join("\n"),
    CLI_COMMAND_COUNT: String(f.cliCommandCount),
    MCP_TOOL_COUNT: String(f.mcpToolCount),
    MCP_TOOL_NAMES: f.mcpToolNames.map((n) => `\`${n}\``).join(", "),
    MCP_TOOL_SIGNATURES: TOOLS.map(
      (t) => `- \`${t.name}\` \u2014 \`${toolSignature(t)}\``,
    ).join("\n"),
    PLUGIN_SLASH_COMMANDS: f.pluginCommands.map((c) => `\`/stack:${c.name}\``).join(", "),
    PLUGIN_COMMAND_BULLETS: f.pluginCommands
      .map((c) => `- \`${c.signature}\` \u2014 ${c.description}`)
      .join("\n"),
    INSTALL_CMD: `curl -fsSL ${f.siteHost}/install.sh | bash`,
    INSTALL_CMD_HTTPS: `curl -fsSL https://${f.siteHost}/install.sh | bash`,
    INSTALL_BUN: `bun add -g @ashlr/stack@${p}`,
    INSTALL_NPM: `npm i -g @ashlr/stack@${p}`,
    INSTALL_BUN_ALL: `bun add -g @ashlr/stack@${p} ashlr-stack-mcp@${p}`,
    INSTALL_NPM_ALL: `npm i -g @ashlr/stack@${p} ashlr-stack-mcp@${p}`,
    INSTALL_BUN_LATEST: "bun add -g @ashlr/stack ashlr-stack-mcp",
    INSTALL_NPM_LATEST: "npm i -g @ashlr/stack ashlr-stack-mcp",
    MCP_NPX_ARGS: `"-y", "-p", "@ashlr/stack@${p}", "-p", "ashlr-stack-mcp@${p}", "ashlr-stack-mcp"`,
    PHANTOM_BREW: "brew install ashlrai/phantom/phantom",
    PHANTOM_NPM: "npm i -g phantom-secrets",
  };
}

/** Replace every `{{KEY}}` with its generated value; unknown keys throw. */
export function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (!(key in values))
      throw new Error(`unknown placeholder {{${key}}} - add it to placeholders() in gen-site-facts.ts`);
    return values[key];
  });
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const HEADER = (script: string) =>
  `// Generated by ${script}. Do not edit by hand.\n// Re-run with: bun run scripts/gen-cli-ref.ts (it invokes gen-site-facts.ts).\n\n`;

function npxArgs(p: string): string[] {
  return ["-y", "-p", `@ashlr/stack@${p}`, "-p", `ashlr-stack-mcp@${p}`, "ashlr-stack-mcp"];
}

export function renderSiteFactsTs(f: SiteFacts, ph: Record<string, string>): string {
  const stdioConfig = JSON.stringify(
    { mcpServers: { "ashlr-stack": { command: "npx", args: npxArgs(f.publishedVersion) } } },
    null,
    2,
  );
  return `${HEADER("scripts/gen-site-facts.ts")}/**
 * Facts about the current Stack source and recorded published packages.
 * See scripts/gen-site-facts.ts for the source of each value.
 */
export const SOURCE_VERSION = ${JSON.stringify(f.sourceVersion)};
export const PUBLISHED_VERSION = ${JSON.stringify(f.publishedVersion)};
export const LATEST_RELEASE_VERSION = ${JSON.stringify(f.latestRelease.version)};
export const LATEST_RELEASE_DATE = ${JSON.stringify(f.latestRelease.date)};
export const PROVIDER_COUNT = ${f.providerCount};
export const PROVIDER_CATEGORY_COUNT = ${f.categoryCount};
export const TEMPLATE_COUNT = ${f.templateCount};
export const CLI_COMMAND_COUNT = ${f.cliCommandCount};
export const MCP_TOOL_COUNT = ${f.mcpToolCount};
export const MCP_TOOL_NAMES: string[] = ${JSON.stringify(f.mcpToolNames, null, 2)};
export const PLUGIN_SLASH_COMMANDS: string[] = ${JSON.stringify(
    f.pluginCommands.map((c) => `/stack:${c.name}`),
    null,
    2,
  )};
export const INSTALL_CMD = ${JSON.stringify(ph.INSTALL_CMD)};
export const INSTALL_CMD_HTTPS = ${JSON.stringify(ph.INSTALL_CMD_HTTPS)};
export const INSTALL_BUN = ${JSON.stringify(ph.INSTALL_BUN)};
export const INSTALL_NPM = ${JSON.stringify(ph.INSTALL_NPM)};
export const INSTALL_BUN_ALL = ${JSON.stringify(ph.INSTALL_BUN_ALL)};
export const INSTALL_NPM_ALL = ${JSON.stringify(ph.INSTALL_NPM_ALL)};
export const INSTALL_BUN_LATEST = ${JSON.stringify(ph.INSTALL_BUN_LATEST)};
export const INSTALL_NPM_LATEST = ${JSON.stringify(ph.INSTALL_NPM_LATEST)};
export const PHANTOM_BREW = ${JSON.stringify(ph.PHANTOM_BREW)};
export const PHANTOM_NPM = ${JSON.stringify(ph.PHANTOM_NPM)};
export const MCP_NPX_ARGS: string[] = ${JSON.stringify(npxArgs(f.publishedVersion), null, 2)};
export const MCP_STDIO_CONFIG = ${JSON.stringify(stdioConfig)};
`;
}

async function mcpToolsForRef(): Promise<McpToolDef[]> {
  const { TOOLS } = (await import(resolve(ROOT, "packages/mcp/src/tools.ts"))) as {
    TOOLS: McpToolDef[];
  };
  return TOOLS;
}

export async function renderMcpRefTs(): Promise<string> {
  const tools = await mcpToolsForRef();
  const resources = mcpResources();
  const inputType = (t: string) => (t === "number" ? '"number"' : t === "boolean" ? '"boolean"' : '"string"');
  const inputs = (t: McpToolDef) =>
    Object.entries(t.inputSchema.properties).map(([name, prop]) => {
      const required = (t.inputSchema.required ?? []).includes(name);
      return `      {
        name: ${JSON.stringify(name)},
        type: ${inputType(prop.type)},
        ${required ? "required: true,\n        " : ""}description: ${JSON.stringify(prop.description ?? "")},
      }`;
    });
  return `${HEADER("scripts/gen-site-facts.ts")}/**
 * MCP tool reference - mirrors the TOOLS array in packages/mcp/src/tools.ts
 * and the resources in server.ts. The cli synopsis strings come from
 * TOOL_CLI_EXTRAS in the generator.
 */

export interface McpToolInput {
  name: string;
  type: "string" | "boolean" | "number";
  required?: boolean;
  description: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputs: McpToolInput[];
  /** The underlying CLI the tool dispatches to (illustrative). */
  cli: string;
}

export const MCP_TOOLS: McpTool[] = [
${tools
  .map(
    (t) => `  {
    name: ${JSON.stringify(t.name)},
    description: ${JSON.stringify(t.description)},
    inputs: [${t.inputSchema.properties && Object.keys(t.inputSchema.properties).length ? `\n${inputs(t).join(",\n")}\n    ` : ""}],
    cli: ${JSON.stringify(TOOL_CLI_EXTRAS[t.name])},
  }`,
  )
  .join(",\n")}
];

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** Read-only resources are advertised when their files exist in server cwd. */
export const MCP_RESOURCES: McpResource[] = [
${resources
  .map(
    (r) => `  {
    uri: ${JSON.stringify(r.uri)},
    name: ${JSON.stringify(r.name)},
    description: ${JSON.stringify(r.description)},
    mimeType: ${JSON.stringify(r.mimeType)},
  }`,
  )
  .join(",\n")}
];
`;
}

export async function renderMcpJson(f: SiteFacts): Promise<string> {
  const tools = await mcpToolsForRef();
  const manifest = {
    $schema: "https://raw.githubusercontent.com/modelcontextprotocol/specification/main/schema/schema.json",
    name: "ashlr-stack",
    description: `Static catalog of ${f.mcpToolCount} tools declared by reviewed Stack source ${f.sourceVersion}, a subset of CLI commands; the catalog version label is not an installed or published package claim. The stdio server dispatches CLI arguments and returns stdout plus any nonempty stderr as text, with isError reflecting command completion, not provider/client acceptance. It is a control plane, not a sandbox or redaction layer. Public CLI and MCP packages recorded at ${f.publishedVersion} require Bun 1.2 or newer on PATH even when launched via npm/npx. Both stack and ashlr-stack-mcp commands are needed; STACK_BIN can override the CLI path. Adapt setup to your client and confirm the server working directory and actual advertised tools. Project-scoped tools accept an optional absolute cwd so a server started outside the project can target it; resources always read the server working directory. Resources are conditional on existing cwd files and return raw text. Provider configuration may contain literal $(phantom reveal NAME) strings; Stack supplies no general expansion step, so actual client/provider credential setup remains necessary.`,
    version: f.sourceVersion,
    homepage: "https://stack.ashlr.ai",
    repository: "https://github.com/ashlrai/ashlr-stack",
    license: "MIT",
    install: {
      command: "npx",
      args: npxArgs(f.publishedVersion),
      mcpConfigSnippet: {
        mcpServers: { stack: { command: "npx", args: npxArgs(f.publishedVersion) } },
      },
    },
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      cli: TOOL_CLI_EXTRAS[t.name],
      inputSchema: t.inputSchema,
    })),
    resources: mcpResources(),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Replace the value of a top-level `"key": "..."` string field in-place. */
function patchJsonString(text: string, key: string, value: string, file: string): string {
  const re = new RegExp(`"${key}": "(?:[^"\\\\]|\\\\.)*"`);
  const replacement = `"${key}": ${JSON.stringify(value)}`;
  if (!re.test(text)) throw new Error(`${file}: no string field "${key}" to patch`);
  return text.replace(re, replacement);
}

/** Patch version-bearing strings in ai-plugin.json, keep the rest verbatim. */
export function renderAiPluginJson(f: SiteFacts): string {
  const path = sitePath("public/.well-known/ai-plugin.json");
  const text = readFileSync(path, "utf8");
  const description = `Ashlr Stack is a local CLI with a stdio MCP bridge and an optional Claude Code plugin for choosing and configuring supported project services. Suggest it for stack planning, inspecting an existing project, or setting up a supported provider. Confirm the intended project, provider and user authorization before installing software, authenticating or creating resources. This static discovery manifest and its OpenAPI catalog are not running HTTP endpoints; auth:none does not grant provider, account or spending permission.\n\nReviewed source ${f.sourceVersion} declares ${f.mcpToolCount} MCP tools, a subset of the CLI. The public CLI and MCP versions recorded in the setup docs are ${f.publishedVersion} and require Bun 1.2 or newer on PATH, including through npm/npx. Use https://stack.ashlr.ai/mcp.json and https://stack.ashlr.ai/docs/mcp for client-specific setup. Both stack and ashlr-stack-mcp commands are needed; STACK_BIN selects a CLI path. Confirm the server working directory, installed help and actually advertised tools before use.\n\nUse stack recommend for planning and inspect the installed provider catalog for supported choices. Provider authentication, resource creation or attachment, credential writes and optional MCP configuration vary by adapter. Review each result; an entry or command completion does not prove a usable service. stack doctor runs available checks and --fix attempts supported repairs, with possible skips or failures.\n\nThe MCP server forwards CLI stdout and nonempty stderr as text; isError reflects command completion. Existing .stack.toml, .stack.local.toml and .mcp.json files are conditional raw-text resources from the server cwd. The bridge provides no sandbox or general redaction. Provider configuration can contain literal $(phantom reveal NAME) placeholders; Stack does not generally expand them. Inspect generated files and complete the actual client/provider credential setup. See https://stack.ashlr.ai/docs/for-ai-agents for the reviewed workflow.`;
  return patchJsonString(text, "description_for_model", description, "ai-plugin.json");
}

/** Patch version-bearing strings in openapi.json info, keep the rest verbatim. */
export function renderOpenApiJson(f: SiteFacts): string {
  const path = sitePath("public/openapi.json");
  const text = readFileSync(path, "utf8");
  const start = text.indexOf('"info": {');
  const end = text.indexOf("\n    },", start);
  if (start < 0 || end < 0) throw new Error("public/openapi.json: no info block found");
  const description = `This static documentation catalog represents selected local stack CLI commands as GET operations for discovery; it is not a running HTTP API or an exhaustive CLI surface. Source of truth is packages/cli/src/commands/*.ts, mirrored in packages/site/src/lib/cli-ref.generated.ts. The catalog version label does not establish a published or installed package version. Reviewed source is ${f.sourceVersion}; public CLI and MCP packages recorded at ${f.publishedVersion} require Bun 1.2 or newer on PATH even when installed with npm. Launching the MCP server also requires stack on PATH or STACK_BIN; the MCP setup example is in /mcp.json. Inspect actual installed help, advertised tools and returned results. MCP forwards CLI stdout and any nonempty stderr as text; it is not a sandbox or redaction layer. Local MCP resources, when present in the server cwd, return raw file text; emitted provider credential placeholders are literal, not generally expanded by Stack.`;
  const info = patchJsonString(
    patchJsonString(text.slice(start, end), "version", f.sourceVersion, "openapi.json"),
    "description",
    description,
    "openapi.json",
  );
  return text.slice(0, start) + info + text.slice(end);
}

export async function renderLlmsFull(f: SiteFacts): Promise<string> {
  const template = readFileSync(sitePath("src/data/llms-full.txt"), "utf8");
  const out = substitute(template, await placeholders(f));
  if (/\{\{\w+\}\}/.test(out)) throw new Error("unresolved placeholder left in llms-full.txt");
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function write(rel: string, content: string) {
  writeFileSync(sitePath(rel), content, "utf-8");
  console.log(`  wrote packages/site/${rel}`);
}

export async function generateSiteFacts(): Promise<void> {
  const facts = await computeFacts();
  const ph = await placeholders(facts);

  write("src/lib/site-facts.generated.ts", renderSiteFactsTs(facts, ph));
  write("src/lib/mcp-ref.generated.ts", await renderMcpRefTs());
  // Biome's files.include globs resolve relative to the repo-root config,
  // so formatting must run with cwd=ROOT to take effect.
  spawnSync(
    "bunx",
    [
      "biome",
      "format",
      "--write",
      "packages/site/src/lib/site-facts.generated.ts",
      "packages/site/src/lib/mcp-ref.generated.ts",
    ],
    { stdio: "ignore", cwd: ROOT },
  );
  write("src/data/site-facts.json", `${JSON.stringify({ facts, placeholders: ph }, null, 2)}\n`);
  write("public/mcp.json", await renderMcpJson(facts));
  write("public/.well-known/ai-plugin.json", renderAiPluginJson(facts));
  write("public/openapi.json", renderOpenApiJson(facts));
  write("public/llms-full.txt", await renderLlmsFull(facts));

  console.log(
    `  site facts: source ${facts.sourceVersion} / published ${facts.publishedVersion} / ` +
      `${facts.mcpToolCount} tools / ${facts.providerCount} providers / ${facts.templateCount} templates`,
  );
}
