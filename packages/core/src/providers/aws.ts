import { createHash, createHmac } from "node:crypto";
import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { addSecret } from "../phantom.ts";
import type {
  AuthHandle,
  HealthStatus,
  Materialized,
  Provider,
  ProviderContext,
  Resource,
} from "./_base.ts";
import { readLine, tryRevealSecret } from "./_helpers.ts";

/**
 * AWS — v1 accepts an IAM access key pair (access key id + secret access key).
 * Verifies via STS GetCallerIdentity using a hand-rolled SigV4 signer so we
 * don't pull in the AWS SDK (it's a big dep for one call). Stores keys in the
 * Phantom vault and optionally writes ~/.aws/credentials for use by the AWS
 * CLI / SDKs outside Stack.
 */

const SECRET_ID_KEY = "AWS_ACCESS_KEY_ID";
const SECRET_SECRET_KEY = "AWS_SECRET_ACCESS_KEY";
const SECRET_REGION = "AWS_REGION";

const aws: Provider = {
  name: "aws",
  displayName: "AWS",
  category: "cloud",
  authKind: "api_key",
  docs: "https://docs.aws.amazon.com/iam/",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const cachedId = await tryRevealSecret(SECRET_ID_KEY);
    const cachedSecret = await tryRevealSecret(SECRET_SECRET_KEY);
    if (cachedId && cachedSecret) {
      const identity = await callStsIdentity(cachedId, cachedSecret, "us-east-1");
      if (identity) return { token: `${cachedId}:${cachedSecret}`, identity };
      ctx.log({ level: "warn", msg: "Cached AWS credentials invalid." });
    }
    if (!ctx.interactive)
      throw new StackError("AWS_AUTH_REQUIRED", "No valid AWS credentials in vault.");
    process.stderr.write(
      "\n  Create an IAM access key at https://console.aws.amazon.com/iam/home#/security_credentials\n  AWS_ACCESS_KEY_ID: ",
    );
    const accessKeyId = (await readLine()).trim();
    process.stderr.write("  AWS_SECRET_ACCESS_KEY: ");
    const secretAccessKey = (await readLine()).trim();
    const identity = await callStsIdentity(accessKeyId, secretAccessKey, "us-east-1");
    if (!identity) throw new StackError("AWS_AUTH_INVALID", "AWS rejected those credentials.");
    await addSecret(SECRET_ID_KEY, accessKeyId);
    await addSecret(SECRET_SECRET_KEY, secretAccessKey);
    return { token: `${accessKeyId}:${secretAccessKey}`, identity };
  },

  async provision(_ctx, auth, opts): Promise<Resource> {
    // v1: attach to the account the keys belong to.
    const region = (opts.hints?.region as string | undefined) ?? "us-east-1";
    return {
      id: auth.identity?.Account ?? "unknown",
      displayName: auth.identity?.Arn ?? "AWS account",
      region,
    };
  },

  async materialize(_ctx, resource, auth): Promise<Materialized> {
    const sep = auth.token.indexOf(":");
    if (sep <= 0 || sep === auth.token.length - 1) {
      throw new StackError(
        "AWS_AUTH_MALFORMED",
        "AWS auth handle is malformed (expected accessKeyId:secretAccessKey).",
      );
    }
    const accessKeyId = auth.token.slice(0, sep);
    const secretAccessKey = auth.token.slice(sep + 1);
    if (!accessKeyId || !secretAccessKey) {
      throw new StackError(
        "AWS_AUTH_MALFORMED",
        "AWS auth handle missing access key id or secret access key.",
      );
    }
    await addSecret(SECRET_REGION, resource.region ?? "us-east-1");
    return {
      secrets: {
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey,
        AWS_REGION: resource.region ?? "us-east-1",
      },
    };
  },

  async healthcheck(_ctx, _entry: ServiceEntry): Promise<HealthStatus> {
    const id = await tryRevealSecret(SECRET_ID_KEY);
    const secret = await tryRevealSecret(SECRET_SECRET_KEY);
    const region = (await tryRevealSecret(SECRET_REGION)) ?? "us-east-1";
    if (!id || !secret) return { kind: "error", detail: "AWS credentials missing from vault" };
    const start = Date.now();
    const identity = await callStsIdentity(id, secret, region);
    const latencyMs = Date.now() - start;
    return identity ? { kind: "ok", latencyMs } : { kind: "error", detail: "credentials invalid" };
  },

  dashboardUrl(): string {
    return "https://console.aws.amazon.com";
  },
};

export default aws;

/**
 * Minimal SigV4 signer for a single call: STS GetCallerIdentity. Scoped tight
 * on purpose — any more and we should pull in @aws-sdk/client-sts.
 */
async function callStsIdentity(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<Record<string, string> | undefined> {
  // us-east-1 uses the unregional endpoint; everything else uses sts.<region>.amazonaws.com.
  const host = region === "us-east-1" ? "sts.amazonaws.com" : `sts.${region}.amazonaws.com`;
  const service = "sts";
  const method = "POST";
  const now = new Date();
  const amzDate = toAmzDate(now);
  const datestamp = amzDate.slice(0, 8);
  const payload = "Action=GetCallerIdentity&Version=2011-06-15";
  const payloadHash = createHash("sha256").update(payload).digest("hex");

  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = [method, "/", "", canonicalHeaders, signedHeaders, payloadHash].join(
    "\n",
  );
  const scope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const kDate = hmac(`AWS4${secretAccessKey}`, datestamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const res = await fetch(`https://${host}/`, {
      method,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-amz-date": amzDate,
        Authorization: authorization,
      },
      body: payload,
    });
    if (!res.ok) return undefined;
    const xml = await res.text();
    const arn = matchXml(xml, "Arn");
    const userId = matchXml(xml, "UserId");
    const account = matchXml(xml, "Account");
    if (!arn) return undefined;
    return {
      Arn: arn,
      ...(userId ? { UserId: userId } : {}),
      ...(account ? { Account: account } : {}),
    };
  } catch {
    return undefined;
  }
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function toAmzDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function matchXml(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`));
  return m?.[1];
}
