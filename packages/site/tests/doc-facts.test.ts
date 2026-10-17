/**
 * Doc facts: counts and lists that agent-facing docs state about the code.
 *
 * Each claim is derived from its source of truth (the CLI's subCommands, the
 * MCP `TOOLS` array, the provider registry, the templates directory, ...) and
 * compared with what the doc says, so a stale doc fails here with the file and
 * line to fix. The CLI reference itself is pinned by `cli-ref.test.ts`.
 * No network, no subprocesses.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS_REF } from "../../core/src/catalog";
import { listProviderNames } from "../../core/src/providers/index";
import { listTemplates } from "../../core/src/templates";
import { TOOLS } from "../../mcp/src/tools";
import { MCP_RESOURCES, MCP_TOOLS } from "../src/lib/mcp-ref";

const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const toNumber = (s: string) => WORDS[s.toLowerCase()] ?? Number(s);

/** Top-level command names from the `subCommands` block of packages/cli/src/index.ts. */
function cliCommands(): string[] {
  const src = read("packages/cli/src/index.ts");
  const block = src.match(/\n {2}subCommands: \{\n([\s\S]*?)\n {2}\},/);
  if (!block) throw new Error("no subCommands block in packages/cli/src/index.ts");
  return [...block[1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
}

/** Resource URIs the MCP server can list (packages/mcp/src/server.ts). */
function serverResourceUris(): string[] {
  return [...read("packages/mcp/src/server.ts").matchAll(/uri: "(stack:\/\/[^"]+)"/g)].map((m) => m[1]);
}

/** Slash commands shipped by the Claude Code plugin (packages/plugin/commands/*.md). */
function pluginCommands(): string[] {
  return readdirSync(join(ROOT, "packages/plugin/commands"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

/**
 * Every match of `pattern` (first capture group = the stated number) in `file`
 * must equal `actual`. Fails if the phrase is gone, so a reworded doc updates
 * this test instead of silently dropping the check.
 */
function expectCount(file: string, pattern: RegExp, actual: number, what: string) {
  const lines = read(file).split("\n");
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let found = 0;
  lines.forEach((line, i) => {
    for (const m of line.matchAll(re)) {
      found++;
      const stated = toNumber(m[1]);
      if (stated !== actual) {
        throw new Error(`${file}:${i + 1} says "${m[0]}" but the code has ${actual} ${what}; fix that line.`);
      }
    }
  });
  if (found === 0) throw new Error(`${file}: no line matches ${pattern}; the doc was reworded, update doc-facts.test.ts.`);
}

/** Inline-code names (`a`, `b`, ...) on the first line of `file` matching `marker`. */
function codeListOn(file: string, marker: RegExp): { line: number; names: string[] } {
  const lines = read(file).split("\n");
  const i = lines.findIndex((l) => marker.test(l));
  if (i < 0) throw new Error(`${file}: no line matches ${marker}; update doc-facts.test.ts.`);
  return { line: i + 1, names: [...lines[i].matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
}

const commands = cliCommands();
const toolNames = TOOLS.map((t) => t.name);
const providerNames = listProviderNames();
const categories = new Set(PROVIDERS_REF.map((p) => p.category));
const templates = listTemplates();
const resourceUris = serverResourceUris();

/** `{ a: string, b?: boolean }` signature of a tool's input schema, as llms-full.txt writes it. */
function signature(tool: (typeof TOOLS)[number]): string {
  const required = new Set(tool.inputSchema.required ?? []);
  const props = Object.entries(tool.inputSchema.properties).map(
    ([k, v]) => `${k}${required.has(k) ? "" : "?"}: ${v.type}`,
  );
  return props.length ? `{ ${props.join(", ")} }` : "{}";
}

describe("doc facts: sources of truth are sane", () => {
  test("the derived values are non-empty", () => {
    expect(commands.length).toBeGreaterThan(0);
    expect(toolNames.length).toBeGreaterThan(0);
    expect(providerNames.length).toBeGreaterThan(0);
    expect(templates.length).toBeGreaterThan(0);
    expect(resourceUris.length).toBeGreaterThan(0);
  });

  test("the provider catalog covers exactly the registered providers", () => {
    expect(PROVIDERS_REF.map((p) => p.name).sort()).toEqual(providerNames);
  });
});

describe("doc facts: CLI commands", () => {
  test("STACK.md command count matches packages/cli/src/index.ts subCommands", () => {
    expectCount("STACK.md", /\b(\d+) CLI commands\b/, commands.length, "top-level commands");
  });
});

describe("doc facts: MCP tools", () => {
  const n = toolNames.length;
  test("tool counts match packages/mcp/src/tools.ts TOOLS", () => {
    expectCount("STACK.md", /\b(\d+) MCP tools\b/, n, "MCP tools");
    expectCount("packages/mcp/README.md", /\bExposes (\d+) tools\b/, n, "MCP tools");
    expectCount("packages/mcp/package.json", /\bExposes (\d+) tools\b/, n, "MCP tools");
    expectCount("packages/site/public/mcp.json", /\bcatalog of (\d+) tools\b/, n, "MCP tools");
    expectCount("packages/site/public/llms.txt", /\b(\d+) declared MCP tools\b/, n, "MCP tools");
    expectCount("packages/site/public/llms.txt", /\bexposes these (\d+) tools\b/, n, "MCP tools");
    expectCount("packages/site/public/llms-full.txt", /\bdeclares these (\d+) tools\b/, n, "MCP tools");
    expectCount("packages/site/public/.well-known/ai-plugin.json", /\bdeclares (\d+) MCP tools\b/, n, "MCP tools");
  });

  test("packages/site/src/lib/mcp-ref.ts MCP_TOOLS mirrors TOOLS (names, descriptions, inputs)", () => {
    const fromTools = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputs: Object.entries(t.inputSchema.properties).map(([name, p]) => ({
        name,
        type: p.type,
        required: (t.inputSchema.required ?? []).includes(name),
      })),
    }));
    const fromRef = MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputs: t.inputs.map((i) => ({ name: i.name, type: i.type as string, required: i.required === true })),
    }));
    expect(fromRef).toEqual(fromTools);
  });

  test("packages/site/public/mcp.json tools mirror TOOLS (names, descriptions, inputSchema)", () => {
    const manifest = JSON.parse(read("packages/site/public/mcp.json")) as {
      tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, { type: string }>; required?: string[] } }>;
    };
    const shape = (name: string, description: string, s: { properties: Record<string, { type: string }>; required?: string[] }) => ({
      name,
      description,
      properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, v.type])),
      required: [...(s.required ?? [])].sort(),
    });
    expect(manifest.tools.map((t) => shape(t.name, t.description, t.inputSchema))).toEqual(
      TOOLS.map((t) => shape(t.name, t.description, t.inputSchema)),
    );
  });

  test("packages/site/public/llms.txt lists exactly the TOOLS names", () => {
    const { line, names } = codeListOn("packages/site/public/llms.txt", /exposes these \d+ tools/);
    expect(names, `packages/site/public/llms.txt:${line}`).toEqual(toolNames);
  });

  test("packages/site/public/llms-full.txt gives each tool's input signature", () => {
    const lines = read("packages/site/public/llms-full.txt").split("\n");
    const listed = lines
      .map((l, i) => ({ i, m: l.match(/^- `(stack_\w+)` — `(\{.*\})`$/) }))
      .filter((x) => x.m);
    expect(listed.map((x) => x.m?.[1]), "packages/site/public/llms-full.txt tool list").toEqual(toolNames);
    for (const { i, m } of listed) {
      const tool = TOOLS.find((t) => t.name === m?.[1]);
      if (!tool) continue;
      expect(m?.[2], `packages/site/public/llms-full.txt:${i + 1}`).toBe(signature(tool));
    }
  });

  test("packages/mcp/README.md groups every tool exactly once", () => {
    const lines = read("packages/mcp/README.md").split("\n");
    const grouped = lines
      .filter((l) => /^(Provisioning|Inspection|Env|Planning|Project registry): /.test(l))
      .flatMap((l) => [...l.split(".")[0].matchAll(/`(stack_\w+)`/g)].map((m) => m[1]));
    expect(grouped.sort(), "packages/mcp/README.md tool groups").toEqual([...toolNames].sort());
  });
});

describe("doc facts: MCP resources", () => {
  test("resource lists and counts match packages/mcp/src/server.ts", () => {
    expect(MCP_RESOURCES.map((r) => r.uri), "packages/site/src/lib/mcp-ref.ts MCP_RESOURCES").toEqual(resourceUris);
    const manifest = JSON.parse(read("packages/site/public/mcp.json")) as { resources: Array<{ uri: string }> };
    expect(manifest.resources.map((r) => r.uri), "packages/site/public/mcp.json resources").toEqual(resourceUris);
    expectCount("packages/mcp/README.md", /\bup to (\d+) resources\b/, resourceUris.length, "MCP resources");
    expectCount("packages/mcp/package.json", /\band (\d+) resources\b/, resourceUris.length, "MCP resources");
  });
});

describe("doc facts: providers", () => {
  const n = providerNames.length;
  const c = categories.size;
  test("provider counts match packages/core/src/providers/index.ts", () => {
    expectCount("STACK.md", /\b(\d+) providers in \d+ categories\b/, n, "providers");
    expectCount("README.md", /\bregisters (\d+) providers\b/, n, "providers");
    expectCount("packages/cli/README.md", /\bregisters (\d+) providers\b/, n, "providers");
    expectCount("packages/site/public/llms.txt", /\b(\d+) providers across \d+ categories\b/, n, "providers");
    expectCount("packages/site/public/llms-full.txt", /\bregisters (\d+) providers\b/, n, "providers");
    expectCount("docs/provider-auth-matrix.md", /\((\d+) providers\)/, n, "providers");
  });

  test("category counts match packages/core/src/catalog.ts PROVIDERS_REF", () => {
    expectCount("STACK.md", /\bproviders in (\d+) categories\b/, c, "categories");
    expectCount("README.md", /\bproviders across (\d+) categories\b/, c, "categories");
    expectCount("packages/site/public/llms.txt", /\bproviders across (\d+) categories\b/, c, "categories");
    expectCount("packages/site/public/llms-full.txt", /\bproviders across (\d+) categories\b/, c, "categories");
  });
});

describe("doc facts: templates", () => {
  test("llms.txt preset count and slugs match templates/", () => {
    expectCount("packages/site/public/llms.txt", /\b(\d+) provider presets\b/, templates.length, "templates");
    expectCount("packages/site/public/llms.txt", /\btemplate picker \((\d+) starters\)/, templates.length, "templates");
    const line = read("packages/site/public/llms.txt")
      .split("\n")
      .find((l) => l.includes("stack init --template <slug>` (templates:"));
    const slugs = line?.match(/\(templates: ([^)]+)\)/)?.[1].split(", ") ?? [];
    expect(slugs.sort(), "packages/site/public/llms.txt template slugs").toEqual(templates);
  });
});

describe("doc facts: Claude Code plugin", () => {
  test("packages/plugin/README.md lists exactly the commands/*.md slash commands", () => {
    const cmds = pluginCommands();
    expectCount("packages/plugin/README.md", /\bwith (\w+) slash-command files\b/, cmds.length, "slash-command files");
    const listed = [...read("packages/plugin/README.md").matchAll(/^- `\/stack:([\w-]+)/gm)].map((m) => m[1]);
    expect(listed.sort(), "packages/plugin/README.md slash-command list").toEqual(cmds);
  });
});
