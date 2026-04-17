import { describe, expect, test } from "bun:test";
import { detectProvider, groupByProvider, parseEnv } from "../detect.ts";

describe("provider detection", () => {
  test("canonical secret names map to their provider", () => {
    expect(detectProvider("SUPABASE_URL")).toBe("supabase");
    expect(detectProvider("NEXT_PUBLIC_SUPABASE_URL")).toBe("supabase");
    expect(detectProvider("OPENAI_API_KEY")).toBe("openai");
    expect(detectProvider("ANTHROPIC_API_KEY")).toBe("anthropic");
    expect(detectProvider("SENTRY_AUTH_TOKEN")).toBe("sentry");
    expect(detectProvider("SENTRY_DSN")).toBe("sentry");
    expect(detectProvider("GITHUB_TOKEN")).toBe("github");
    expect(detectProvider("AWS_ACCESS_KEY_ID")).toBe("aws");
    // DATABASE_URL is intentionally unattributed — it's generic Postgres
    // convention, used by Supabase, Railway, Render, PlanetScale, etc.
    expect(detectProvider("DATABASE_URL")).toBeUndefined();
    expect(detectProvider("CLOUDFLARE_API_TOKEN")).toBe("cloudflare");
    expect(detectProvider("CF_ACCOUNT_ID")).toBe("cloudflare");
    expect(detectProvider("TURSO_DATABASE_URL")).toBe("turso");
    expect(detectProvider("CONVEX_DEPLOY_KEY")).toBe("convex");
    expect(detectProvider("NEXT_PUBLIC_CONVEX_URL")).toBe("convex");
  });

  test("unattributed names return undefined", () => {
    expect(detectProvider("NODE_ENV")).toBeUndefined();
    expect(detectProvider("PORT")).toBeUndefined();
    expect(detectProvider("SOME_RANDOM_VAR")).toBeUndefined();
  });

  test("groupByProvider buckets names into providers", () => {
    const result = groupByProvider([
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "OPENAI_API_KEY",
      "NODE_ENV",
    ]);
    expect(result.supabase).toEqual(["SUPABASE_URL", "SUPABASE_ANON_KEY"]);
    expect(result.openai).toEqual(["OPENAI_API_KEY"]);
    expect(result.NODE_ENV).toBeUndefined();
  });
});

describe(".env parser", () => {
  test("parses KEY=VALUE pairs", () => {
    const pairs = parseEnv(
      `# comment line
FOO=bar
BAZ = "quoted value"
EMPTY=
# trailing comment
QUOTED='single'`,
    );
    expect(pairs).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "quoted value" },
      { key: "EMPTY", value: "" },
      { key: "QUOTED", value: "single" },
    ]);
  });

  test("ignores malformed lines", () => {
    expect(parseEnv("not a key\n:colon_line\nlowercase=ok\nOK=ok")).toEqual([
      { key: "lowercase", value: "ok" },
      { key: "OK", value: "ok" },
    ]);
  });
});
