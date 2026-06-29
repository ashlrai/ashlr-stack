import { describe, expect, test } from "bun:test";
import {
  generateTypeScript,
  getProviderSchema,
  listRegisteredSchemas,
  ProvisionSchemaValidationError,
  registerProviderSchema,
  resolvePath,
  type ProvisionResponseSchema,
  validateProvisionResponse,
  validateSchema,
  validateSchemaCompleteness,
} from "../provision-schema.ts";

// ---------------------------------------------------------------------------
// validateSchema — unit tests for the core JSON Schema validator
// ---------------------------------------------------------------------------

describe("validateSchema", () => {
  test("accepts a valid string", () => {
    expect(validateSchema("hello", { type: "string" })).toHaveLength(0);
  });

  test("rejects wrong type", () => {
    const v = validateSchema(42, { type: "string" });
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].message).toMatch(/expected type string/);
  });

  test("validates minLength", () => {
    const v = validateSchema("hi", { type: "string", minLength: 5 });
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].message).toMatch(/too short/);
  });

  test("validates pattern", () => {
    const ok = validateSchema("abc-123", { type: "string", pattern: "^[a-z]+-[0-9]+$" });
    expect(ok).toHaveLength(0);
    const fail = validateSchema("ABC-123", { type: "string", pattern: "^[a-z]+-[0-9]+$" });
    expect(fail.length).toBeGreaterThan(0);
  });

  test("validates enum", () => {
    const ok = validateSchema("User", { type: "string", enum: ["User", "Organization", "Bot"] });
    expect(ok).toHaveLength(0);
    const fail = validateSchema("Admin", {
      type: "string",
      enum: ["User", "Organization", "Bot"],
    });
    expect(fail.length).toBeGreaterThan(0);
    expect(fail[0].message).toMatch(/not in enum/);
  });

  test("validates required object fields", () => {
    const schema = {
      type: "object" as const,
      required: ["id", "name"],
      properties: {
        id: { type: "string" as const },
        name: { type: "string" as const },
      },
    };
    const ok = validateSchema({ id: "abc", name: "test" }, schema);
    expect(ok).toHaveLength(0);
    const fail = validateSchema({ id: "abc" }, schema);
    expect(fail.some((v) => v.path === "$.name")).toBe(true);
  });

  test("recurses into nested object properties", () => {
    const schema = {
      type: "object" as const,
      properties: {
        meta: {
          type: "object" as const,
          required: ["version"],
          properties: {
            version: { type: "integer" as const, minimum: 1 },
          },
        },
      },
    };
    const ok = validateSchema({ meta: { version: 3 } }, schema);
    expect(ok).toHaveLength(0);
    const fail = validateSchema({ meta: { version: 0 } }, schema);
    expect(fail.some((v) => v.path === "$.meta.version")).toBe(true);
  });

  test("validates array items", () => {
    const schema = {
      type: "array" as const,
      items: { type: "string" as const },
    };
    const ok = validateSchema(["a", "b"], schema);
    expect(ok).toHaveLength(0);
    const fail = validateSchema(["a", 42], schema);
    expect(fail.some((v) => v.path === "$[1]")).toBe(true);
  });

  test("accepts nullable field as null", () => {
    const schema = { type: "string" as const, nullable: true };
    expect(validateSchema(null, schema)).toHaveLength(0);
  });

  test("accepts type union (string | null)", () => {
    const schema = { type: ["string", "null"] as const };
    expect(validateSchema(null, schema)).toHaveLength(0);
    expect(validateSchema("hello", schema)).toHaveLength(0);
    const fail = validateSchema(42, schema);
    expect(fail.length).toBeGreaterThan(0);
  });

  test("integer is a valid number subtype", () => {
    expect(validateSchema(5, { type: "number" })).toHaveLength(0);
    expect(validateSchema(5, { type: "integer" })).toHaveLength(0);
    // non-integer fails integer check
    const fail = validateSchema(5.5, { type: "integer" });
    expect(fail.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// resolvePath
// ---------------------------------------------------------------------------

describe("resolvePath", () => {
  test("resolves top-level field", () => {
    expect(resolvePath({ id: "abc" }, "id")).toBe("abc");
  });

  test("resolves nested dot-notation path", () => {
    expect(resolvePath({ project: { ref: "xyzzy" } }, "project.ref")).toBe("xyzzy");
  });

  test("returns undefined for missing path", () => {
    expect(resolvePath({ a: 1 }, "b.c")).toBeUndefined();
  });

  test("returns undefined when intermediate is not an object", () => {
    expect(resolvePath({ a: "string" }, "a.nested")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Built-in provider schemas (supabase, neon, vercel, stripe, github)
// ---------------------------------------------------------------------------

describe("built-in provider schemas", () => {
  test("all five providers have registered schemas", () => {
    const registered = new Set(listRegisteredSchemas());
    for (const name of ["supabase", "neon", "vercel", "stripe", "github"]) {
      expect(registered.has(name)).toBe(true);
    }
  });

  test("supabase schema has correct mapping", () => {
    const s = getProviderSchema("supabase")!;
    expect(s.mapping.id).toBe("id");
    expect(s.mapping.displayName).toBe("name");
    expect(s.mapping.region).toBe("region");
  });

  test("neon schema has correct mapping", () => {
    const s = getProviderSchema("neon")!;
    expect(s.mapping.id).toBe("id");
    expect(s.mapping.region).toBe("region_id");
  });

  test("github schema maps login as id", () => {
    const s = getProviderSchema("github")!;
    expect(s.mapping.id).toBe("login");
  });
});

// ---------------------------------------------------------------------------
// validateProvisionResponse — validates and extracts a Resource
// ---------------------------------------------------------------------------

describe("validateProvisionResponse", () => {
  const validSupabase = {
    id: "abcdefghij",
    name: "my-project",
    region: "us-east-1",
    organization_id: "org_123",
  };

  test("supabase: valid response extracts Resource correctly", () => {
    const resource = validateProvisionResponse("supabase", validSupabase);
    expect(resource.id).toBe("abcdefghij");
    expect(resource.displayName).toBe("my-project");
    expect(resource.region).toBe("us-east-1");
    expect(resource.meta?.organization_id).toBe("org_123");
  });

  test("supabase: throws on missing required id", () => {
    const bad = { name: "my-project", region: "us-east-1" };
    expect(() => validateProvisionResponse("supabase", bad)).toThrow(
      ProvisionSchemaValidationError,
    );
  });

  test("supabase: throws on missing required name", () => {
    const bad = { id: "abc123" };
    expect(() => validateProvisionResponse("supabase", bad)).toThrow(
      ProvisionSchemaValidationError,
    );
  });

  test("neon: valid response with pg_version", () => {
    const raw = {
      id: "crimson-moon-12345678",
      name: "stack-neon",
      region_id: "aws-us-east-2",
      pg_version: 16,
    };
    const resource = validateProvisionResponse("neon", raw);
    expect(resource.id).toBe("crimson-moon-12345678");
    expect(resource.region).toBe("aws-us-east-2");
  });

  test("neon: rejects pg_version below 14", () => {
    const bad = {
      id: "proj-old",
      name: "old-neon",
      region_id: "aws-us-east-2",
      pg_version: 13,
    };
    expect(() => validateProvisionResponse("neon", bad)).toThrow(ProvisionSchemaValidationError);
  });

  test("vercel: valid response (framework null is ok)", () => {
    const raw = {
      id: "prj_abc123",
      name: "my-vercel-project",
      accountId: "team_xyz",
      framework: null,
    };
    const resource = validateProvisionResponse("vercel", raw);
    expect(resource.id).toBe("prj_abc123");
    expect(resource.meta?.accountId).toBe("team_xyz");
  });

  test("stripe: valid account response", () => {
    const raw = {
      id: "acct_1ABCDef",
      display_name: "My Company",
      email: "billing@example.com",
      country: "US",
      business_type: "company",
      charges_enabled: true,
    };
    const resource = validateProvisionResponse("stripe", raw);
    expect(resource.id).toBe("acct_1ABCDef");
    expect(resource.displayName).toBe("My Company");
    expect(resource.meta?.email).toBe("billing@example.com");
  });

  test("github: valid user response", () => {
    const raw = {
      login: "mason",
      id: 9876543,
      node_id: "MDQ6VXNlcjk4NzY1NDM=",
      name: "Mason Wyatt",
      email: "mason@example.com",
      type: "User",
      html_url: "https://github.com/mason",
    };
    const resource = validateProvisionResponse("github", raw);
    expect(resource.id).toBe("mason"); // login mapped as id
    expect(resource.displayName).toBe("Mason Wyatt");
  });

  test("github: rejects invalid type enum value", () => {
    const bad = {
      login: "mason",
      id: 9876543,
      type: "Admin", // not in enum
    };
    expect(() => validateProvisionResponse("github", bad)).toThrow(ProvisionSchemaValidationError);
  });

  test("unregistered provider: passes through without schema (non-strict)", () => {
    const raw = { id: "x123", name: "test", displayName: "Test" };
    // Should not throw — schema is optional
    const resource = validateProvisionResponse("some-unknown-provider", raw);
    expect(resource.id).toBe("x123");
  });

  test("unregistered provider: throws in strict mode", () => {
    expect(() =>
      validateProvisionResponse("some-unknown-provider-strict", {}, { strict: true }),
    ).toThrow(ProvisionSchemaValidationError);
  });
});

// ---------------------------------------------------------------------------
// validateSchemaCompleteness
// ---------------------------------------------------------------------------

describe("validateSchemaCompleteness", () => {
  test("all five built-in schemas are complete", () => {
    for (const name of ["supabase", "neon", "vercel", "stripe", "github"]) {
      const result = validateSchemaCompleteness(name);
      expect(result.hasSchema).toBe(true);
      expect(result.hasIdMapping).toBe(true);
      expect(result.hasDisplayNameMapping).toBe(true);
      // Some schemas may have minor warnings but core mappings must be valid
      expect(result.issues.filter((i) => i.includes("missing"))).toHaveLength(0);
    }
  });

  test("reports missing schema for unregistered provider", () => {
    const result = validateSchemaCompleteness("zzz-not-a-provider");
    expect(result.hasSchema).toBe(false);
    expect(result.issues).toContain("no schema registered");
  });

  test("reports missing id mapping", () => {
    const badSchema: ProvisionResponseSchema = {
      title: "Bad",
      mapping: { id: "", displayName: "name" },
      schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    };
    const result = validateSchemaCompleteness("__bad_test__", badSchema);
    expect(result.hasIdMapping).toBe(false);
    expect(result.issues.some((i) => i.includes("mapping.id"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateTypeScript — codegen output
// ---------------------------------------------------------------------------

describe("generateTypeScript", () => {
  test("generates valid TypeScript for supabase schema", () => {
    const schema = getProviderSchema("supabase")!;
    const code = generateTypeScript("supabase", schema);
    expect(code).toContain("SupabaseProvisionResponse");
    expect(code).toContain("export interface SupabaseProvisionResponse");
    expect(code).toContain("export function validateSupabaseProvisionResponse");
    expect(code).toContain("export function assertSupabaseProvisionResponse");
    // Should import from provision-schema
    expect(code).toContain("provision-schema");
  });

  test("generates valid TypeScript for github schema", () => {
    const schema = getProviderSchema("github")!;
    const code = generateTypeScript("github", schema);
    expect(code).toContain("GithubProvisionResponse");
    expect(code).toContain("login");
    expect(code).toContain("id");
  });

  test("generated code includes AUTO-GENERATED warning", () => {
    const schema = getProviderSchema("neon")!;
    const code = generateTypeScript("neon", schema);
    expect(code).toContain("AUTO-GENERATED");
    expect(code).toContain("do not edit by hand");
  });

  test("neon generated code includes pg_version as number type", () => {
    const schema = getProviderSchema("neon")!;
    const code = generateTypeScript("neon", schema);
    expect(code).toContain("pg_version");
    expect(code).toContain("number");
  });

  test("vercel framework field generates nullable type", () => {
    const schema = getProviderSchema("vercel")!;
    const code = generateTypeScript("vercel", schema);
    expect(code).toContain("framework");
    expect(code).toMatch(/string.*null|null.*string/);
  });

  test("codegen output compares consistently (snapshot-style)", () => {
    const schema = getProviderSchema("stripe")!;
    const code1 = generateTypeScript("stripe", schema);
    const code2 = generateTypeScript("stripe", schema);
    // Codegen must be deterministic
    expect(code1).toBe(code2);
  });
});

// ---------------------------------------------------------------------------
// registerProviderSchema — custom schema registration
// ---------------------------------------------------------------------------

describe("registerProviderSchema (custom schemas)", () => {
  const customName = "__test_custom_provider__";

  const customSchema: ProvisionResponseSchema = {
    title: "Custom Provider",
    description: "A test provider schema",
    mapping: {
      id: "resource_id",
      displayName: "resource_name",
      region: "deploy_region",
      meta: { tier: "plan_tier" },
    },
    schema: {
      type: "object",
      required: ["resource_id", "resource_name"],
      properties: {
        resource_id: { type: "string", minLength: 1 },
        resource_name: { type: "string", minLength: 1 },
        deploy_region: { type: "string" },
        plan_tier: { type: "string", enum: ["free", "pro", "enterprise"] },
      },
      additionalProperties: true,
    },
  };

  test("custom schema can be registered and retrieved", () => {
    registerProviderSchema(customName, customSchema);
    const retrieved = getProviderSchema(customName);
    expect(retrieved).toBeDefined();
    expect(retrieved?.title).toBe("Custom Provider");
  });

  test("custom schema validates a valid response", () => {
    registerProviderSchema(customName, customSchema);
    const raw = {
      resource_id: "res-abc-123",
      resource_name: "My Custom Resource",
      deploy_region: "eu-west-1",
      plan_tier: "pro",
    };
    const resource = validateProvisionResponse(customName, raw);
    expect(resource.id).toBe("res-abc-123");
    expect(resource.displayName).toBe("My Custom Resource");
    expect(resource.region).toBe("eu-west-1");
    expect(resource.meta?.tier).toBe("pro");
  });

  test("custom schema rejects missing required field", () => {
    registerProviderSchema(customName, customSchema);
    const bad = { resource_id: "res-abc" }; // missing resource_name
    expect(() => validateProvisionResponse(customName, bad)).toThrow(
      ProvisionSchemaValidationError,
    );
  });

  test("custom schema rejects invalid enum value", () => {
    registerProviderSchema(customName, customSchema);
    const bad = {
      resource_id: "res-abc",
      resource_name: "test",
      plan_tier: "startup", // not in enum
    };
    expect(() => validateProvisionResponse(customName, bad)).toThrow(
      ProvisionSchemaValidationError,
    );
  });

  test("ProvisionSchemaValidationError has correct provider name", () => {
    registerProviderSchema(customName, customSchema);
    try {
      validateProvisionResponse(customName, {});
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ProvisionSchemaValidationError).toBe(true);
      expect((err as ProvisionSchemaValidationError).provider).toBe(customName);
      expect((err as ProvisionSchemaValidationError).violations.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: codegen output validates real mock responses
// ---------------------------------------------------------------------------

describe("codegen integration — generated validator matches live mocks", () => {
  const mocks: Record<string, Record<string, unknown>> = {
    supabase: {
      id: "abcdefghij",
      name: "stack-mock-project",
      region: "us-east-1",
      organization_id: "org_mock123",
      status: "ACTIVE_HEALTHY",
    },
    neon: {
      id: "crimson-moon-12345678",
      name: "stack-mock-neon",
      region_id: "aws-us-east-2",
      pg_version: 16,
      created_at: "2024-01-01T00:00:00Z",
    },
    vercel: {
      id: "prj_mock123abc",
      name: "stack-mock-vercel",
      accountId: "team_mock456",
      framework: "nextjs",
      link: null,
    },
    stripe: {
      id: "acct_mock123abc",
      display_name: "Mock Business",
      email: "billing@example.com",
      country: "US",
      business_type: "company",
      charges_enabled: true,
    },
    github: {
      login: "mock-user",
      id: 12345678,
      node_id: "MDQ6VXNlcjEyMzQ1Njc4",
      name: "Mock User",
      email: "mock@example.com",
      company: "Example Corp",
      type: "User",
      html_url: "https://github.com/mock-user",
    },
  };

  for (const [provider, mockResponse] of Object.entries(mocks)) {
    test(`${provider}: mock response passes validateProvisionResponse`, () => {
      const resource = validateProvisionResponse(provider, mockResponse);
      expect(resource.id).toBeTruthy();
      expect(resource.displayName !== undefined).toBe(true);
    });

    test(`${provider}: mock response passes raw validateSchema`, () => {
      const schema = getProviderSchema(provider)!;
      expect(schema).toBeDefined();
      const violations = validateSchema(mockResponse, schema.schema);
      expect(violations).toHaveLength(0);
    });

    test(`${provider}: codegen output is non-empty and contains provider name`, () => {
      const schema = getProviderSchema(provider)!;
      const code = generateTypeScript(provider, schema);
      expect(code.length).toBeGreaterThan(100);
      // PascalCase of provider name should appear
      const pascal = provider.charAt(0).toUpperCase() + provider.slice(1);
      expect(code).toContain(pascal);
    });
  }
});

// ---------------------------------------------------------------------------
// New provider schemas (39 total — all providers have schemas registered)
// ---------------------------------------------------------------------------

describe("all 39 providers have registered schemas", () => {
  const allProviders = [
    "supabase", "neon", "vercel", "stripe", "github",
    "turso", "convex", "railway", "fly", "cloudflare",
    "render", "firebase", "upstash", "openai", "anthropic",
    "xai", "deepseek", "replicate", "braintrust", "modal",
    "posthog", "sentry", "linear", "resend", "sendgrid",
    "mailgun", "postmark", "clerk", "aws", "auth0",
    "datadog", "digitalocean", "gcp", "grafana", "hetzner",
    "launchdarkly", "mixpanel", "plausible", "workos",
  ];

  test("every provider has a registered schema", () => {
    const registered = new Set(listRegisteredSchemas());
    for (const name of allProviders) {
      expect(registered.has(name)).toBe(true);
    }
  });

  test("every registered schema passes completeness check", () => {
    for (const name of allProviders) {
      const result = validateSchemaCompleteness(name);
      expect(result.hasSchema).toBe(true);
      expect(result.hasIdMapping).toBe(true);
      expect(result.hasDisplayNameMapping).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline-level: PROVISION_SCHEMA_MISMATCH error
// ---------------------------------------------------------------------------

describe("validateProvisionResponse — happy path / PROVISION_SCHEMA_MISMATCH", () => {
  // (1) Happy path: schema passes, resource coerced correctly
  test("turso: happy path — schema passes, resource coerced correctly", () => {
    const raw = {
      name: "my-turso-db",
      primary_region: "iad",
      group: "default",
      type: "logical",
    };
    const resource = validateProvisionResponse("turso", raw);
    expect(resource.id).toBe("my-turso-db");
    expect(resource.displayName).toBe("my-turso-db");
    expect(resource.region).toBe("iad");
    expect(resource.meta?.group).toBe("default");
  });

  test("openai: happy path — synthetic resource coerced correctly", () => {
    const raw = { id: "default", displayName: "OpenAI", models: "42" };
    const resource = validateProvisionResponse("openai", raw);
    expect(resource.id).toBe("default");
    expect(resource.displayName).toBe("OpenAI");
    expect(resource.meta?.models).toBe("42");
  });

  test("anthropic: happy path — synthetic resource coerced correctly", () => {
    const raw = { id: "default", displayName: "Anthropic", models: "10" };
    const resource = validateProvisionResponse("anthropic", raw);
    expect(resource.id).toBe("default");
    expect(resource.displayName).toBe("Anthropic");
  });

  test("aws: happy path — account coerced correctly", () => {
    const raw = {
      id: "123456789012",
      displayName: "arn:aws:iam::123456789012:user/dev",
      account_id: "123456789012",
      arn: "arn:aws:iam::123456789012:user/dev",
    };
    const resource = validateProvisionResponse("aws", raw);
    expect(resource.id).toBe("123456789012");
    expect(resource.meta?.account_id).toBe("123456789012");
    expect(resource.meta?.arn).toBe("arn:aws:iam::123456789012:user/dev");
  });

  test("sentry: happy path — org coerced correctly", () => {
    const raw = { id: "my-org", displayName: "My Org", org_slug: "my-org" };
    const resource = validateProvisionResponse("sentry", raw);
    expect(resource.id).toBe("my-org");
    expect(resource.meta?.org_slug).toBe("my-org");
  });

  // (2) Missing required field — throws PROVISION_SCHEMA_MISMATCH (via ProvisionSchemaValidationError)
  test("turso: missing required 'name' — throws ProvisionSchemaValidationError", () => {
    const bad = { primary_region: "iad", group: "default" }; // no name
    expect(() => validateProvisionResponse("turso", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("turso", bad);
    } catch (err) {
      expect(err instanceof ProvisionSchemaValidationError).toBe(true);
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.provider).toBe("turso");
      expect(pErr.violations.some((v) => v.path.includes("name"))).toBe(true);
    }
  });

  test("openai: missing required 'id' — throws ProvisionSchemaValidationError", () => {
    const bad = { displayName: "OpenAI" }; // missing id
    expect(() => validateProvisionResponse("openai", bad)).toThrow(ProvisionSchemaValidationError);
  });

  test("railway: missing both required fields — throws with violations", () => {
    const bad = {}; // missing id and displayName
    expect(() => validateProvisionResponse("railway", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("railway", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("aws: missing required 'displayName' — throws ProvisionSchemaValidationError", () => {
    const bad = { id: "123456789012", account_id: "123456789012" }; // missing displayName
    expect(() => validateProvisionResponse("aws", bad)).toThrow(ProvisionSchemaValidationError);
  });

  // (3) Malformed response — throws with detail
  test("turso: entirely non-object response — throws with detail", () => {
    expect(() => validateProvisionResponse("turso", null)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("turso", null);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.message).toContain("turso");
      expect(pErr.violations.length).toBeGreaterThan(0);
    }
  });

  test("openai: array instead of object — throws with type mismatch detail", () => {
    expect(() => validateProvisionResponse("openai", ["id", "displayName"])).toThrow(
      ProvisionSchemaValidationError,
    );
    try {
      validateProvisionResponse("openai", ["id", "displayName"]);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations[0].message).toMatch(/expected type object/);
    }
  });

  test("anthropic: number instead of object — throws with type mismatch", () => {
    expect(() => validateProvisionResponse("anthropic", 42)).toThrow(
      ProvisionSchemaValidationError,
    );
  });

  test("sentry: id field is wrong type (number instead of string) — throws with detail", () => {
    const bad = { id: 999, displayName: "Sentry" }; // id must be string
    expect(() => validateProvisionResponse("sentry", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("sentry", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      // Either required field missing violation or type mismatch
      expect(pErr.violations.length).toBeGreaterThan(0);
    }
  });

  test("cloudflare: id is empty string — throws because mapped id resolves to empty", () => {
    // validateProvisionResponse throws when mapped id resolves to empty string
    const bad = { id: "", displayName: "Cloudflare" };
    expect(() => validateProvisionResponse("cloudflare", bad)).toThrow(
      ProvisionSchemaValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// Codegen: generateTypeScript for new providers
// ---------------------------------------------------------------------------

describe("generateTypeScript — new provider schemas", () => {
  const newProviders = [
    "turso", "openai", "anthropic", "aws", "sentry",
    "railway", "cloudflare", "datadog", "gcp", "auth0",
  ];

  for (const provider of newProviders) {
    test(`${provider}: generates valid TypeScript with interface and validators`, () => {
      const schema = getProviderSchema(provider)!;
      expect(schema).toBeDefined();
      const code = generateTypeScript(provider, schema);

      // Must contain AUTO-GENERATED warning
      expect(code).toContain("AUTO-GENERATED");

      // Must contain the provider-named interface
      const pascal = provider
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      expect(code).toContain(`${pascal}ProvisionResponse`);

      // Must contain validator and asserter functions
      expect(code).toContain(`validate${pascal}ProvisionResponse`);
      expect(code).toContain(`assert${pascal}ProvisionResponse`);

      // Must import from provision-schema
      expect(code).toContain("provision-schema");

      // Must be deterministic
      const code2 = generateTypeScript(provider, schema);
      expect(code).toBe(code2);
    });
  }
});
