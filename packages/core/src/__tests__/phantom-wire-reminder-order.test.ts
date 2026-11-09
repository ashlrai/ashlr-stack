import { expect, it } from "bun:test";
import { webhookStubFor } from "../ai/phantom-wire.ts";

it.each(["stripe", "clerk", "supabase", "github", "acme"])(
  "places the verification reminder before the first request body use in the %s example",
  (provider) => {
    const stub = webhookStubFor(provider);
    const reminder = stub.indexOf("Implement verification first.");
    const example = stub.indexOf("// export async function");
    const bodyUse = stub
      .slice(example)
      .search(/\breq\.(?:body|text|json|arrayBuffer|blob|formData|bytes)\b/);

    expect(reminder).toBeGreaterThanOrEqual(0);
    expect(example).toBeGreaterThan(reminder);
    expect(bodyUse).toBeGreaterThanOrEqual(0);
    expect(example + bodyUse).toBeGreaterThan(reminder);
  },
);
