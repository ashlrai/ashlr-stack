import { describe, expect, test } from "bun:test";
import cli from "../../../cli/package.json";
import mcp from "../../../mcp/package.json";
import plugin from "../../../plugin/.claude-plugin/plugin.json";
import core from "../../package.json";
import { STACK_MANIFEST, type StackManifest } from "../index.ts";
import fixture from "./fixtures/stack-manifest.v1.json";

describe("Stack ecosystem manifest v1", () => {
  test("public export preserves the fixture's JSON wire contract", () => {
    const manifest: StackManifest = STACK_MANIFEST;
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(fixture);
  });

  test("every distributable matches its source name and version", () => {
    const metadata = { core, cli, mcp, plugin };
    const manifest: StackManifest = STACK_MANIFEST;
    expect(Object.keys(metadata).sort()).toEqual(manifest.components.map(({ id }) => id).sort());
    for (const component of manifest.components) {
      expect(component.name).toBe(metadata[component.id].name);
      expect(component.version).toBe(metadata[component.id].version);
      expect(component.version).toMatch(/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/);
    }
  });

  test("component IDs are unique", () => {
    const ids = STACK_MANIFEST.components.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("shared metadata cannot be mutated by consumers", () => {
    expect(Object.isFrozen(STACK_MANIFEST)).toBe(true);
    expect(Object.isFrozen(STACK_MANIFEST.components)).toBe(true);
    for (const component of STACK_MANIFEST.components) {
      expect(Object.isFrozen(component)).toBe(true);
    }
  });
});
