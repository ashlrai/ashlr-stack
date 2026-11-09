import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("generated webhook example body read", () => {
  for (const provider of ["stripe", "clerk", "supabase", "github", "other"]) {
    it(`${provider} keeps the body read commented, with the unauthenticated-body warning after it`, () => {
      const lines = webhookStubFor(provider).split("\n");
      const bodyRead = lines.findIndex((line) => line.includes("await req.text()"));
      expect(bodyRead).toBeGreaterThanOrEqual(0);
      expect(lines[bodyRead]).toMatch(/^\/\/\s+const body = await req\.text\(\);$/);

      // No uncommented line anywhere may read the body.
      const live = lines.filter((line) => line.trim() !== "" && !line.startsWith("//"));
      expect(live).toEqual([]);

      // The TODO warning follows the read and calls the body untrusted.
      const todo = lines.findIndex((line) => line.includes("TODO(security)"));
      const untrusted = lines.findIndex((line) =>
        line.includes("unauthenticated, attacker-controlled input"),
      );
      expect(todo).toBeGreaterThan(bodyRead);
      expect(untrusted).toBeGreaterThan(bodyRead);
      expect(lines[todo]).toMatch(/^\/\/\s+\/\/ TODO\(security\)/);
      expect(lines[untrusted]).toMatch(/^\/\/\s+\/\//);
      expect(lines.some((line) => line.includes("only then"))).toBe(true);
    });
  }
});
