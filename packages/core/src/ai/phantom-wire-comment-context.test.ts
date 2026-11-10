import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { webhookStubFor } from "./phantom-wire.ts";

describe("phantom wire comment context", () => {
  it("documents the body read, verification reminder, and response in their generated order", () => {
    const doc = readFileSync(
      new URL("../../../../docs/phantom-wire-comment-context.md", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(doc).toContain(
      "Inside the example, the TODO follows `req.text()` and precedes the placeholder 200 response.",
    );

    for (const provider of ["stripe", "clerk", "supabase", "github"]) {
      const stub = webhookStubFor(provider);
      const body = stub.indexOf("const body = await req.text();");
      const todo = stub.indexOf("TODO(security): signature verification is NOT implemented here.");
      const response = stub.indexOf('return new Response("ok", { status: 200 });');
      expect(body).toBeGreaterThanOrEqual(0);
      expect(todo).toBeGreaterThan(body);
      expect(response).toBeGreaterThan(todo);
    }
  });
});
