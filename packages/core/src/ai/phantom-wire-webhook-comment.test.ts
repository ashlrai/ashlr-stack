import { describe, expect, it } from "bun:test";
import { verificationHintFor, webhookStubFor } from "./phantom-wire.ts";

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
      const reminderEnd = at("parse, trust, or act on the body.");
      expect(reminderEnd).toBeGreaterThan(todo);
      expect(reminderEnd).toBeLessThan(end);
      const reminder = lines.slice(todo, reminderEnd + 1);
      expect(reminder.every((line) => line.startsWith("//   // "))).toBe(true);
      expect(reminder.join("\n")).toContain(verificationHintFor(provider));
      expect(reminder.join("\n")).toContain("value is never compared to anything");
    });
  }
});
