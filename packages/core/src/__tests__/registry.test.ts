import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, writeConfig } from "../config.ts";
import {
  findProjectByName,
  listProjects,
  registerProject,
  registryPath,
  unregisterProject,
} from "../registry.ts";

describe("cross-project registry", () => {
  let previousDir: string | undefined;

  beforeEach(() => {
    previousDir = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = mkdtempSync(join(tmpdir(), "stack-registry-"));
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.STACK_REGISTRY_DIR;
    else process.env.STACK_REGISTRY_DIR = previousDir;
  });

  test("registryPath honors STACK_REGISTRY_DIR override", () => {
    expect(registryPath().startsWith(process.env.STACK_REGISTRY_DIR!)).toBe(true);
  });

  test("writeConfig auto-registers the cwd", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stack-auto-reg-"));
    await writeConfig(emptyConfig("auto"), cwd);
    const projects = await listProjects();
    expect(projects.length).toBe(1);
    expect(projects[0].path).toBe(cwd);
    expect(projects[0].template).toBe("auto");
  });

  test("registerProject noops on directories without .stack.toml", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stack-bare-"));
    const entry = await registerProject(cwd);
    expect(entry).toBeUndefined();
    const projects = await listProjects();
    expect(projects.length).toBe(0);
  });

  test("findProjectByName finds exact and case-insensitive matches", async () => {
    const cwd1 = mkdtempSync(join(tmpdir(), "stack-alpha-"));
    const cwd2 = mkdtempSync(join(tmpdir(), "stack-beta-"));
    await writeConfig(emptyConfig(), cwd1);
    await writeConfig(emptyConfig(), cwd2);
    const all = await listProjects();
    const firstName = all[0].name;
    const found = await findProjectByName(firstName);
    expect(found?.path).toBe(all[0].path);
    const foundCaseInsensitive = await findProjectByName(firstName.toUpperCase());
    expect(foundCaseInsensitive?.path).toBe(all[0].path);
  });

  test("unregisterProject removes without deleting files", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stack-unreg-"));
    await writeConfig(emptyConfig(), cwd);
    expect((await listProjects()).length).toBe(1);
    await unregisterProject(cwd);
    expect((await listProjects()).length).toBe(0);
  });

  test("listProjects prunes entries whose .stack.toml was deleted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stack-prune-"));
    await writeConfig(emptyConfig(), cwd);
    // Simulate the file vanishing out from under us.
    const { rmSync } = await import("node:fs");
    rmSync(join(cwd, ".stack.toml"));
    const projects = await listProjects();
    expect(projects.length).toBe(0);
  });
});
