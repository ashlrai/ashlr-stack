import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadTemplate } from "../templates.ts";

const dir = join(import.meta.dir, "..", "..", "..", "..", "templates", "temporal-worker-phantom");
const readme = readFileSync(join(dir, "README.md"), "utf-8");

describe("temporal-worker-phantom template", () => {
  test("loads with no services and holds no secret values", async () => {
    const cfg = await loadTemplate("temporal-worker-phantom");
    expect(cfg).toBeDefined();
    expect(cfg?.services).toEqual({});
    expect(cfg?.environments).toEqual([{ name: "dev", default: true }]);
    const raw = readFileSync(join(dir, "stack.toml"), "utf-8");
    expect(raw).toContain('template = "temporal-worker-phantom"');
  });

  test("README describes the configuration and limits of local verification", () => {
    for (const phrase of [
      "stack init --template temporal-worker-phantom",
      "stack list --json",
      '"services": []',
      "default `dev` environment",
      "not connectivity, credentials or worker execution",
      "does not guarantee raw credentials",
    ]) {
      expect(readme, phrase).toContain(phrase);
    }
  });

  test("README keeps the security rules and avoids em dashes", () => {
    for (const phrase of [
      "phantom exec",
      "No secret values in workflow data",
      "Codec Server stays local",
      "noopAuthorizer",
      "start-dev",
      "Keep Temporal optional",
    ]) {
      expect(readme, phrase).toContain(phrase);
    }
    expect(readme).not.toContain("\u2014");
  });
});
