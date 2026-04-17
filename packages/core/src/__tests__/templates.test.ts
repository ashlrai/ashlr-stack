import { describe, expect, test } from "bun:test";
import { listTemplates, loadTemplate } from "../templates.ts";
import { listProviderNames } from "../providers/index.ts";

describe("starter templates", () => {
  test("all templates reference only registered providers", async () => {
    const providerNames = new Set(listProviderNames());
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(4);
    for (const name of templates) {
      const template = await loadTemplate(name);
      expect(template).toBeDefined();
      for (const [serviceName, spec] of Object.entries(template?.services ?? {})) {
        const providerName = spec.provider ?? serviceName;
        expect(providerNames.has(providerName)).toBe(true);
      }
    }
  });

  test("every template declares at least one environment", async () => {
    for (const name of listTemplates()) {
      const template = await loadTemplate(name);
      expect(template?.environments?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });
});
