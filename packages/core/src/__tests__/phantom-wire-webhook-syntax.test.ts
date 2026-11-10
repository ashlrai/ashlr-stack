import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "../ai/phantom-wire.ts";

// Uncomment only the example block (the `// export ...` through `// }` lines)
// so we can prove the generated code is real, parseable TypeScript — while the
// stub as shipped stays 100% comments.
function uncommentExample(stub: string): string {
  const lines = stub.split("\n");
  const start = lines.findIndex((l) => l.startsWith("// export async function"));
  const end = lines.findIndex((l, i) => i > start && l === "// }");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return lines
    .slice(start, end + 1)
    .map((l) => l.replace(/^\/\/ ?/, ""))
    .join("\n");
}

describe("webhookStubFor — generated handler code", () => {
  it.each(["stripe", "clerk", "supabase", "github", "acme"])(
    "%s: example lines are commented out, but uncommenting them yields valid TypeScript",
    (provider) => {
      const stub = webhookStubFor(provider);
      // As shipped: no executable line.
      expect(stub.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("//"))).toEqual([]);

      const code = uncommentExample(stub);
      const handler = `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`;
      expect(code).toContain(`export async function ${handler}(req: Request): Promise<Response>`);
      // Throws on a syntax error.
      const out = new Bun.Transpiler({ loader: "ts" }).transformSync(code);
      expect(out).toContain(handler);
    },
  );
});
