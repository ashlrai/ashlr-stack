import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMcpEntry, removeMcpEntry } from "../mcp-writer.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "stack-mirror-"));
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

describe("mcp-writer client mirroring", () => {
  test("does not create client dirs that are absent", async () => {
    const cwd = tmp();
    await mergeMcpEntry({ name: "s", type: "stdio", command: "npx" }, cwd);
    expect(existsSync(join(cwd, ".mcp.json"))).toBe(true);
    expect(existsSync(join(cwd, ".cursor"))).toBe(false);
    expect(existsSync(join(cwd, ".gemini"))).toBe(false);
  });

  test("mirrors into .cursor/mcp.json and .gemini/settings.json when dirs exist", async () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".cursor"));
    mkdirSync(join(cwd, ".gemini"));
    writeFileSync(
      join(cwd, ".gemini", "settings.json"),
      JSON.stringify({ theme: "dark", mcpServers: { other: { command: "o" } } }),
    );
    await mergeMcpEntry(
      { name: "s", type: "stdio", command: "npx", args: ["-y", "x"], env: { K: "v" } },
      cwd,
    );
    const g = readJson(join(cwd, ".gemini", "settings.json"));
    expect(g.theme).toBe("dark");
    expect(g.mcpServers.other.command).toBe("o");
    expect(g.mcpServers.s).toEqual({ command: "npx", args: ["-y", "x"], env: { K: "v" } });
    expect(readJson(join(cwd, ".cursor", "mcp.json")).mcpServers.s.command).toBe("npx");
    // idempotent
    await mergeMcpEntry(
      { name: "s", type: "stdio", command: "npx", args: ["-y", "x"], env: { K: "v" } },
      cwd,
    );
    expect(Object.keys(readJson(join(cwd, ".gemini", "settings.json")).mcpServers).sort()).toEqual([
      "other",
      "s",
    ]);
  });

  test("gemini uses httpUrl for http and url for sse, with no type field", async () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".gemini"));
    await mergeMcpEntry({ name: "h", type: "http", url: "https://a.example/mcp" }, cwd);
    await mergeMcpEntry({ name: "e", type: "sse", url: "https://b.example/sse" }, cwd);
    const m = readJson(join(cwd, ".gemini", "settings.json")).mcpServers;
    expect(m.h).toEqual({ httpUrl: "https://a.example/mcp" });
    expect(m.e).toEqual({ url: "https://b.example/sse" });
    expect(readJson(join(cwd, ".mcp.json")).mcpServers.h.type).toBe("http");
  });

  test("a malformed sibling config is left untouched and does not fail the write", async () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".gemini"));
    writeFileSync(join(cwd, ".gemini", "settings.json"), "{not json");
    await mergeMcpEntry({ name: "s", type: "stdio", command: "npx" }, cwd);
    expect(readFileSync(join(cwd, ".gemini", "settings.json"), "utf-8")).toBe("{not json");
    expect(readJson(join(cwd, ".mcp.json")).mcpServers.s.command).toBe("npx");
  });

  test("removeMcpEntry removes from mirrors and keeps other entries", async () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".cursor"));
    mkdirSync(join(cwd, ".gemini"));
    await mergeMcpEntry({ name: "a", type: "stdio", command: "x" }, cwd);
    await mergeMcpEntry({ name: "b", type: "stdio", command: "y" }, cwd);
    await removeMcpEntry("a", cwd);
    for (const p of [
      join(cwd, ".mcp.json"),
      join(cwd, ".cursor", "mcp.json"),
      join(cwd, ".gemini", "settings.json"),
    ]) {
      const m = readJson(p).mcpServers;
      expect(m.a).toBeUndefined();
      expect(m.b.command).toBe("y");
    }
  });
});
