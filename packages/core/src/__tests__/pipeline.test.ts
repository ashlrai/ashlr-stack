import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProvider, listProviderNames } from "../providers/index.ts";

/**
 * Pipeline sanity checks — load every registered provider so a broken import
 * in any provider shows up immediately, even without Phantom or real API keys.
 */
describe("provider registry", () => {
  test("lists a curated catalog", () => {
    const names = listProviderNames();
    expect(names.length).toBeGreaterThanOrEqual(15);
    // Spot-check the core four that define the product thesis.
    expect(names).toContain("supabase");
    expect(names).toContain("openai");
    expect(names).toContain("vercel");
    expect(names).toContain("github");
  });

  test("every provider loads and exposes the Provider contract", async () => {
    for (const name of listProviderNames()) {
      const p = await getProvider(name);
      expect(p.name).toBe(name);
      expect(typeof p.displayName).toBe("string");
      expect(typeof p.login).toBe("function");
      expect(typeof p.provision).toBe("function");
      expect(typeof p.materialize).toBe("function");
    }
  });

  test("getProvider rejects unknown names", async () => {
    await expect(getProvider("not-a-real-provider")).rejects.toThrow(/PROVIDER_NOT_FOUND|No provider/);
  });
});

describe("templates", () => {
  test("templates directory resolves inside the monorepo", async () => {
    const { resolveTemplatesDir, loadTemplate } = await import("../templates.ts");
    const dir = resolveTemplatesDir();
    expect(dir).toBeDefined();
    const template = await loadTemplate("nextjs-supabase-posthog");
    expect(template).toBeDefined();
    expect(template?.services.supabase?.provider).toBe("supabase");
  });

  test("loadTemplate returns undefined for unknown names", async () => {
    const { loadTemplate } = await import("../templates.ts");
    const result = await loadTemplate("not-real");
    expect(result).toBeUndefined();
  });
});

describe("mcp-writer", () => {
  test("mergeMcpEntry creates .mcp.json with the entry", async () => {
    const { mergeMcpEntry } = await import("../mcp-writer.ts");
    const cwd = mkdtempSync(join(tmpdir(), "stack-mcp-"));
    await mergeMcpEntry(
      {
        name: "supabase",
        type: "stdio",
        command: "npx",
        args: ["-y", "@supabase/mcp-server-supabase"],
      },
      cwd,
    );
    const raw = await Bun.file(join(cwd, ".mcp.json")).text();
    const parsed = JSON.parse(raw) as { mcpServers: Record<string, { command: string }> };
    expect(parsed.mcpServers.supabase.command).toBe("npx");
  });

  test("mergeMcpEntry preserves unrelated keys in an existing file", async () => {
    const { mergeMcpEntry } = await import("../mcp-writer.ts");
    const cwd = mkdtempSync(join(tmpdir(), "stack-mcp-"));
    writeFileSync(
      join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: { other: { command: "echo" } },
        customKey: "keep-me",
      }),
    );
    await mergeMcpEntry({ name: "new-one", type: "stdio", command: "npx" }, cwd);
    const parsed = JSON.parse(await Bun.file(join(cwd, ".mcp.json")).text()) as {
      mcpServers: Record<string, unknown>;
      customKey: string;
    };
    expect(parsed.mcpServers.other).toBeDefined();
    expect(parsed.mcpServers["new-one"]).toBeDefined();
    expect(parsed.customKey).toBe("keep-me");
  });
});
