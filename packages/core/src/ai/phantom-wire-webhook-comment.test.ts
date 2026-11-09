import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("generated webhook example stays inert and keeps its warning", () => {
  for (const provider of ["stripe", "clerk", "supabase", "github", "other"]) {
    it(`${provider}: handler is fully commented out`, () => {
      const example = webhookStubFor(provider);
      // Parsed as TypeScript, the example must contain no executable code.
      const emitted = new Bun.Transpiler({ loader: "ts" }).transformSync(example);
      expect(emitted.trim()).toBe("");
      expect(example).toMatch(/^\/\/ export async function handle\w+Webhook\(/m);
      expect(example).not.toMatch(/^\s*(export|import|const|let|function|return)\b/m);
    });

    it(`${provider}: verification warning precedes the handler and the TODO sits inside it`, () => {
      const lines = webhookStubFor(provider).split("\n");
      const at = (text: string) => lines.findIndex((line) => line.includes(text));
      const warning = at("does not verify signatures");
      const handler = at("// export async function handle");
      const todo = at("TODO(security): signature verification is NOT implemented here");
      const end = lines.lastIndexOf("// }");
      expect(warning).toBeGreaterThanOrEqual(0);
      expect(handler).toBeGreaterThan(warning);
      expect(todo).toBeGreaterThan(handler);
      expect(end).toBeGreaterThan(todo);
    });
  }
});
