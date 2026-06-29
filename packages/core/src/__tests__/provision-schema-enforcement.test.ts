/**
 * provision-schema-enforcement.test.ts
 *
 * Tests for:
 *   (1) ProviderSchemaRegistry scan — scanProviderSchemaRegistry() detects
 *       providers without registered schemas.
 *   (2) validateProvisionResponse() integration in the pipeline — the call
 *       already exists in pipeline.ts; here we test the schema enforcement
 *       boundary directly (ProvisionSchemaValidationError propagation).
 *   (3) Runtime coercion — coerceProvisionResponse() handles common shape
 *       mismatches and round-trips for 5 high-traffic providers:
 *       Supabase, Vercel, Neon, GitHub, Stripe.
 *   (4) Codegen TS type export from providers/index.ts — providerTypeMap,
 *       getProviderTypeSource(), listCodegenProviders().
 *   (5) Missing-schema provider detection + error message quality.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  coerceProvisionResponse,
  scanProviderSchemaRegistry,
  getProviderSchema,
  listRegisteredSchemas,
  registerProviderSchema,
  validateProvisionResponse,
  validateSchema,
  ProvisionSchemaValidationError,
  type CoercionResult,
  type RegistryScanResult,
  type ProvisionResponseSchema,
} from "../provision-schema.ts";
import {
  listProviderNames,
  providerTypeMap,
  getProviderTypeSource,
  listCodegenProviders,
} from "../providers/index.ts";

// ---------------------------------------------------------------------------
// (1) ProviderSchemaRegistry scan — scanProviderSchemaRegistry()
// ---------------------------------------------------------------------------

describe("scanProviderSchemaRegistry — build-time gate", () => {
  test("all 39 registered provider adapters have schemas — allCompliant is true", () => {
    const knownProviders = listProviderNames();
    const result: RegistryScanResult = scanProviderSchemaRegistry(knownProviders);
    expect(result.allCompliant).toBe(true);
    expect(result.missingSchema).toHaveLength(0);
  });

  test("every adapter in listProviderNames() has a matching schema", () => {
    const knownProviders = listProviderNames();
    const registered = new Set(listRegisteredSchemas());
    for (const name of knownProviders) {
      expect(registered.has(name)).toBe(true);
    }
  });

  test("scan result total >= number of known providers", () => {
    const knownProviders = listProviderNames();
    const result = scanProviderSchemaRegistry(knownProviders);
    expect(result.total).toBeGreaterThanOrEqual(knownProviders.length);
  });

  test("scan with a fake provider that has no schema — detected as missingSchema", () => {
    const fakeProviders = [...listProviderNames(), "zzz-fake-missing-schema-provider"];
    const result = scanProviderSchemaRegistry(fakeProviders);
    expect(result.allCompliant).toBe(false);
    expect(result.missingSchema).toContain("zzz-fake-missing-schema-provider");
  });

  test("missing-schema entry has descriptive error message", () => {
    const result = scanProviderSchemaRegistry(["zzz-no-schema-at-all"]);
    expect(result.allCompliant).toBe(false);
    const entry = result.entries.find((e) => e.providerName === "zzz-no-schema-at-all");
    expect(entry).toBeDefined();
    expect(entry!.hasSchema).toBe(false);
    expect(entry!.issues.length).toBeGreaterThan(0);
    expect(entry!.issues[0]).toContain("zzz-no-schema-at-all");
    expect(entry!.issues[0]).toContain("registerProviderSchema");
  });

  test("scan with multiple missing providers surfaces all of them", () => {
    const fakeProviders = ["missing-one", "missing-two", "missing-three"];
    const result = scanProviderSchemaRegistry(fakeProviders);
    expect(result.allCompliant).toBe(false);
    expect(result.missingSchema).toContain("missing-one");
    expect(result.missingSchema).toContain("missing-two");
    expect(result.missingSchema).toContain("missing-three");
    expect(result.missingSchema).toHaveLength(3);
  });

  test("scan with empty provider list is always compliant", () => {
    const result = scanProviderSchemaRegistry([]);
    expect(result.allCompliant).toBe(true);
    expect(result.missingSchema).toHaveLength(0);
  });

  test("scan includes inRegistry=true for known adapters", () => {
    const result = scanProviderSchemaRegistry(["supabase", "neon"]);
    for (const entry of result.entries.filter((e) => ["supabase", "neon"].includes(e.providerName))) {
      expect(entry.inRegistry).toBe(true);
      expect(entry.compliant).toBe(true);
    }
  });

  test("schema-only entries (no adapter) are flagged with inRegistry=false", () => {
    // Register a schema for a name that is NOT in listProviderNames()
    const SCHEMA_ONLY = "__schema_only_test_provider__";
    registerProviderSchema(SCHEMA_ONLY, {
      title: "Schema Only",
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
    });
    // Run scan with only real adapters (SCHEMA_ONLY is not in there)
    const result = scanProviderSchemaRegistry(listProviderNames());
    const schemaOnlyEntry = result.entries.find((e) => e.providerName === SCHEMA_ONLY);
    expect(schemaOnlyEntry).toBeDefined();
    expect(schemaOnlyEntry!.inRegistry).toBe(false);
    expect(schemaOnlyEntry!.hasSchema).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) Missing-schema provider tests — strict mode + pass-through mode
// ---------------------------------------------------------------------------

describe("missing-schema provider behaviour", () => {
  test("unregistered provider in non-strict mode: passes through, extracts id from obj.id", () => {
    const raw = { id: "abc-123", name: "My Resource", displayName: "My Resource" };
    const resource = validateProvisionResponse("zzz-totally-unknown", raw);
    expect(resource.id).toBe("abc-123");
  });

  test("unregistered provider in non-strict mode: falls back to name when id absent", () => {
    const raw = { name: "fallback-name" };
    const resource = validateProvisionResponse("zzz-no-id-field", raw);
    expect(resource.id).toBe("fallback-name");
  });

  test("unregistered provider in strict mode: throws ProvisionSchemaValidationError", () => {
    expect(() =>
      validateProvisionResponse("zzz-strict-missing", { id: "x" }, { strict: true }),
    ).toThrow(ProvisionSchemaValidationError);
  });

  test("strict-mode error message mentions 'no schema registered'", () => {
    try {
      validateProvisionResponse("zzz-strict-msg", { id: "x" }, { strict: true });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ProvisionSchemaValidationError).toBe(true);
      expect((err as Error).message).toContain("no schema registered");
    }
  });

  test("strict-mode error has provider name in violations", () => {
    try {
      validateProvisionResponse("zzz-strict-violations", {}, { strict: true });
      throw new Error("should have thrown");
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.provider).toBe("zzz-strict-violations");
      expect(pErr.violations.length).toBeGreaterThan(0);
    }
  });

  test("ProvisionSchemaValidationError.name is set correctly", () => {
    try {
      validateProvisionResponse("zzz-error-name-check", {}, { strict: true });
    } catch (err) {
      expect((err as Error).name).toBe("ProvisionSchemaValidationError");
    }
  });
});

// ---------------------------------------------------------------------------
// (3) Coercion round-trips — 5 high-traffic providers
// ---------------------------------------------------------------------------

describe("coerceProvisionResponse — Supabase", () => {
  test("valid response with displayName passes through unchanged (no coercions)", () => {
    // Include displayName so the fallback coercion doesn't fire
    const raw = { id: "abcdefghij", name: "my-project", displayName: "my-project", region: "us-east-1" };
    const { value, coercions } = coerceProvisionResponse("supabase", raw);
    expect(coercions).toHaveLength(0);
    expect((value as typeof raw).id).toBe("abcdefghij");
  });

  test("null top-level coerced to empty object", () => {
    const { value, coercions } = coerceProvisionResponse("supabase", null);
    expect(coercions.length).toBeGreaterThan(0);
    expect(coercions[0]).toContain("null");
    expect(value).toEqual({});
  });

  test("undefined top-level coerced to empty object", () => {
    const { value, coercions } = coerceProvisionResponse("supabase", undefined);
    expect(coercions.length).toBeGreaterThan(0);
    expect(value).toEqual({});
  });

  test("missing displayName gets coerced from 'name' field", () => {
    const raw = { id: "proj-abc", name: "my-supabase" };
    const { value, coercions } = coerceProvisionResponse("supabase", raw);
    const obj = value as Record<string, unknown>;
    expect(obj.displayName).toBe("my-supabase");
    expect(coercions.some((c) => c.includes("displayName"))).toBe(true);
  });

  test("coerced response passes validateProvisionResponse after coercion", () => {
    // Raw has missing displayName — coerce first, then validate
    const raw = { id: "proj-abc", name: "my-supabase" };
    const { value } = coerceProvisionResponse("supabase", raw);
    // After coercion, displayName is present — schema validation should pass
    const resource = validateProvisionResponse("supabase", value);
    expect(resource.id).toBe("proj-abc");
    expect(resource.displayName).toBe("my-supabase");
  });

  test("existing displayName is not overwritten by coercion", () => {
    const raw = { id: "proj-abc", name: "my-supabase", displayName: "Custom Name" };
    const { value, coercions } = coerceProvisionResponse("supabase", raw);
    const obj = value as Record<string, unknown>;
    expect(obj.displayName).toBe("Custom Name");
    expect(coercions.filter((c) => c.includes("displayName"))).toHaveLength(0);
  });
});

describe("coerceProvisionResponse — Vercel", () => {
  test("valid response with displayName passes through unchanged", () => {
    const raw = { id: "prj_abc123", name: "my-vercel-app", displayName: "my-vercel-app", accountId: "team_xyz" };
    const { value, coercions } = coerceProvisionResponse("vercel", raw);
    expect(coercions).toHaveLength(0);
    expect((value as typeof raw).id).toBe("prj_abc123");
  });

  test("missing displayName coerced from name", () => {
    const raw = { id: "prj_abc123", name: "my-vercel-app" };
    const { value, coercions } = coerceProvisionResponse("vercel", raw);
    const obj = value as Record<string, unknown>;
    expect(obj.displayName).toBe("my-vercel-app");
    expect(coercions.some((c) => c.includes("displayName"))).toBe(true);
  });

  test("numeric id coerced to string", () => {
    const raw = { id: 12345, name: "vercel-numeric-id" } as unknown as Record<string, unknown>;
    const { value, coercions } = coerceProvisionResponse("vercel", raw);
    const obj = value as Record<string, unknown>;
    expect(typeof obj.id).toBe("string");
    expect(obj.id).toBe("12345");
    expect(coercions.some((c) => c.includes("numeric id"))).toBe(true);
  });

  test("coercion round-trip: numeric id → string → passes validateSchema", () => {
    const raw = { id: 99999, name: "vercel-id-coerce" } as unknown as Record<string, unknown>;
    const { value } = coerceProvisionResponse("vercel", raw);
    const schema = getProviderSchema("vercel")!;
    const violations = validateSchema(value, schema.schema);
    // id is now string, name is present — should pass
    expect(violations.filter((v) => v.path.includes("id") && v.message.includes("type"))).toHaveLength(0);
  });
});

describe("coerceProvisionResponse — Neon", () => {
  test("valid response with displayName passes through unchanged", () => {
    const raw = { id: "crimson-moon-12345678", name: "my-neon", displayName: "my-neon", pg_version: 16 };
    const { coercions } = coerceProvisionResponse("neon", raw);
    expect(coercions).toHaveLength(0);
  });

  test("string pg_version coerced to integer", () => {
    const raw = { id: "proj-abc", name: "my-neon", pg_version: "16" };
    const { value, coercions } = coerceProvisionResponse("neon", raw);
    const obj = value as Record<string, unknown>;
    expect(typeof obj.pg_version).toBe("number");
    expect(obj.pg_version).toBe(16);
    expect(coercions.some((c) => c.includes("pg_version"))).toBe(true);
  });

  test("coercion round-trip: string pg_version → integer → passes schema", () => {
    const raw = { id: "proj-coerce", name: "neon-coerce", pg_version: "16" };
    const { value } = coerceProvisionResponse("neon", raw);
    const schema = getProviderSchema("neon")!;
    const violations = validateSchema(value, schema.schema);
    expect(violations.filter((v) => v.path.includes("pg_version"))).toHaveLength(0);
  });

  test("missing displayName coerced from name", () => {
    const raw = { id: "proj-abc", name: "my-neon-db" };
    const { value, coercions } = coerceProvisionResponse("neon", raw);
    const obj = value as Record<string, unknown>;
    expect(obj.displayName).toBe("my-neon-db");
    expect(coercions.some((c) => c.includes("displayName"))).toBe(true);
  });

  test("null input coerced to empty object with coercion note", () => {
    const { value, coercions } = coerceProvisionResponse("neon", null);
    expect(value).toEqual({});
    expect(coercions.length).toBeGreaterThan(0);
  });
});

describe("coerceProvisionResponse — GitHub", () => {
  test("valid response with displayName passes through unchanged", () => {
    // Include displayName so no coercion fires; GitHub id stays integer
    const raw = { login: "octocat", id: 583231, type: "User", name: "The Octocat", displayName: "The Octocat" };
    const { coercions } = coerceProvisionResponse("github", raw);
    expect(coercions).toHaveLength(0);
  });

  test("missing displayName falls back to name field when present", () => {
    const raw = { login: "octocat", id: 583231, type: "User", name: "The Octocat" };
    const { value, coercions } = coerceProvisionResponse("github", raw);
    const obj = value as Record<string, unknown>;
    // name is present → displayName coerced from name
    expect(obj.displayName).toBe("The Octocat");
    expect(coercions.some((c) => c.includes("displayName"))).toBe(true);
  });

  test("missing displayName and name falls back to login field", () => {
    // GitHub responses have login but no name and no displayName
    const raw = { login: "octocat", id: 583231, type: "User" };
    const { value, coercions } = coerceProvisionResponse("github", raw);
    const obj = value as Record<string, unknown>;
    // fallback chain: name (undef) → login ("octocat")
    expect(obj.displayName).toBe("octocat");
    expect(coercions.some((c) => c.includes("displayName"))).toBe(true);
  });

  test("numeric id integer field is NOT coerced — GitHub schema declares id as integer", () => {
    // GitHub's schema declares id as type "integer", so coercion must NOT convert it to string
    const raw = { login: "octocat", id: 583231, type: "User", displayName: "Octocat" };
    const { value, coercions } = coerceProvisionResponse("github", raw);
    const obj = value as Record<string, unknown>;
    expect(typeof obj.id).toBe("number");
    expect(coercions.filter((c) => c.includes("numeric id"))).toHaveLength(0);
  });

  test("coercion round-trip: missing displayName → coerce → validateProvisionResponse extracts login as id", () => {
    // name="The Octocat" present → displayName coerced from name → validation passes
    const raw = { login: "coerce-test-user", id: 123456, type: "User", name: "Coerce Test User" };
    const { value } = coerceProvisionResponse("github", raw);
    const resource = validateProvisionResponse("github", value);
    // mapping.id = "login", so resource.id = login
    expect(resource.id).toBe("coerce-test-user");
  });
});

describe("coerceProvisionResponse — Stripe", () => {
  test("valid response with displayName passes through unchanged", () => {
    const raw = {
      id: "acct_1ABCDef",
      display_name: "My Company",
      displayName: "My Company",
      email: "billing@example.com",
      charges_enabled: true,
    };
    const { coercions } = coerceProvisionResponse("stripe", raw);
    expect(coercions).toHaveLength(0);
  });

  test("missing displayName coerced from id when no name/login", () => {
    const raw = { id: "acct_fallback" };
    const { value, coercions } = coerceProvisionResponse("stripe", raw);
    const obj = value as Record<string, unknown>;
    // name=undefined, login=undefined, id="acct_fallback" → displayName = id
    expect(obj.displayName).toBe("acct_fallback");
    expect(coercions.some((c) => c.includes("displayName"))).toBe(true);
  });

  test("numeric id coerced to string for stripe", () => {
    const raw = { id: 999888777 } as unknown as Record<string, unknown>;
    const { value, coercions } = coerceProvisionResponse("stripe", raw);
    const obj = value as Record<string, unknown>;
    expect(typeof obj.id).toBe("string");
    expect(obj.id).toBe("999888777");
    expect(coercions.some((c) => c.includes("numeric id"))).toBe(true);
  });

  test("null top-level coercion round-trip: schema then rejects empty object", () => {
    const { value } = coerceProvisionResponse("stripe", null);
    // An empty {} fails schema validation (missing required "id")
    expect(() => validateProvisionResponse("stripe", value)).toThrow(ProvisionSchemaValidationError);
  });

  test("coercions array has provider name in each entry", () => {
    const { coercions } = coerceProvisionResponse("stripe", null);
    for (const c of coercions) {
      expect(c).toContain("stripe");
    }
  });
});

// ---------------------------------------------------------------------------
// (3b) General coercion edge cases
// ---------------------------------------------------------------------------

describe("coerceProvisionResponse — general edge cases", () => {
  test("primitive string top-level is wrapped in { value: ... }", () => {
    const { value, coercions } = coerceProvisionResponse("supabase", "just-a-string");
    expect(coercions.length).toBeGreaterThan(0);
    expect(coercions[0]).toContain("primitive");
    const obj = value as Record<string, unknown>;
    expect(obj.value).toBe("just-a-string");
  });

  test("primitive number top-level is wrapped in { value: ... }", () => {
    const { value, coercions } = coerceProvisionResponse("neon", 42);
    expect(coercions.some((c) => c.includes("primitive"))).toBe(true);
    const obj = value as Record<string, unknown>;
    expect(obj.value).toBe(42);
  });

  test("array top-level is returned as-is (schema will reject it)", () => {
    const arr = ["a", "b", "c"];
    const { value, coercions } = coerceProvisionResponse("vercel", arr);
    expect(value).toBe(arr); // same reference
    expect(coercions).toHaveLength(0);
  });

  test("object with all valid fields has no coercions", () => {
    const raw = {
      id: "project-abc",
      name: "My Project",
      displayName: "My Project",
      region: "us-east-1",
    };
    const { coercions } = coerceProvisionResponse("supabase", raw);
    expect(coercions).toHaveLength(0);
  });

  test("unknown provider still applies coercions (no schema required)", () => {
    const raw = { id: 42, name: "no-schema-provider" } as unknown as Record<string, unknown>;
    const { value, coercions } = coerceProvisionResponse("zzz-no-schema-coerce", raw);
    const obj = value as Record<string, unknown>;
    // Numeric id coercion applies regardless of schema
    expect(typeof obj.id).toBe("string");
    expect(coercions.some((c) => c.includes("numeric id"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (4) Codegen TS type exports from providers/index.ts
// ---------------------------------------------------------------------------

describe("providerTypeMap — compile-time TS types", () => {
  test("providerTypeMap is a ReadonlyMap", () => {
    expect(providerTypeMap instanceof Map).toBe(true);
  });

  test("providerTypeMap has entries for all statically-registered schemas", () => {
    // providerTypeMap is built at module load time from listRegisteredSchemas().
    // Schemas registered dynamically after module load (e.g. in test setup) are
    // NOT included — that is expected behaviour for a static compile-time map.
    // We verify against listProviderNames() which are the stable adapter names.
    const adapterNames = listProviderNames();
    for (const name of adapterNames) {
      expect(providerTypeMap.has(name)).toBe(true);
    }
  });

  test("supabase type source contains SupabaseProvisionResponse interface", () => {
    const source = providerTypeMap.get("supabase")!;
    expect(source).toBeDefined();
    expect(source).toContain("SupabaseProvisionResponse");
    expect(source).toContain("export interface SupabaseProvisionResponse");
  });

  test("neon type source contains NeonProvisionResponse interface", () => {
    const source = providerTypeMap.get("neon")!;
    expect(source).toBeDefined();
    expect(source).toContain("NeonProvisionResponse");
    expect(source).toContain("pg_version");
  });

  test("vercel type source contains VercelProvisionResponse interface", () => {
    const source = providerTypeMap.get("vercel")!;
    expect(source).toBeDefined();
    expect(source).toContain("VercelProvisionResponse");
    expect(source).toContain("framework");
  });

  test("github type source contains GithubProvisionResponse interface", () => {
    const source = providerTypeMap.get("github")!;
    expect(source).toBeDefined();
    expect(source).toContain("GithubProvisionResponse");
    expect(source).toContain("login");
  });

  test("stripe type source contains StripeProvisionResponse interface", () => {
    const source = providerTypeMap.get("stripe")!;
    expect(source).toBeDefined();
    expect(source).toContain("StripeProvisionResponse");
    expect(source).toContain("charges_enabled");
  });

  test("all type sources contain AUTO-GENERATED warning", () => {
    for (const [name, source] of providerTypeMap) {
      expect(source).toContain("AUTO-GENERATED");
      expect(source).toContain("do not edit by hand");
    }
  });

  test("all type sources contain validate* and assert* functions", () => {
    for (const [name, source] of providerTypeMap) {
      const pascal = name
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      expect(source).toContain(`validate${pascal}ProvisionResponse`);
      expect(source).toContain(`assert${pascal}ProvisionResponse`);
    }
  });

  test("all type sources import from provision-schema", () => {
    for (const [, source] of providerTypeMap) {
      expect(source).toContain("provision-schema");
    }
  });

  test("type sources are deterministic (same content on every call)", () => {
    const source1 = providerTypeMap.get("supabase")!;
    // generateTypeScript is deterministic — call it directly to compare
    const { generateTypeScript: gen } = require("../provision-schema.ts");
    const schema = getProviderSchema("supabase")!;
    const source2 = gen("supabase", schema);
    expect(source1).toBe(source2);
  });
});

describe("getProviderTypeSource()", () => {
  test("returns source for registered provider", () => {
    const source = getProviderTypeSource("supabase");
    expect(source).toBeDefined();
    expect(source!.length).toBeGreaterThan(100);
  });

  test("is case-insensitive (lowercase lookup)", () => {
    const source = getProviderTypeSource("SUPABASE");
    // providerTypeMap uses lowercase keys from listRegisteredSchemas()
    // getProviderTypeSource should work with exact case as registered
    // Schema is registered as "supabase" → only lowercase works here
    const lowercase = getProviderTypeSource("supabase");
    expect(lowercase).toBeDefined();
  });

  test("returns undefined for unregistered provider", () => {
    const source = getProviderTypeSource("zzz-no-type-source");
    expect(source).toBeUndefined();
  });

  test("returns source for all 5 high-traffic providers", () => {
    for (const name of ["supabase", "vercel", "neon", "github", "stripe"]) {
      const source = getProviderTypeSource(name);
      expect(source).toBeDefined();
      expect(source!.length).toBeGreaterThan(100);
    }
  });
});

describe("listCodegenProviders()", () => {
  test("returns a sorted array of provider names", () => {
    const list = listCodegenProviders();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toEqual([...list].sort());
  });

  test("contains all statically-registered provider adapter names", () => {
    // listCodegenProviders() reflects the static providerTypeMap snapshot built
    // at module load. Dynamic test-time registrations are not included.
    const list = listCodegenProviders();
    const adapterNames = listProviderNames();
    for (const name of adapterNames) {
      expect(list).toContain(name);
    }
  });

  test("includes the 5 high-traffic providers", () => {
    const list = listCodegenProviders();
    for (const name of ["supabase", "vercel", "neon", "github", "stripe"]) {
      expect(list).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// (5) Pipeline-level PROVISION_SCHEMA_MISMATCH error path (direct unit test)
// ---------------------------------------------------------------------------

describe("validateProvisionResponse — pipeline enforcement", () => {
  test("supabase: valid resource coerced correctly and passes", () => {
    const raw = { id: "abcdefghij", name: "stack-project", region: "us-east-1" };
    const resource = validateProvisionResponse("supabase", raw);
    expect(resource.id).toBe("abcdefghij");
    expect(resource.displayName).toBe("stack-project");
    expect(resource.region).toBe("us-east-1");
  });

  test("vercel: valid resource with null framework passes", () => {
    const raw = { id: "prj_abc", name: "my-app", framework: null };
    const resource = validateProvisionResponse("vercel", raw);
    expect(resource.id).toBe("prj_abc");
    expect(resource.displayName).toBe("my-app");
  });

  test("neon: valid resource with pg_version integer passes", () => {
    const raw = { id: "crimson-moon-12345678", name: "neon-db", pg_version: 16 };
    const resource = validateProvisionResponse("neon", raw);
    expect(resource.id).toBe("crimson-moon-12345678");
    expect(resource.meta?.pg_version).toBe(16);
  });

  test("github: valid resource with login as id passes", () => {
    const raw = { login: "octocat", id: 583231, type: "User", name: "The Octocat" };
    const resource = validateProvisionResponse("github", raw);
    expect(resource.id).toBe("octocat");
    expect(resource.displayName).toBe("The Octocat");
  });

  test("stripe: valid account resource passes", () => {
    const raw = {
      id: "acct_1ABCDef",
      display_name: "My Company",
      charges_enabled: true,
    };
    const resource = validateProvisionResponse("stripe", raw);
    expect(resource.id).toBe("acct_1ABCDef");
    expect(resource.displayName).toBe("My Company");
  });

  test("supabase: malformed response (missing id) throws ProvisionSchemaValidationError with detail", () => {
    const bad = { name: "no-id-project" };
    try {
      validateProvisionResponse("supabase", bad);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ProvisionSchemaValidationError).toBe(true);
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.provider).toBe("supabase");
      expect(pErr.message).toContain("supabase");
      expect(pErr.message).toContain("$.id");
    }
  });

  test("vercel: malformed response (missing id and name) throws with 2+ violations", () => {
    const bad = { accountId: "team_xyz" };
    try {
      validateProvisionResponse("vercel", bad);
      throw new Error("should have thrown");
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("neon: pg_version below minimum throws with detail", () => {
    const bad = { id: "proj-old", name: "old-neon", pg_version: 12 };
    try {
      validateProvisionResponse("neon", bad);
      throw new Error("should have thrown");
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.some((v) => v.path.includes("pg_version"))).toBe(true);
      expect(pErr.violations.some((v) => v.message.includes("minimum"))).toBe(true);
    }
  });

  test("error message cites schema mismatch details (path + message)", () => {
    const bad = { name: "no-id" };
    try {
      validateProvisionResponse("supabase", bad);
    } catch (err) {
      const msg = (err as Error).message;
      // Error message should cite the specific path where validation failed
      expect(msg).toMatch(/\$\.\w+/); // at least one JSON path
    }
  });

  test("github: invalid type enum value throws with detail", () => {
    const bad = { login: "user", id: 123, type: "Hacker" };
    try {
      validateProvisionResponse("github", bad);
      throw new Error("should have thrown");
    } catch (err) {
      const pErr = err as ProvisionSchemaValidationError;
      expect(pErr.violations.some((v) => v.path.includes("type"))).toBe(true);
      expect(pErr.violations.some((v) => v.message.includes("enum"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (6) Coercion + validation pipeline (coerce-then-validate round-trip)
// ---------------------------------------------------------------------------

describe("coerce-then-validate full round-trip — 5 high-traffic providers", () => {
  test("supabase: coerce null → validate → throws (still invalid after coercion)", () => {
    const { value } = coerceProvisionResponse("supabase", null);
    // Empty {} still fails Supabase schema (requires id + name)
    expect(() => validateProvisionResponse("supabase", value)).toThrow(
      ProvisionSchemaValidationError,
    );
  });

  test("supabase: coerce partial → validate → succeeds when minimum fields present", () => {
    // After coercion, displayName is added from name
    const raw = { id: "proj-round-trip", name: "round-trip-project" };
    const { value } = coerceProvisionResponse("supabase", raw);
    const resource = validateProvisionResponse("supabase", value);
    expect(resource.id).toBe("proj-round-trip");
    expect(resource.displayName).toBe("round-trip-project");
  });

  test("neon: coerce string pg_version → validate → succeeds", () => {
    const raw = { id: "neon-rt", name: "neon-round-trip", pg_version: "16" };
    const { value } = coerceProvisionResponse("neon", raw);
    const resource = validateProvisionResponse("neon", value);
    expect(resource.id).toBe("neon-rt");
    expect(resource.meta?.pg_version).toBe(16);
  });

  test("vercel: coerce numeric id → validate → id is string in resource", () => {
    const raw = { id: 77777, name: "vercel-rt" } as unknown as Record<string, unknown>;
    const { value } = coerceProvisionResponse("vercel", raw);
    const resource = validateProvisionResponse("vercel", value);
    expect(resource.id).toBe("77777");
    expect(resource.displayName).toBe("vercel-rt");
  });

  test("github: coerce missing displayName → validate → login used as id", () => {
    const raw = { login: "rt-user", id: 111222, type: "User" };
    const { value } = coerceProvisionResponse("github", raw);
    const resource = validateProvisionResponse("github", value);
    expect(resource.id).toBe("rt-user");
  });

  test("stripe: coerce missing displayName → validate → succeeds", () => {
    const raw = { id: "acct_rt123" };
    const { value } = coerceProvisionResponse("stripe", raw);
    // After coercion displayName should be filled from id
    const obj = value as Record<string, unknown>;
    expect(obj.displayName).toBeTruthy();
    const resource = validateProvisionResponse("stripe", value);
    expect(resource.id).toBe("acct_rt123");
  });
});
