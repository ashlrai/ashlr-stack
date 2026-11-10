import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { webhookStubFor } from "./phantom-wire.ts";

describe("phantom wire verification follow-up", () => {
  test("the documented unresolved TODO matches every generated webhook example", () => {
    const doc = readFileSync(
      new URL("../../../../docs/phantom-wire-followup.md", import.meta.url),
      "utf8",
    );
    expect(doc).toContain("**Status: unresolved.**");
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    expect(excerpt).toBeDefined();
    expect(excerpt).toContain("TODO(security): signature verification is NOT implemented here.");

    for (const provider of ["stripe", "clerk", "supabase", "github"]) {
      expect(webhookStubFor(provider)).toContain(excerpt as string);
    }
  });
});
