import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("generated webhook examples", () => {
  it.each([
    ["stripe", "stripe-signature"],
    ["clerk", "svix-signature"],
    ["supabase", "x-supabase-signature"],
    ["github", "x-hub-signature-256"],
  ])("warns about and demonstrates the unverified %s handler", async (provider, header) => {
    const example = webhookStubFor(provider);
    expect(example).toContain("does not verify signatures");
    expect(example).toContain("signature verification is NOT implemented here");
    expect(example.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);

    // Execute the sample as a reader would after removing its outer comments.
    const source = example.replace(/^\/\/ ?/gm, "");
    const handlerSource = source.slice(source.indexOf("export async function"));
    const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(
      handlerSource,
    );
    const name = `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`;
    const handle = new Function(`${javascript.replace("export ", "")}\nreturn ${name};`)() as (
      request: Request,
    ) => Promise<Response>;
    const request = (headers: Record<string, string>) =>
      new Request("https://example.test/webhook", { method: "POST", headers, body: "{}" });

    expect((await handle(request({}))).status).toBe(400);
    expect((await handle(request({ [header]: "forged" }))).status).toBe(200);
  });
});
