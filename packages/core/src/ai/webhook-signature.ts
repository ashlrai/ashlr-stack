import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookProvider = "stripe" | "github" | "clerk" | "supabase";

/** Verify the original bytes before parsing. Timestamped signatures expire after five minutes. */
export function verifyWebhookSignature(
  provider: WebhookProvider,
  headers: Headers,
  body: Uint8Array,
  secret: string,
): boolean {
  if (!secret) return false;
  let key: string | Buffer = secret;
  let prefix = "";
  let signatures: string[];
  let encoding: "hex" | "base64" = "hex";

  if (provider === "github") {
    const signature = headers.get("x-hub-signature-256") ?? "";
    if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
    signatures = [signature.slice(7)];
  } else {
    let timestamp: string | undefined;
    if (provider === "stripe") {
      const parts = (headers.get("stripe-signature") ?? "").split(",").map((s) => s.trim());
      const timestamps = parts.filter((s) => s.startsWith("t="));
      if (timestamps.length !== 1) return false;
      timestamp = timestamps[0].slice(2);
      signatures = parts.filter((s) => s.startsWith("v1=")).map((s) => s.slice(3));
      prefix = `${timestamp}.`;
    } else if (provider === "clerk" || provider === "supabase") {
      const header = provider === "clerk" ? "svix" : "webhook";
      const id = headers.get(`${header}-id`);
      timestamp = headers.get(`${header}-timestamp`) ?? "";
      if (!id) return false;
      signatures = (headers.get(`${header}-signature`) ?? "")
        .split(/\s+/)
        .filter((s) => s.startsWith("v1,"))
        .map((s) => s.slice(3));
      encoding = "base64";
      prefix = `${id}.${timestamp}.`;
      // Clerk uses base64 keys; Supabase also supports plain string signing secrets.
      if (provider === "clerk" || secret.startsWith("whsec_")) {
        const encoded = secret.replace(/^whsec_/, "");
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
        key = Buffer.from(encoded, "base64");
        if (!key.length) return false;
      }
    } else {
      return false;
    }
    if (!timestamp || !/^\d+$/.test(timestamp)) return false;
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) {
      return false;
    }
  }

  const expected = createHmac("sha256", key).update(prefix).update(body).digest();
  return signatures.some((signature) => {
    const format = encoding === "hex" ? /^[a-fA-F0-9]{64}$/ : /^[A-Za-z0-9+/]{43}=$/;
    if (!format.test(signature)) return false;
    const actual = Buffer.from(signature, encoding);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
