import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "../packages/core/src/ai/phantom-wire.ts";

describe("Phantom wire generated example comment inventory", () => {
  it.each(["stripe", "clerk", "supabase", "github"])(
    "keeps the verification reminder as commented text in the %s example",
    (provider) => {
      const stub = webhookStubFor(provider);
      const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
      if (!example) throw new Error(`Missing ${provider} webhook example`);

      // Remove only the example's outer comment layer. The reminder must
      // remain a comment when someone enables the handler.
      const lines = example.replace(/^\/\/ ?/gm, "").split("\n");
      const comments = lines.map((line) => line.trim()).filter((line) => line.startsWith("//"));
      expect(comments).toContain(
        "// TODO(security): signature verification is NOT implemented here. The",
      );
      expect(comments).toContain("// Verify over the exact raw body bytes with the webhook secret");
      expect(comments).toContain(
        `// (\`phantom reveal ${provider.toUpperCase()}_WEBHOOK_SECRET\`) and compare in`,
      );
      expect(comments).toContain(
        "// constant time; reject missing or invalid signatures, and only then",
      );
      expect(comments).toContain("// parse, trust, or act on the body.");
    },
  );
});
