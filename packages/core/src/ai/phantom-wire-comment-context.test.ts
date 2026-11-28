import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { WEBHOOK_PROVIDERS, webhookStubFor } from "./phantom-wire.ts";

describe("phantom wire comment context", () => {
  it("documents the body read, verification reminder, and response in their generated order", () => {
    // The former phantom-wire-comment-context.md is consolidated in the code map.
    const doc = readFileSync(
      new URL("../../../../docs/phantom-wire-code-map.md", import.meta.url),
      "utf8",
    );
    const context = doc
      .split("\n## The verification TODO in context\n")[1]
      ?.split("\n## ")[0]
      .replace(/\s+/g, " ");
    expect(context).toBeDefined();
    expect(context).toContain(
      "Inside the example, the TODO follows `req.text()` and precedes the placeholder 200 response.",
    );
    expect(context).toContain(
      "Even if the handler lines are uncommented, the TODO remains a comment:",
    );

    // Every covered handler, per the materializer's own provider set.
    expect(WEBHOOK_PROVIDERS.size).toBeGreaterThan(0);
    for (const provider of WEBHOOK_PROVIDERS) {
      const stub = webhookStubFor(provider);
      const body = stub.indexOf("const body = await req.text();");
      const todo = stub.indexOf("TODO(security): signature verification is NOT implemented here.");
      const reminderEnd = stub.indexOf("parse, trust, or act on the body.");
      const response = stub.indexOf('return new Response("ok", { status: 200 });');
      expect(body).toBeGreaterThanOrEqual(0);
      expect(todo).toBeGreaterThan(body);
      expect(reminderEnd).toBeGreaterThan(todo);
      expect(response).toBeGreaterThan(reminderEnd);
      // Removing the outer comment activates the example, but not its TODO.
      const uncommented = stub.replace(/^\/\/ ?/gm, "");
      expect(uncommented).toContain("  const body = await req.text();");
      expect(uncommented).toContain(
        "  // TODO(security): signature verification is NOT implemented here.",
      );
    }
  });
});
