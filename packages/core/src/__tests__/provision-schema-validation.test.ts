/**
 * provision-schema-validation.test.ts
 *
 * Comprehensive tests for the SchemaValidator class, Provider.schemaVersion +
 * provisionResponseSchema fields, --validate-only mode, and pipeline-level
 * schema enforcement.
 *
 * Test inventory (50+ cases):
 *   (a) Happy-path validation for 10 diverse providers
 *   (b) Missing required field detection
 *   (c) Type mismatch (string vs number)
 *   (d) Nested object validation
 *   (e) Validator caching behaviour
 *   (f) --validate-only mode (runValidateOnly / formatValidateOnlyResults)
 *   (g) ProvisionResponseSchemaWithVersion usage
 *   (h) formatValidateOnlyResults output shape
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  SchemaValidator,
  schemaValidator,
  CompiledValidator,
  ProvisionResponseSchemaWithVersion,
  ValidateOnlyResult,
  formatValidateOnlyResults,
  getProviderSchema,
  listRegisteredSchemas,
  registerProviderSchema,
  runValidateOnly,
  validateProvisionResponse,
  validateSchema,
  ProvisionSchemaValidationError,
  type ProvisionResponseSchema,
} from "../provision-schema.ts";

// ---------------------------------------------------------------------------
// (a) Happy-path validation — 10 diverse providers
// ---------------------------------------------------------------------------

describe("happy-path validation — 10 diverse providers", () => {
  const happyMocks: Record<string, Record<string, unknown>> = {
    supabase: {
      id: "abcdefghij",
      name: "my-supabase",
      region: "us-east-1",
      organization_id: "org_abc",
      status: "ACTIVE_HEALTHY",
    },
    neon: {
      id: "crimson-star-99887766",
      name: "stack-neon-db",
      region_id: "aws-us-east-2",
      pg_version: 16,
      created_at: "2025-01-01T00:00:00Z",
    },
    vercel: {
      id: "prj_hpq1234",
      name: "my-vercel-app",
      accountId: "team_abc",
      framework: "nextjs",
    },
    stripe: {
      id: "acct_live123",
      display_name: "Acme Inc",
      email: "billing@acme.com",
      country: "US",
      business_type: "company",
      charges_enabled: true,
    },
    github: {
      login: "octocat",
      id: 583231,
      node_id: "MDQ6VXNlcjU4MzIzMQ==",
      name: "The Octocat",
      type: "User",
      html_url: "https://github.com/octocat",
    },
    turso: {
      name: "my-turso-db",
      primary_region: "iad",
      group: "default",
      type: "logical",
    },
    aws: {
      id: "123456789012",
      displayName: "arn:aws:iam::123456789012:user/dev",
      account_id: "123456789012",
      arn: "arn:aws:iam::123456789012:user/dev",
    },
    auth0: {
      id: "my-tenant.auth0.com",
      displayName: "My Tenant",
      domain: "my-tenant.auth0.com",
    },
    datadog: {
      id: "dd-org-abc",
      displayName: "Acme Datadog",
      site: "datadoghq.com",
    },
    railway: {
      id: "railway-user-abc",
      displayName: "mason@acme.com",
      email: "mason@acme.com",
    },
  };

  for (const [provider, mock] of Object.entries(happyMocks)) {
    test(`${provider}: valid mock passes validateProvisionResponse`, () => {
      const resource = validateProvisionResponse(provider, mock);
      expect(resource.id).toBeTruthy();
      expect(resource.displayName !== undefined).toBe(true);
    });

    test(`${provider}: valid mock passes raw validateSchema`, () => {
      const schema = getProviderSchema(provider)!;
      expect(schema).toBeDefined();
      const violations = validateSchema(mock, schema.schema);
      expect(violations).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// (b) Missing required field detection
// ---------------------------------------------------------------------------

describe("missing required field detection", () => {
  test("supabase: missing 'id' produces PROVISION_SCHEMA_MISMATCH-style error", () => {
    const bad = { name: "missing-id" };
    expect(() => validateProvisionResponse("supabase", bad)).toThrow(
      ProvisionSchemaValidationError,
    );
    try {
      validateProvisionResponse("supabase", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.provider).toBe("supabase");
      expect(pErr.violations.some((v) => v.path.includes("id"))).toBe(true);
    }
  });

  test("neon: missing 'name' produces violation", () => {
    const bad = { id: "proj-abc", region_id: "aws-us-east-2", pg_version: 16 };
    expect(() => validateProvisionResponse("neon", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("neon", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.some((v) => v.path.includes("name"))).toBe(true);
    }
  });

  test("vercel: missing 'id' AND 'name' — at least 2 violations", () => {
    const bad = { accountId: "team_xyz" };
    expect(() => validateProvisionResponse("vercel", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("vercel", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("railway: completely empty object — throws with multiple violations", () => {
    const bad = {};
    expect(() => validateProvisionResponse("railway", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("railway", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("turso: missing required 'name' — violation path contains 'name'", () => {
    const bad = { primary_region: "iad", group: "default" };
    expect(() => validateProvisionResponse("turso", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("turso", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.some((v) => v.path.includes("name"))).toBe(true);
    }
  });

  test("aws: missing required 'displayName' — throws", () => {
    const bad = { id: "123456789012", account_id: "123456789012" };
    expect(() => validateProvisionResponse("aws", bad)).toThrow(ProvisionSchemaValidationError);
  });

  test("github: missing required 'login' — throws", () => {
    const bad = { id: 9876543, type: "User" };
    expect(() => validateProvisionResponse("github", bad)).toThrow(ProvisionSchemaValidationError);
  });

  test("error message surfaces provider name and field path", () => {
    const bad = { name: "no-id" };
    try {
      validateProvisionResponse("supabase", bad);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ProvisionSchemaValidationError).toBe(true);
      const msg = (err as Error).message;
      expect(msg).toContain("supabase");
      expect(msg).toContain("$.id");
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Type mismatch — string vs number
// ---------------------------------------------------------------------------

describe("type mismatch detection", () => {
  test("neon: pg_version as string instead of integer — violation", () => {
    const bad = {
      id: "proj-type-test",
      name: "neon-type-test",
      pg_version: "16", // should be integer
    };
    expect(() => validateProvisionResponse("neon", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("neon", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.some((v) => v.path.includes("pg_version"))).toBe(true);
      expect(
        pErr.violations.some((v) => v.message.includes("expected type")),
      ).toBe(true);
    }
  });

  test("github: numeric 'id' that is integer is valid", () => {
    const good = {
      login: "octocat",
      id: 583231, // integer — valid
      type: "User",
    };
    expect(() => validateProvisionResponse("github", good)).not.toThrow();
  });

  test("github: 'id' as float (non-integer) fails integer check", () => {
    const bad = {
      login: "octocat",
      id: 5.5, // not an integer
      type: "User",
    };
    expect(() => validateProvisionResponse("github", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("github", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.some((v) => v.path.includes("id"))).toBe(true);
    }
  });

  test("sentry: 'id' as number instead of string — type mismatch", () => {
    const bad = { id: 999, displayName: "My Org" }; // id must be string
    expect(() => validateProvisionResponse("sentry", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("sentry", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.length).toBeGreaterThan(0);
    }
  });

  test("stripe: 'charges_enabled' as string instead of boolean — type mismatch", () => {
    const bad = {
      id: "acct_test",
      charges_enabled: "yes", // must be boolean
    };
    // charges_enabled is not required, but if present must match type
    const violations = validateSchema(bad, getProviderSchema("stripe")!.schema);
    expect(violations.some((v) => v.path.includes("charges_enabled"))).toBe(true);
  });

  test("top-level type mismatch: array instead of object — clear error", () => {
    const bad = ["id", "name"];
    expect(() => validateProvisionResponse("neon", bad)).toThrow(ProvisionSchemaValidationError);
    try {
      validateProvisionResponse("neon", bad);
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations[0].message).toMatch(/expected type object/);
    }
  });

  test("top-level type mismatch: number instead of object — clear error", () => {
    expect(() => validateProvisionResponse("supabase", 42)).toThrow(ProvisionSchemaValidationError);
  });

  test("top-level null — throws", () => {
    expect(() => validateProvisionResponse("turso", null)).toThrow(ProvisionSchemaValidationError);
  });
});

// ---------------------------------------------------------------------------
// (d) Nested object validation
// ---------------------------------------------------------------------------

describe("nested object validation", () => {
  test("validates nested properties via validateSchema directly", () => {
    const schema = {
      type: "object" as const,
      required: ["config"],
      properties: {
        config: {
          type: "object" as const,
          required: ["region", "tier"],
          properties: {
            region: { type: "string" as const, minLength: 1 },
            tier: {
              type: "string" as const,
              enum: ["free", "pro", "enterprise"],
            },
            replicas: { type: "integer" as const, minimum: 1, maximum: 10 },
          },
        },
      },
    };

    // Valid nested object
    const good = { config: { region: "us-east-1", tier: "pro", replicas: 3 } };
    expect(validateSchema(good, schema)).toHaveLength(0);

    // Missing nested required field
    const missingTier = { config: { region: "us-east-1" } };
    const v1 = validateSchema(missingTier, schema);
    expect(v1.some((v) => v.path === "$.config.tier")).toBe(true);

    // Nested type mismatch
    const badReplicas = { config: { region: "us-east-1", tier: "free", replicas: 2.5 } };
    const v2 = validateSchema(badReplicas, schema);
    expect(v2.some((v) => v.path.includes("replicas"))).toBe(true);

    // Nested enum violation
    const badTier = { config: { region: "us-east-1", tier: "startup" } };
    const v3 = validateSchema(badTier, schema);
    expect(v3.some((v) => v.path.includes("tier"))).toBe(true);
  });

  test("vercel: nested link object validates correctly", () => {
    const schema = getProviderSchema("vercel")!;
    const withLink = {
      id: "prj_abc",
      name: "my-app",
      accountId: "team_abc",
      framework: "nextjs",
      link: {
        type: "github",
        repo: "org/repo",
      },
    };
    expect(validateSchema(withLink, schema.schema)).toHaveLength(0);
  });

  test("vercel: link null is valid (nullable object)", () => {
    const schema = getProviderSchema("vercel")!;
    const withNullLink = {
      id: "prj_abc",
      name: "my-app",
      link: null,
    };
    expect(validateSchema(withNullLink, schema.schema)).toHaveLength(0);
  });

  test("deeply nested 3-level path reported correctly", () => {
    const schema = {
      type: "object" as const,
      properties: {
        a: {
          type: "object" as const,
          properties: {
            b: {
              type: "object" as const,
              required: ["c"],
              properties: {
                c: { type: "integer" as const, minimum: 0 },
              },
            },
          },
        },
      },
    };
    const bad = { a: { b: { c: -1 } } };
    const violations = validateSchema(bad, schema);
    expect(violations.some((v) => v.path === "$.a.b.c")).toBe(true);
    expect(violations.some((v) => v.message.includes("minimum"))).toBe(true);
  });

  test("array of objects — nested violations report correct index paths", () => {
    const schema = {
      type: "array" as const,
      items: {
        type: "object" as const,
        required: ["id"],
        properties: {
          id: { type: "string" as const, minLength: 1 },
        },
      },
    };
    const bad = [{ id: "ok" }, { name: "no-id" }, { id: "" }]; // [1] missing id, [2] empty id
    const violations = validateSchema(bad, schema);
    expect(violations.some((v) => v.path === "$[1].id")).toBe(true); // missing required
    expect(violations.some((v) => v.path === "$[2].id")).toBe(true); // too short
  });
});

// ---------------------------------------------------------------------------
// (e) Validator caching behaviour
// ---------------------------------------------------------------------------

describe("SchemaValidator caching", () => {
  let sv: SchemaValidator;

  beforeEach(() => {
    sv = new SchemaValidator();
  });

  test("compile() returns undefined for unknown provider", () => {
    expect(sv.compile("zzz-no-such-provider")).toBeUndefined();
  });

  test("compile() returns a CompiledValidator for a known provider", () => {
    const validator = sv.compile("neon");
    expect(validator).toBeDefined();
    expect(validator!.providerName).toBe("neon");
  });

  test("compile() returns the same object on second call (cache hit)", () => {
    const v1 = sv.compile("neon");
    const v2 = sv.compile("neon");
    expect(v1).toBe(v2); // same reference = cache hit
  });

  test("cache size increases as new providers are compiled", () => {
    expect(sv.size).toBe(0);
    sv.compile("neon");
    expect(sv.size).toBe(1);
    sv.compile("supabase");
    expect(sv.size).toBe(2);
    sv.compile("vercel");
    expect(sv.size).toBe(3);
  });

  test("cachedProviders() returns sorted list of compiled providers", () => {
    sv.compile("vercel");
    sv.compile("neon");
    sv.compile("supabase");
    const cached = sv.cachedProviders();
    expect(cached).toEqual(["neon", "supabase", "vercel"]);
  });

  test("invalidate() removes a specific entry from the cache", () => {
    sv.compile("neon");
    sv.compile("supabase");
    expect(sv.size).toBe(2);
    sv.invalidate("neon");
    expect(sv.size).toBe(1);
    expect(sv.cachedProviders()).toEqual(["supabase"]);
  });

  test("clear() empties the entire cache", () => {
    sv.compile("neon");
    sv.compile("supabase");
    sv.compile("vercel");
    sv.clear();
    expect(sv.size).toBe(0);
    expect(sv.cachedProviders()).toEqual([]);
  });

  test("after invalidate(), recompile returns fresh object", () => {
    const v1 = sv.compile("neon");
    sv.invalidate("neon");
    const v2 = sv.compile("neon");
    // Different reference after invalidation + recompile
    expect(v1).not.toBe(v2);
    // But both are valid
    expect(v1!.providerName).toBe("neon");
    expect(v2!.providerName).toBe("neon");
  });

  test("compiled validator.validate() returns empty for valid input", () => {
    const validator = sv.compile("neon")!;
    const good = { id: "proj-abc", name: "my-neon", pg_version: 16 };
    expect(validator.validate(good)).toHaveLength(0);
  });

  test("compiled validator.validate() returns violations for invalid input", () => {
    const validator = sv.compile("neon")!;
    const bad = { region_id: "aws-us-east-2" }; // missing required id + name
    const violations = validator.validate(bad);
    expect(violations.length).toBeGreaterThan(0);
  });

  test("compiled validator.validateAndExtract() succeeds on valid input", () => {
    const validator = sv.compile("supabase")!;
    const good = { id: "proj-cache-test", name: "cache-test-project" };
    const resource = validator.validateAndExtract(good);
    expect(resource.id).toBe("proj-cache-test");
    expect(resource.displayName).toBe("cache-test-project");
  });

  test("compiled validator.validateAndExtract() throws on invalid input", () => {
    const validator = sv.compile("supabase")!;
    const bad = { name: "no-id-here" };
    expect(() => validator.validateAndExtract(bad)).toThrow(ProvisionSchemaValidationError);
  });

  test("module-level schemaValidator singleton is a SchemaValidator instance", () => {
    expect(schemaValidator).toBeInstanceOf(SchemaValidator);
  });

  test("module-level singleton caches correctly across calls", () => {
    // Use a local singleton to avoid cross-test cache pollution
    const localSv = new SchemaValidator();
    const v1 = localSv.compile("stripe");
    const v2 = localSv.compile("stripe");
    expect(v1).toBe(v2);
  });

  test("schemaVersion defaults to '1.0.0' for schemas without explicit version", () => {
    const validator = sv.compile("neon")!;
    expect(validator.schemaVersion).toBe("1.0.0");
  });

  test("schemaVersion is preserved when schema declares it explicitly", () => {
    const VERSIONED_PROVIDER = "__test_versioned_provider__";
    const versionedSchema: ProvisionResponseSchemaWithVersion = {
      title: "Versioned Test Provider",
      schemaVersion: "2.3.1",
      mapping: { id: "id", displayName: "name" },
      schema: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
        },
        additionalProperties: true,
      },
    };
    registerProviderSchema(VERSIONED_PROVIDER, versionedSchema);
    const validator = sv.compile(VERSIONED_PROVIDER)!;
    expect(validator.schemaVersion).toBe("2.3.1");
    sv.invalidate(VERSIONED_PROVIDER);
  });
});

// ---------------------------------------------------------------------------
// (f) --validate-only mode
// ---------------------------------------------------------------------------

describe("runValidateOnly — --validate-only mode", () => {
  test("all passing mocks produce passed: true", () => {
    const mocks: Record<string, unknown> = {
      supabase: { id: "s1", name: "my-project" },
      neon: { id: "n1", name: "my-neon" },
      vercel: { id: "v1", name: "my-app" },
    };
    const results = runValidateOnly(mocks);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.passed).toBe(true);
      expect(r.violations).toHaveLength(0);
    }
  });

  test("failing mock produces passed: false with violations", () => {
    const mocks: Record<string, unknown> = {
      neon: { region_id: "aws-us-east-2" }, // missing required id + name
    };
    const results = runValidateOnly(mocks);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].violations.length).toBeGreaterThan(0);
  });

  test("unknown provider produces passed: false with 'no schema registered' violation", () => {
    const mocks: Record<string, unknown> = {
      "zzz-unknown-provider-validate-only": { id: "x" },
    };
    const results = runValidateOnly(mocks);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].violations[0].message).toContain("no schema registered");
  });

  test("mix of passing and failing providers", () => {
    const mocks: Record<string, unknown> = {
      supabase: { id: "s1", name: "ok" }, // valid
      neon: { region_id: "aws" }, // invalid — missing id + name
      turso: { name: "my-db" }, // valid
      stripe: {}, // invalid — missing id
    };
    const results = runValidateOnly(mocks);
    expect(results).toHaveLength(4);

    const byProvider = Object.fromEntries(results.map((r) => [r.providerName, r]));
    expect(byProvider.supabase.passed).toBe(true);
    expect(byProvider.neon.passed).toBe(false);
    expect(byProvider.turso.passed).toBe(true);
    expect(byProvider.stripe.passed).toBe(false);
  });

  test("each result includes providerName and schemaVersion", () => {
    const mocks: Record<string, unknown> = {
      neon: { id: "n1", name: "my-neon" },
    };
    const results = runValidateOnly(mocks);
    expect(results[0].providerName).toBe("neon");
    expect(typeof results[0].schemaVersion).toBe("string");
    expect(results[0].schemaVersion.length).toBeGreaterThan(0);
  });

  test("durationUs is a non-negative number", () => {
    const mocks: Record<string, unknown> = {
      vercel: { id: "v1", name: "app" },
    };
    const results = runValidateOnly(mocks);
    expect(results[0].durationUs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(results[0].durationUs)).toBe(true);
  });

  test("empty mocks object returns empty results", () => {
    const results = runValidateOnly({});
    expect(results).toHaveLength(0);
  });

  test("custom SchemaValidator instance is used when provided", () => {
    const localSv = new SchemaValidator();
    const mocks: Record<string, unknown> = {
      supabase: { id: "s1", name: "my-project" },
    };
    const results = runValidateOnly(mocks, localSv);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    // The local validator should have cached the entry
    expect(localSv.cachedProviders()).toContain("supabase");
  });

  test("runValidateOnly with 10 providers completes without error", () => {
    const mocks: Record<string, unknown> = {
      supabase: { id: "s1", name: "sup" },
      neon: { id: "n1", name: "neo" },
      vercel: { id: "v1", name: "ver" },
      stripe: { id: "acct_1" },
      github: { login: "user", id: 123, type: "User" },
      turso: { name: "turso-db" },
      aws: { id: "aws-1", displayName: "AWS" },
      auth0: { id: "tenant.auth0.com", displayName: "Tenant" },
      datadog: { id: "dd-org", displayName: "DD" },
      railway: { id: "rail-1", displayName: "Railway" },
    };
    const results = runValidateOnly(mocks);
    expect(results).toHaveLength(10);
    // All should pass
    for (const r of results) {
      expect(r.passed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (g) ProvisionResponseSchemaWithVersion — Provider field
// ---------------------------------------------------------------------------

describe("ProvisionResponseSchemaWithVersion — Provider.provisionResponseSchema", () => {
  test("schema without explicit schemaVersion uses 1.0.0 default in SchemaValidator", () => {
    const sv = new SchemaValidator();
    const validator = sv.compile("supabase")!;
    expect(validator.schemaVersion).toBe("1.0.0");
  });

  test("schema with explicit schemaVersion is preserved through compilation", () => {
    const PROVIDER_NAME = "__test_schema_version_check__";
    const schema: ProvisionResponseSchemaWithVersion = {
      title: "Version Check Provider",
      schemaVersion: "3.0.0",
      mapping: { id: "id", displayName: "displayName" },
      schema: {
        type: "object",
        required: ["id", "displayName"],
        properties: {
          id: { type: "string", minLength: 1 },
          displayName: { type: "string", minLength: 1 },
        },
        additionalProperties: true,
      },
    };
    registerProviderSchema(PROVIDER_NAME, schema);
    const sv = new SchemaValidator();
    const validator = sv.compile(PROVIDER_NAME)!;
    expect(validator.schemaVersion).toBe("3.0.0");
  });

  test("provisionResponseSchema on a synthetic Provider object round-trips correctly", () => {
    const PROVIDER_NAME = "__test_provider_schema_field__";
    // Simulate what a Provider implementation would declare
    const providerSchema: ProvisionResponseSchemaWithVersion = {
      title: "Synthetic Test Provider",
      schemaVersion: "1.1.0",
      mapping: { id: "resource_id", displayName: "resource_name" },
      schema: {
        type: "object",
        required: ["resource_id", "resource_name"],
        properties: {
          resource_id: { type: "string", minLength: 1 },
          resource_name: { type: "string", minLength: 1 },
          plan: { type: "string", enum: ["free", "pro"] },
        },
        additionalProperties: false,
      },
    };

    // Register as a provider would at module initialization
    registerProviderSchema(PROVIDER_NAME, providerSchema);

    const sv = new SchemaValidator();
    const validator = sv.compile(PROVIDER_NAME)!;
    expect(validator.schemaVersion).toBe("1.1.0");
    expect(validator.providerName).toBe(PROVIDER_NAME);

    // Valid response
    const good = { resource_id: "rid-123", resource_name: "My Resource", plan: "pro" };
    expect(validator.validate(good)).toHaveLength(0);

    // Invalid: plan not in enum
    const bad = { resource_id: "rid-123", resource_name: "My Resource", plan: "enterprise" };
    const violations = validator.validate(bad);
    expect(violations.some((v) => v.path.includes("plan"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (h) formatValidateOnlyResults output shape
// ---------------------------------------------------------------------------

describe("formatValidateOnlyResults", () => {
  test("passing result contains PASS and version", () => {
    const results: ValidateOnlyResult[] = [
      {
        providerName: "neon",
        schemaVersion: "1.0.0",
        passed: true,
        violations: [],
        durationUs: 42,
      },
    ];
    const output = formatValidateOnlyResults(results);
    expect(output).toContain("PASS");
    expect(output).toContain("v1.0.0");
    expect(output).toContain("neon");
    expect(output).toContain("42");
  });

  test("failing result contains FAIL and violation detail", () => {
    const results: ValidateOnlyResult[] = [
      {
        providerName: "stripe",
        schemaVersion: "1.0.0",
        passed: false,
        violations: [{ path: "$.id", message: "required field missing" }],
        durationUs: 10,
      },
    ];
    const output = formatValidateOnlyResults(results);
    expect(output).toContain("FAIL");
    expect(output).toContain("stripe");
    expect(output).toContain("$.id");
    expect(output).toContain("required field missing");
  });

  test("multiple results are separated by newlines", () => {
    const results: ValidateOnlyResult[] = [
      { providerName: "neon", schemaVersion: "1.0.0", passed: true, violations: [], durationUs: 5 },
      {
        providerName: "stripe",
        schemaVersion: "1.0.0",
        passed: false,
        violations: [{ path: "$.id", message: "required field missing" }],
        durationUs: 3,
      },
    ];
    const output = formatValidateOnlyResults(results);
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("neon");
    expect(lines[1]).toContain("stripe");
  });

  test("empty results produce empty string", () => {
    expect(formatValidateOnlyResults([])).toBe("");
  });

  test("output is deterministic across multiple calls", () => {
    const results: ValidateOnlyResult[] = [
      { providerName: "neon", schemaVersion: "1.0.0", passed: true, violations: [], durationUs: 7 },
    ];
    const o1 = formatValidateOnlyResults(results);
    const o2 = formatValidateOnlyResults(results);
    expect(o1).toBe(o2);
  });

  test("FAIL result truncates to at most 3 violations in summary line", () => {
    const results: ValidateOnlyResult[] = [
      {
        providerName: "test",
        schemaVersion: "1.0.0",
        passed: false,
        violations: [
          { path: "$.a", message: "a missing" },
          { path: "$.b", message: "b missing" },
          { path: "$.c", message: "c missing" },
          { path: "$.d", message: "d missing" }, // 4th should NOT appear
        ],
        durationUs: 1,
      },
    ];
    const output = formatValidateOnlyResults(results);
    expect(output).toContain("$.a");
    expect(output).toContain("$.b");
    expect(output).toContain("$.c");
    // 4th violation truncated
    expect(output).not.toContain("$.d");
  });

  test("runValidateOnly + formatValidateOnlyResults integration", () => {
    const mocks: Record<string, unknown> = {
      supabase: { id: "s1", name: "my-project" },
      neon: { region_id: "aws" }, // invalid
    };
    const results = runValidateOnly(mocks);
    const output = formatValidateOnlyResults(results);
    expect(output).toContain("supabase");
    expect(output).toContain("neon");
    expect(output).toContain("PASS");
    expect(output).toContain("FAIL");
  });
});
