import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { webhookStubFor } from "../ai/phantom-wire.ts";

const doc = readFileSync(
  new URL("../../../../docs/phantom-wire-data-flow.md", import.meta.url),
  "utf-8",
).replace(/\s+/g, " ");

it("describes the whole example, handler and TODO reminder included, as commented out", () => {
  expect(doc).toContain("Each generated file is entirely commented out");
  expect(doc).toContain("including its `TODO(security)`");
  expect(doc).toContain("`webhookStubFor` TODO");
  expect(doc).toContain("commented guidance for a future handler");
  expect(doc).toContain("writes fully commented examples");
  expect(doc).toContain("If the example handler is uncommented as written");
});

it("states that verification is not implemented", () => {
  expect(doc).toContain("**Webhook signature verification is not implemented.**");
  expect(doc).toContain("neither sender nor body is authenticated");
});

it.each(["stripe", "clerk", "supabase", "github", "acme"])(
  "matches the real %s stub: the handler and reminder lines are all comments",
  (provider) => {
    const stub = webhookStubFor(provider);
    const code = stub.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("//"));
    expect(code).toEqual([]);
    expect(stub).toContain("// export async function");
    expect(stub).toContain("// TODO(security)");
  },
);
