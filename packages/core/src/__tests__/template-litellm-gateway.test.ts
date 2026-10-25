import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS_REF } from "../catalog.ts";
import { loadTemplate } from "../templates.ts";

const dir = join(import.meta.dir, "..", "..", "..", "..", "templates", "litellm-gateway");
const readme = readFileSync(join(dir, "README.md"), "utf-8");

describe("litellm-gateway template", () => {
  test("declares only catalog providers and their own secret slots, no values", async () => {
    const cfg = await loadTemplate("litellm-gateway");
    expect(cfg).toBeDefined();
    const services = Object.entries(cfg?.services ?? {});
    expect(services.length).toBeGreaterThan(0);
    for (const [name, svc] of services) {
      const ref = PROVIDERS_REF.find((p) => p.name === svc.provider);
      expect(ref, `${name} uses a provider in the catalog`).toBeDefined();
      for (const secret of svc.secrets ?? []) expect(ref?.secrets).toContain(secret);
    }
    const raw = readFileSync(join(dir, "stack.toml"), "utf-8");
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(raw).toContain('template = "litellm-gateway"');
  });

  test("README keeps the pin and isolation guidance", () => {
    for (const phrase of [
      "Pin, never float",
      "GHSA-5mg7-485q-xm76",
      "no mounted dotfiles",
      "Bind to loopback",
      "Placeholders only",
      "allow_client_side_credentials: false",
      "NO_DOCS",
      "Cursor is not supported",
    ]) {
      expect(readme, phrase).toContain(phrase);
    }
    expect(readme).not.toContain("\u2014");
  });
});
