/**
 * AWS CloudWatch API call limits + EC2 quota probe.
 *
 * Calls Service Quotas API (us-east-1) to surface:
 *   - EC2 running on-demand instances quota
 *   - CloudWatch API call limit
 *
 * Uses SigV4 request signing with AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.
 * Degrades gracefully when credentials lack the servicequotas:GetAWSDefaultServiceQuota
 * permission; returns "warn" with a human-readable message.
 *
 * NOTE: SigV4 signing is implemented inline (SHA-256 HMAC via Web Crypto) to
 * avoid adding an AWS SDK dependency. Only GET/POST with no body are needed.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "aws";
const REGION = "us-east-1";

// ---------------------------------------------------------------------------
// Minimal SigV4 signer (HMAC-SHA256)
// ---------------------------------------------------------------------------

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  // Normalise to a fresh Uint8Array backed by a plain ArrayBuffer. The Web
  // Crypto lib types require `BufferSource` to be backed by `ArrayBuffer` (not
  // `SharedArrayBuffer`/`ArrayBufferLike`), so copy into a clean view to keep
  // the call type-safe regardless of the incoming buffer kind.
  const keyBytes: Uint8Array<ArrayBuffer> =
    key instanceof Uint8Array ? new Uint8Array(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sigV4SignHeaders(opts: {
  method: string;
  host: string;
  path: string;
  query: string;
  body: string;
  service: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): Promise<Record<string, string>> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(opts.body);

  const signedHeaders = opts.sessionToken
    ? "content-type;host;x-amz-date;x-amz-security-token"
    : "content-type;host;x-amz-date";

  const canonicalHeaders = opts.sessionToken
    ? `content-type:application/x-amz-json-1.1\nhost:${opts.host}\nx-amz-date:${amzDate}\nx-amz-security-token:${opts.sessionToken}\n`
    : `content-type:application/x-amz-json-1.1\nhost:${opts.host}\nx-amz-date:${amzDate}\n`;

  const canonicalRequest = [
    opts.method,
    opts.path,
    opts.query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${opts.secretAccessKey}`),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, opts.region);
  const kService = await hmacSha256(kRegion, opts.service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-amz-json-1.1",
    "X-Amz-Date": amzDate,
    Authorization: authHeader,
  };
  if (opts.sessionToken) headers["X-Amz-Security-Token"] = opts.sessionToken;
  return headers;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

const probe: Probe = {
  provider: PROVIDER,
  label: "AWS CloudWatch API limits + EC2 quota",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const accessKeyId = await tryRevealSecret("AWS_ACCESS_KEY_ID");
    const secretAccessKey = await tryRevealSecret("AWS_SECRET_ACCESS_KEY");

    if (!accessKeyId || !secretAccessKey) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not in vault — probe skipped",
      };
    }

    const sessionToken = await tryRevealSecret("AWS_SESSION_TOKEN");

    const start = Date.now();
    try {
      // Call ServiceQuotas to get EC2 Running On-Demand Standard Instances quota.
      // ServiceCode: ec2, QuotaCode: L-1216C47A (running on-demand standard instances).
      const host = `servicequotas.${REGION}.amazonaws.com`;
      const body = JSON.stringify({ ServiceCode: "ec2", QuotaCode: "L-1216C47A" });

      const headers = await sigV4SignHeaders({
        method: "POST",
        host,
        path: "/",
        query: "",
        body,
        service: "servicequotas",
        region: REGION,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      });

      const res = await fetch(`https://${host}/`, {
        method: "POST",
        headers: {
          ...headers,
          "X-Amz-Target": "ServiceQuotasV20190624.GetServiceQuota",
        },
        body,
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (res.status === 403 || res.status === 400) {
        // Credentials valid but lacking servicequotas permission — degrade.
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "warn",
          detail: `AWS credentials valid but lack servicequotas permission (HTTP ${res.status}) — add servicequotas:GetServiceQuota for full quota probe`,
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `AWS ServiceQuotas returned HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        Quota?: { QuotaName: string; Value: number; UsageMetric?: { MetricName?: string } };
      };
      const quota = data.Quota;

      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        rateLimitCeiling: quota?.Value,
        status: "ok",
        detail: quota
          ? `EC2 on-demand quota: ${quota.Value} instances (${quota.QuotaName})`
          : "AWS ServiceQuotas reachable",
      };
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `AWS probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
