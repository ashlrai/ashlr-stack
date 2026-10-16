import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
import * as oauth from "../oauth.ts";
import { addSecret } from "../phantom.ts";
import { addService } from "../pipeline.ts";
import { makeApiKeyProvider } from "../providers/_api-key.ts";
import type { Provider, ProviderContext } from "../providers/_base.ts";
import {
  acceptVerifiedExisting,
  beginCredentialStage,
  carryResourceCredential,
  closeCredentialStage,
  credentialPhase,
  ordinaryCredentialPlan,
  readProviderSecret,
  storeProviderSecret,
} from "../providers/_credential-stage.ts";
import aws from "../providers/aws.ts";
import { providers } from "../providers/index.ts";
import supabase from "../providers/supabase.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

describe("operation-owned credential persistence", () => {
  let h: Harness;
  let cwd: string;
  let realFetch: typeof fetch;
  beforeEach(async () => {
    realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error("unexpected network in inert fixture");
      },
      {
        preconnect() {
          throw new Error("inert preconnect refused");
        },
      },
    );
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-staging-"));
    await writeConfig(emptyConfig("inert"), cwd);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    Reflect.deleteProperty(providers, "stagefixture");
    h.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  });
  function factory(): Provider {
    return makeApiKeyProvider({
      name: "stagefixture",
      displayName: "Stage Fixture",
      category: "ai",
      docs: "https://example.invalid",
      secretName: "FIXTURE_KEY",
      howTo: "synthetic",
      async verify(key) {
        return key === "synthetic-key" ? { id: "inert" } : undefined;
      },
    });
  }
  function run(provider = factory()) {
    providers.stagefixture = async () => provider;
    return addService({
      providerName: "stagefixture",
      cwd,
      interactive: true,
      prompt: async () => "synthetic-key",
    });
  }
  test("factory login/materialize/pipeline produce exactly one create per unique key", async () => {
    const result = await run();
    expect(result.secretCount).toBe(1);
    expect(h.callsTo("add")).toEqual([{ cmd: "add", args: ["FIXTURE_KEY", "--stdin"] }]);
    expect(await readVault(h.dir)).toEqual({ FIXTURE_KEY: "synthetic-key" });
  });
  test("failed provision saves no new verified login credential", async () => {
    const p = factory();
    p.provision = async () => {
      throw new Error("inert provision failed");
    };
    await expect(run(p)).rejects.toThrow("inert provision failed");
    expect(h.callsTo("add")).toEqual([]);
    expect(await readVault(h.dir)).toEqual({});
    expect((await readConfig(cwd)).services.stagefixture).toBeUndefined();
  });
  test("conflicting login/materialized values refuse before any ordinary create", async () => {
    const p = factory();
    p.materialize = async () => ({ secrets: { OTHER_KEY: "other", FIXTURE_KEY: "conflict" } });
    await expect(run(p)).rejects.toThrow();
    expect(h.callsTo("add")).toEqual([]);
    expect(await readVault(h.dir)).toEqual({});
  });
  test("all ordinary values are checked for CR/LF before the first create", async () => {
    const p = factory();
    p.materialize = async () => ({ secrets: { FIRST_KEY: "first", BAD_KEY: "one\ntwo" } });
    await expect(run(p)).rejects.toThrow();
    expect(h.callsTo("add")).toEqual([]);
    expect(await readVault(h.dir)).toEqual({});
  });
  test("a completed identical historical collision always refuses", async () => {
    await addSecret("HISTORY_KEY", "same", cwd);
    writeFileSync(h.vaultPath, JSON.stringify({ HISTORY_KEY: "foreign" }));
    await expect(addSecret("HISTORY_KEY", "same", cwd)).rejects.toMatchObject({
      code: "PHANTOM_SECRET_EXISTS",
    });
    expect(await readVault(h.dir)).toEqual({ HISTORY_KEY: "foreign" });
  });
  test("direct verified login remains immediate and refuses a later collision", async () => {
    const ctx = { cwd, interactive: true, log: () => {}, prompt: async () => "synthetic-key" };
    await factory().login(ctx);
    expect(await readVault(h.dir)).toEqual({ FIXTURE_KEY: "synthetic-key" });
    await expect(factory().login(ctx)).rejects.toMatchObject({ code: "PHANTOM_SECRET_EXISTS" });
    expect(h.callsTo("add")).toHaveLength(2);
  });
  function syntheticFetch(
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  ) {
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init),
      {
        preconnect() {
          throw new Error("inert preconnect refused");
        },
      },
    );
  }
  function ctx(): ProviderContext {
    return { cwd, interactive: true, log: () => {}, prompt: async () => "synthetic-key" };
  }
  function assertNoConfig() {
    expect(readFileSync(join(cwd, ".stack.local.toml"), "utf8")).not.toContain("stagefixture");
  }

  test("AWS stages both verified keys and region, creating each once", async () => {
    let verified = 0;
    syntheticFetch((url) => {
      expect(url).toBe("https://sts.amazonaws.com/");
      verified++;
      return new Response(
        "<GetCallerIdentityResponse><Arn>inert-arn</Arn><Account>inert-account</Account></GetCallerIdentityResponse>",
      );
    });
    const result = await addService({
      providerName: "aws",
      cwd,
      interactive: true,
      prompt: async ({ message }) =>
        message === "AWS_ACCESS_KEY_ID" ? "synthetic-id" : "synthetic-secret",
    });
    expect(verified).toBe(1);
    expect(result.entry.secrets).toEqual([
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
    ]);
    expect(h.callsTo("add").map((c) => c.args)).toEqual([
      ["AWS_ACCESS_KEY_ID", "--stdin"],
      ["AWS_SECRET_ACCESS_KEY", "--stdin"],
      ["AWS_REGION", "--stdin"],
    ]);
  });
  test("freshly verified cached factory credential is never created or rolled back", async () => {
    h.cleanup();
    h = setupFakePhantom({ FIXTURE_KEY: "synthetic-key" }, { legacyHeadlessReveal: true });
    let verifies = 0;
    const p = makeApiKeyProvider({
      name: "stagefixture",
      displayName: "Fixture",
      category: "ai",
      docs: "inert",
      secretName: "FIXTURE_KEY",
      howTo: "inert",
      async verify() {
        verifies++;
        return { id: "inert" };
      },
    });
    p.materialize = async (context, resource, auth) => {
      await storeProviderSecret(context, "FIXTURE_KEY", auth.token);
      return {
        secrets: { FIXTURE_KEY: auth.token, NEW_SLOT: "new" },
        mcp: { name: "inert", type: "stdio", command: "echo" },
      };
    };
    writeFileSync(join(cwd, ".mcp.json"), "malformed");
    await expect(run(p)).rejects.toThrow();
    expect(verifies).toBe(1);
    expect(h.callsTo("add").map((c) => c.args[0])).toEqual(["NEW_SLOT"]);
    expect(h.callsTo("remove").map((c) => c.args[0])).toEqual(["NEW_SLOT"]);
    expect((await readVault(h.dir)).FIXTURE_KEY).toBe("synthetic-key");
  });
  test("unreadable existing factory credential still attempts strict create and refuses", async () => {
    writeFileSync(h.vaultPath, JSON.stringify({ FIXTURE_KEY: "synthetic-key" }));
    const p = factory();
    p.deprovision = async () => {};
    const error = await run(p).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("already exists");
    expect(h.callsTo("add")).toHaveLength(1);
    expect(h.callsTo("remove")).toEqual([]);
    assertNoConfig();
  });
  test("invalid cached input cannot authorize omission even when newly pasted value matches", async () => {
    h.cleanup();
    h = setupFakePhantom({ FIXTURE_KEY: "synthetic-key" }, { legacyHeadlessReveal: true });
    let verifies = 0;
    const p = makeApiKeyProvider({
      name: "stagefixture",
      displayName: "Fixture",
      category: "ai",
      docs: "inert",
      secretName: "FIXTURE_KEY",
      howTo: "inert",
      async verify() {
        verifies++;
        return verifies === 1 ? undefined : { id: "inert" };
      },
    });
    p.deprovision = async () => {};
    await expect(run(p)).rejects.toThrow("already exists");
    expect(verifies).toBe(2);
    expect(h.callsTo("add")).toHaveLength(1);
  });
  test("cached AWS marks both keys only after fresh STS verification", async () => {
    h.cleanup();
    h = setupFakePhantom(
      { AWS_ACCESS_KEY_ID: "synthetic-id", AWS_SECRET_ACCESS_KEY: "synthetic-secret" },
      { legacyHeadlessReveal: true },
    );
    let verifies = 0;
    syntheticFetch(() => {
      verifies++;
      return new Response("<Arn>inert</Arn><Account>inert</Account>");
    });
    await addService({ providerName: "aws", cwd, interactive: false });
    expect(verifies).toBe(1);
    expect(h.callsTo("add").map((c) => c.args[0])).toEqual(["AWS_REGION"]);
  });
  test("reads/writes stay at captured absolute cwd despite ctx and opts mutation", async () => {
    // Add cwd metadata to the inert producer log, never secret input values.
    const bin = join(h.dir, "phantom");
    writeFileSync(
      bin,
      readFileSync(bin, "utf8")
        .replace("import json,sys; open", "import json,sys,os; open")
        .replace('{"cmd": sys.argv[2]', '{"cwd": os.getcwd(), "cmd": sys.argv[2]'),
    );
    const opts = { providerName: "stagefixture", cwd, interactive: true };
    const p = factory();
    const originalLogin = p.login;
    // Preserve the exact source-created context; copying it would intentionally
    // be standalone, so mutate only after the real login has staged its input.
    p.login = async (context) => {
      context.prompt = async () => "synthetic-key";
      context.cwd = tmpdir();
      const auth = await originalLogin(context);
      opts.cwd = tmpdir();
      return auth;
    };
    providers.stagefixture = async () => p;
    await addService(opts);
    const rows = readFileSync(h.logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const row of rows.filter((r) => ["status", "reveal", "add"].includes(r.cmd)))
      expect(row.cwd).toBe(cwd);
    expect((await readConfig(cwd)).services.stagefixture).toBeDefined();
  });
  for (const fail of ["login", "provision", "materialize", "success"] as const) {
    test(`retained context is closed after ${fail}; no standalone persistence reopens`, async () => {
      let retained: ProviderContext | undefined;
      const p = factory();
      const originalLogin = p.login;
      p.login = async (context) => {
        retained = context;
        const auth = await originalLogin(context);
        if (fail === "login") throw new Error("inert login failure");
        return auth;
      };
      if (fail === "provision")
        p.provision = async () => {
          throw new Error("inert provision failure");
        };
      if (fail === "materialize")
        p.materialize = async () => {
          throw new Error("inert materialize failure");
        };
      await run(p).catch(() => {});
      expect(retained).toBeDefined();
      const before = h.callsTo("add").length;
      await expect(storeProviderSecret(retained!, "LATE_KEY", "late")).rejects.toMatchObject({
        code: "CREDENTIAL_SCOPE_CLOSED",
      });
      expect(() => beginCredentialStage(retained!)).toThrow();
      expect(h.callsTo("add")).toHaveLength(before);
      expect((await readVault(h.dir)).LATE_KEY).toBeUndefined();
    });
  }
  test("two contexts isolate inputs, existing candidates and captured projects", async () => {
    h.cleanup();
    h = setupFakePhantom({ FIXTURE_KEY: "synthetic-key" }, { legacyHeadlessReveal: true });
    const a = ctx();
    const b = { ...ctx(), cwd: tmpdir() };
    beginCredentialStage(a);
    beginCredentialStage(b);
    try {
      const value = await readProviderSecret(a, "FIXTURE_KEY");
      expect(() => acceptVerifiedExisting(b, "FIXTURE_KEY", value)).toThrow();
      acceptVerifiedExisting(a, "FIXTURE_KEY", value);
      await storeProviderSecret(b, "FIXTURE_KEY", "other");
      expect(ordinaryCredentialPlan(a, { FIXTURE_KEY: value })).toEqual([]);
      expect(ordinaryCredentialPlan(b, { FIXTURE_KEY: "other" })).toEqual([
        ["FIXTURE_KEY", "other"],
      ]);
      expect(h.callsTo("add")).toEqual([]);
    } finally {
      closeCredentialStage(a);
      closeCredentialStage(b);
    }
  });
  test("read alone and late-phase mark never authorize current credential omission", async () => {
    h.cleanup();
    h = setupFakePhantom({ FIXTURE_KEY: "synthetic-key" }, { legacyHeadlessReveal: true });
    const context = ctx();
    beginCredentialStage(context);
    try {
      const value = await readProviderSecret(context, "FIXTURE_KEY");
      expect(ordinaryCredentialPlan(context, { FIXTURE_KEY: value })).toEqual([
        ["FIXTURE_KEY", value],
      ]);
      credentialPhase(context, "materialize");
      expect(() => acceptVerifiedExisting(context, "FIXTURE_KEY", value)).toThrow();
      expect(ordinaryCredentialPlan(context, { FIXTURE_KEY: value })).toEqual([
        ["FIXTURE_KEY", value],
      ]);
    } finally {
      closeCredentialStage(context);
    }
  });
  test("materialized value different from freshly accepted cached input conflicts before writes", async () => {
    h.cleanup();
    h = setupFakePhantom({ FIXTURE_KEY: "synthetic-key" }, { legacyHeadlessReveal: true });
    const p = factory();
    p.materialize = async () => ({ secrets: { FIRST_KEY: "first", FIXTURE_KEY: "different" } });
    p.deprovision = async () => {};
    await expect(run(p)).rejects.toThrow("inputs disagree");
    expect(h.callsTo("add")).toEqual([]);
    expect(h.callsTo("remove")).toEqual([]);
  });
  test("auth-only credentials follow unique materialized keys, entry/count remain materialized only", async () => {
    const p = factory();
    p.materialize = async () => ({ secrets: { RESOURCE_KEY: "resource" } });
    const result = await run(p);
    expect(h.callsTo("add").map((c) => c.args[0])).toEqual(["RESOURCE_KEY", "FIXTURE_KEY"]);
    expect(result.secretCount).toBe(1);
    expect(result.entry.secrets).toEqual(["RESOURCE_KEY"]);
  });
  test("MCP/config failure tracks actual new auth-only creates and keeps truthful headless note", async () => {
    const p = factory();
    p.materialize = async () => ({
      secrets: { RESOURCE_KEY: "resource" },
      mcp: { name: "inert", command: "echo" },
    });
    writeFileSync(join(cwd, ".mcp.json"), "malformed");
    const error = await run(p).catch((e: Error) => e);
    expect((error as Error).message).toContain('step "MCP write"');
    expect((error as Error).message).toContain("Phantom kept RESOURCE_KEY, FIXTURE_KEY");
    expect(h.callsTo("remove").map((c) => c.args[0])).toEqual(["RESOURCE_KEY", "FIXTURE_KEY"]);
    assertNoConfig();
  });
  test("host failure after success cannot reuse the ended context to replay storage", async () => {
    let retained: ProviderContext | undefined;
    const p = factory();
    const login = p.login;
    p.login = async (context) => {
      retained = context;
      return login(context);
    };
    await run(p);
    const count = h.callsTo("add").length;
    await Promise.reject(new Error("synthetic host failure after success")).catch(async () => {
      await expect(
        storeProviderSecret(retained!, "FIXTURE_KEY", "synthetic-key"),
      ).rejects.toMatchObject({ code: "CREDENTIAL_SCOPE_CLOSED" });
    });
    expect(h.callsTo("add")).toHaveLength(count);
    expect((await readConfig(cwd)).services.stagefixture).toBeDefined();
  });
  function supabaseFixture(
    options: { materializeFails?: boolean; teardownFails?: boolean; attach?: boolean } = {},
  ) {
    const events: string[] = [];
    let password = "";
    syntheticFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/profile")) {
        events.push("verify");
        return Response.json({ id: "inert-user" });
      }
      if (url.endsWith("/organizations")) {
        events.push("organizations");
        return Response.json([{ id: "inert-org", name: "inert" }]);
      }
      if (url.endsWith("/projects") && method === "POST") {
        events.push("POST");
        password = JSON.parse(String(init?.body)).db_pass;
        expect(h.callsTo("add")).toEqual([]);
        return Response.json({
          id: "inert-project",
          name: "inert",
          region: "us-east-1",
          organization_id: "inert-org",
        });
      }
      if (url.endsWith("/api-keys")) {
        events.push("materialize");
        const vault = JSON.parse(readFileSync(h.vaultPath, "utf8"));
        if (!options.attach)
          expect(
            vault.SUPABASE_DB_PASSWORD_inert_project ?? vault["SUPABASE_DB_PASSWORD_inert-project"],
          ).toBe(password);
        expect(vault.STACK_SUPABASE_ACCESS_TOKEN).toBeUndefined();
        if (options.materializeFails) return new Response("inert", { status: 400 });
        return Response.json([
          { name: "anon", api_key: "inert-anon" },
          { name: "service_role", api_key: "inert-role" },
        ]);
      }
      if (url.endsWith("/projects/inert-project") && method === "DELETE") {
        events.push("DELETE");
        if (options.teardownFails) throw new Error("inert transport failure");
        return new Response("", { status: 200 });
      }
      if (url.endsWith("/projects/inert-project") && options.attach)
        return Response.json({
          id: "inert-project",
          name: "inert",
          region: "us-east-1",
          organization_id: "inert-org",
        });
      throw new Error("unexpected synthetic Supabase request");
    });
    return { events, password: () => password };
  }
  async function runSupabase(existingResourceId?: string) {
    return addService({
      providerName: "supabase",
      cwd,
      interactive: true,
      existingResourceId,
      prompt: async () => "synthetic-supabase-token",
    });
  }
  test("Supabase generated password is private and created once before materialize", async () => {
    const f = supabaseFixture();
    const result = await runSupabase();
    expect(f.events).toEqual(["verify", "organizations", "POST", "materialize"]);
    expect(h.callsTo("add").map((c) => c.args[0])).toEqual([
      "SUPABASE_DB_PASSWORD_inert-project",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STACK_SUPABASE_ACCESS_TOKEN",
    ]);
    expect(result.secretCount).toBe(3);
    expect(result.entry.secrets).toEqual([
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(JSON.stringify(result)).not.toContain(f.password());
    expect(readFileSync(join(cwd, ".stack.local.toml"), "utf8")).not.toContain(f.password());
    expect(readFileSync(join(cwd, ".mcp.json"), "utf8")).not.toContain(f.password());
  });
  test("Supabase materialize failure owns password rollback while new auth remains unsaved", async () => {
    const f = supabaseFixture({ materializeFails: true });
    const error = await runSupabase().catch((e: Error) => e);
    expect(f.events).toEqual(["verify", "organizations", "POST", "materialize", "DELETE"]);
    expect(h.callsTo("add").map((c) => c.args[0])).toEqual(["SUPABASE_DB_PASSWORD_inert-project"]);
    expect(h.callsTo("remove").map((c) => c.args[0])).toEqual([
      "SUPABASE_DB_PASSWORD_inert-project",
    ]);
    expect((error as Error).message).toContain(
      "1 resource credential(s); manual vault reconciliation is required",
    );
    expect((error as Error).message).not.toContain(f.password());
    expect((await readVault(h.dir)).STACK_SUPABASE_ACCESS_TOKEN).toBeUndefined();
  });
  test("critical vault refusal plus unknown teardown reports a hold without durability promise", async () => {
    writeFileSync(
      h.vaultPath,
      JSON.stringify({ "SUPABASE_DB_PASSWORD_inert-project": "existing-password" }),
    );
    const f = supabaseFixture({ teardownFails: true });
    const error = await runSupabase().catch((e: Error) => e);
    expect(f.events).toEqual(["verify", "organizations", "POST", "DELETE"]);
    expect(error).toMatchObject({ code: "ADD_SERVICE_PARTIAL_FAILURE" });
    expect((error as Error).message).toContain("may still exist");
    expect((error as Error).message).toContain(
      "Resource credential storage was refused or could not be confirmed",
    );
    expect((error as Error).message).not.toContain(f.password());
    expect(h.callsTo("remove")).toEqual([]);
    expect((await readVault(h.dir))["SUPABASE_DB_PASSWORD_inert-project"]).toBe(
      "existing-password",
    );
  });
  test("attached Supabase materialize failure never gains DELETE or generated password authority", async () => {
    const f = supabaseFixture({ attach: true, materializeFails: true });
    const error = await runSupabase("inert-project").catch((e: Error) => e);
    expect(error).toMatchObject({ code: "ADD_SERVICE_PARTIAL_FAILURE" });
    expect((error as Error).message).toContain("preserved");
    expect(f.events).toEqual(["verify", "materialize"]);
    expect(h.callsTo("add")).toEqual([]);
    expect(h.callsTo("remove")).toEqual([]);
  });
  test("later ordinary conflict follows critical write and invokes owned cleanup", async () => {
    const p = factory();
    let deletes = 0;
    p.provision = async (context) => {
      const resource = { id: "inert", displayName: "inert" };
      await carryResourceCredential(context, resource, "CRITICAL_KEY", "critical");
      return resource;
    };
    p.materialize = async () => ({ secrets: { FIRST_KEY: "first", FIXTURE_KEY: "conflict" } });
    p.deprovision = async () => {
      deletes++;
    };
    await expect(run(p)).rejects.toThrow("inputs disagree");
    expect(h.callsTo("add").map((c) => c.args[0])).toEqual(["CRITICAL_KEY"]);
    expect(h.callsTo("remove").map((c) => c.args[0])).toEqual(["CRITICAL_KEY"]);
    expect(deletes).toBe(1);
  });
  test("private resource carry matches exact context and resource identity", async () => {
    const context = ctx();
    beginCredentialStage(context);
    const resource = { id: "same", displayName: "inert" };
    try {
      credentialPhase(context, "provision");
      await carryResourceCredential(context, resource, "CRITICAL_KEY", "critical");
      const { commitResourceCredentials } = await import("../providers/_credential-stage.ts");
      credentialPhase(context, "critical");
      await commitResourceCredentials(context, { ...resource }, () => {
        throw new Error("must not create");
      });
      expect(h.callsTo("add")).toEqual([]);
      await commitResourceCredentials(context, resource, () => {});
      await commitResourceCredentials(context, resource, () => {
        throw new Error("must not retry");
      });
      expect(h.callsTo("add")).toHaveLength(1);
    } finally {
      closeCredentialStage(context);
    }
  });
  for (const valid of [true, false]) {
    test(`Supabase OAuth verifies before direct persistence (valid=${valid})`, async () => {
      const oldClient = process.env.SUPABASE_STACK_CLIENT_ID;
      process.env.SUPABASE_STACK_CLIENT_ID = "inert-client";
      const mock = spyOn(oauth, "runPkceFlow").mockResolvedValue({
        access_token: "synthetic-oauth-token",
        token_type: "bearer",
        expires_in: 60,
      });
      let verifies = 0;
      syntheticFetch((url) => {
        expect(url).toBe("https://api.supabase.com/v1/profile");
        verifies++;
        expect(h.callsTo("add")).toEqual([]);
        return valid
          ? Response.json({ id: "inert-user" })
          : new Response("inert invalid", { status: 401 });
      });
      try {
        if (valid) {
          const auth = await supabase.login(ctx());
          expect(auth.identity?.id).toBe("inert-user");
          expect(auth.expiresAt).toBeGreaterThan(Date.now());
          expect(h.callsTo("add")).toHaveLength(1);
        } else {
          await expect(supabase.login(ctx())).rejects.toMatchObject({
            code: "SUPABASE_AUTH_INVALID",
            message: "Supabase rejected that access token.",
          });
          expect(h.callsTo("add")).toEqual([]);
        }
        expect(mock).toHaveBeenCalledTimes(1);
        expect(verifies).toBe(1);
      } finally {
        mock.mockRestore();
        if (oldClient === undefined)
          Reflect.deleteProperty(process.env, "SUPABASE_STACK_CLIENT_ID");
        else process.env.SUPABASE_STACK_CLIENT_ID = oldClient;
      }
    });
  }
  test("new staged auth commit never reflects producer output or input values", async () => {
    const bin = join(h.dir, "phantom");
    const original = readFileSync(bin, "utf8");
    writeFileSync(
      bin,
      original.replace(
        "  add)\n",
        '  add)\n    echo "synthetic-key response-secret-sentinel" >&2; exit 9\n',
      ),
    );
    const p = factory();
    p.deprovision = async () => {};
    const error = await run(p).catch((e: Error) => e);
    expect(error).toMatchObject({ code: "ADD_SERVICE_ROLLED_BACK" });
    expect((error as Error).message).toContain("Credential storage could not be confirmed");
    expect((error as Error).message).not.toContain("synthetic-key");
    expect((error as Error).message).not.toContain("response-secret-sentinel");
    expect(h.callsTo("remove")).toEqual([]);
    assertNoConfig();
  });
  test("direct login producer failure cannot claim signed in or echo producer output", async () => {
    const bin = join(h.dir, "phantom");
    const original = readFileSync(bin, "utf8");
    writeFileSync(
      bin,
      original.replace(
        "  add)\n",
        '  add)\n    echo "synthetic-key response-secret-sentinel" >&2; exit 9\n',
      ),
    );
    const error = await factory()
      .login(ctx())
      .catch((e: Error) => e);
    expect(error).toMatchObject({
      code: "PHANTOM_EXEC_FAILED",
      message: "Credential storage could not be confirmed.",
    });
    expect(await readVault(h.dir)).toEqual({});
  });
  test("config failure after MCP has exact phase and only actual completed creates are tracked", async () => {
    const p = factory();
    p.deprovision = async () => {};
    p.materialize = async () => {
      // Keep original readConfig preflight successful; make only the later
      // config write fail by turning its instance path into a directory.
      const { unlinkSync, mkdirSync } = await import("node:fs");
      unlinkSync(join(cwd, ".stack.local.toml"));
      mkdirSync(join(cwd, ".stack.local.toml"));
      return { secrets: { RESOURCE_KEY: "resource" }, mcp: { name: "inert", command: "echo" } };
    };
    const error = await run(p).catch((e: Error) => e);
    expect((error as Error).message).toContain('step "config write"');
    expect(h.callsTo("add").map((c) => c.args[0])).toEqual(["RESOURCE_KEY", "FIXTURE_KEY"]);
    expect(h.callsTo("remove").map((c) => c.args[0])).toEqual(["RESOURCE_KEY", "FIXTURE_KEY"]);
    const mcp = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.inert).toBeUndefined();
  });
});
