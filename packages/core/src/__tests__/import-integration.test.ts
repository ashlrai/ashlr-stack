import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSecret,
  emptyConfig,
  groupByProvider,
  listSecrets,
  parseEnv,
  readConfig,
  toServiceEntry,
  writeConfig,
} from "../index.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * Exercises the logic behind `stack import`: parse .env, group by provider,
 * write each secret to the fake vault, and emit .stack.toml service entries.
 */
describe("import pipeline", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-import-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  });

  test("typical Next.js .env gets parsed, stored, and mapped to services", async () => {
    const envContent = `
# mixed real-world contents
NODE_ENV=development
NEXT_PUBLIC_SUPABASE_URL=https://abcd.supabase.co
SUPABASE_ANON_KEY=anon-value
SUPABASE_SERVICE_ROLE_KEY=service-value
OPENAI_API_KEY=sk-fake
SENTRY_DSN=https://abc@sentry.io/123
SENTRY_AUTH_TOKEN=sntryu_fake
PORT=3000
`.trim();
    writeFileSync(join(cwd, ".env"), envContent);

    const parsed = parseEnv(readFileSync(join(cwd, ".env"), "utf8"));
    expect(parsed.map((p) => p.key)).toContain("OPENAI_API_KEY");
    expect(parsed.map((p) => p.key)).toContain("NODE_ENV");

    const grouped = groupByProvider(parsed.map((p) => p.key));
    expect(grouped.supabase).toContain("SUPABASE_ANON_KEY");
    expect(grouped.supabase).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(grouped.openai).toEqual(["OPENAI_API_KEY"]);
    expect(grouped.sentry).toContain("SENTRY_AUTH_TOKEN");
    expect(grouped.NODE_ENV).toBeUndefined();
    expect(grouped.PORT).toBeUndefined();

    // Store each secret in the fake vault.
    for (const { key, value } of parsed) {
      if (value.length > 0) await addSecret(key, value);
    }

    // Verify vault state.
    const vault = await readVault(h.dir);
    expect(vault.OPENAI_API_KEY).toBe("sk-fake");
    expect(vault.NODE_ENV).toBe("development");
    const expectedVault = Object.fromEntries(parsed.map(({ key, value }) => [key, value]));
    expect(vault).toEqual(expectedVault);
    expect((await listSecrets()).sort()).toEqual(Object.keys(expectedVault).sort());
    expect(h.callsTo("add").map(({ args }) => args)).toEqual(
      parsed.map(({ key }) => [key, "--stdin"]),
    );

    // Build a .stack.toml from the detected groups.
    const config = emptyConfig("import-test");
    for (const provider of Object.keys(grouped)) {
      config.services[provider] = toServiceEntry(provider, grouped[provider]);
    }
    await writeConfig(config, cwd);

    const roundTripped = await readConfig(cwd);
    expect(roundTripped.services.supabase).toBeDefined();
    expect(roundTripped.services.openai).toBeDefined();
    expect(roundTripped.services.sentry.mcp).toBe("sentry");
    expect(Object.keys(roundTripped.services).sort()).toEqual(["openai", "sentry", "supabase"]);
    for (const [provider, keys] of Object.entries(grouped)) {
      expect(roundTripped.services[provider].secrets).toEqual(keys);
    }
    const serialized = readFileSync(join(cwd, ".stack.toml"), "utf8");
    for (const { value } of parsed) expect(serialized).not.toContain(value);
    // Eight sequential real child processes plus list/version probes are integration
    // work, not a five-second performance assertion (especially under coverage).
  }, 30_000);
});
