import { describe, expect, test } from "bun:test";
import {
  generateOpenApiResource,
  generateTerraformResource,
  runCodegenForAllProviders,
} from "../codegen.ts";
import {
  getProviderSchema,
  listRegisteredSchemas,
  registerProviderSchema,
  type ProvisionResponseSchema,
} from "../provision-schema.ts";

// ---------------------------------------------------------------------------
// generateOpenApiResource
// ---------------------------------------------------------------------------

describe("generateOpenApiResource — OpenAPI 3.1 component fragment", () => {
  test("supabase: schemaName follows ProvisionResponse_<Pascal> convention", () => {
    const schema = getProviderSchema("supabase")!;
    const { schemaName } = generateOpenApiResource("supabase", schema);
    expect(schemaName).toBe("ProvisionResponse_Supabase");
  });

  test("neon: schemaName follows convention", () => {
    const schema = getProviderSchema("neon")!;
    const { schemaName } = generateOpenApiResource("neon", schema);
    expect(schemaName).toBe("ProvisionResponse_Neon");
  });

  test("vercel: fragment has correct title", () => {
    const schema = getProviderSchema("vercel")!;
    const { fragment } = generateOpenApiResource("vercel", schema);
    expect(fragment.title).toBe("Vercel Project");
  });

  test("fragment contains x-stack-mapping extension", () => {
    const schema = getProviderSchema("supabase")!;
    const { fragment } = generateOpenApiResource("supabase", schema);
    const mapping = fragment["x-stack-mapping"] as Record<string, unknown>;
    expect(mapping).toBeDefined();
    expect(mapping.id).toBe("id");
    expect(mapping.displayName).toBe("name");
    expect(mapping.region).toBe("region");
  });

  test("fragment preserves required fields array", () => {
    const schema = getProviderSchema("supabase")!;
    const { fragment } = generateOpenApiResource("supabase", schema);
    expect(Array.isArray(fragment.required)).toBe(true);
    expect((fragment.required as string[]).includes("id")).toBe(true);
    expect((fragment.required as string[]).includes("name")).toBe(true);
  });

  test("fragment preserves properties with descriptions", () => {
    const schema = getProviderSchema("neon")!;
    const { fragment } = generateOpenApiResource("neon", schema);
    const props = fragment.properties as Record<string, Record<string, unknown>>;
    expect(props).toBeDefined();
    expect(props.id.description).toBe("Neon project id");
    expect(props.pg_version.minimum).toBe(14);
  });

  test("vercel framework field: type array includes null in fragment", () => {
    const schema = getProviderSchema("vercel")!;
    const { fragment } = generateOpenApiResource("vercel", schema);
    const props = fragment.properties as Record<string, Record<string, unknown>>;
    const frameworkType = props.framework.type;
    expect(Array.isArray(frameworkType)).toBe(true);
    expect((frameworkType as string[]).includes("null")).toBe(true);
    expect((frameworkType as string[]).includes("string")).toBe(true);
  });

  test("json output is valid JSON and round-trips correctly", () => {
    const schema = getProviderSchema("stripe")!;
    const { schemaName, fragment, json } = generateOpenApiResource("stripe", schema);
    // Must be parseable
    const parsed = JSON.parse(json);
    // Top-level key must be the schemaName
    expect(parsed[schemaName]).toBeDefined();
    // Round-trip: parsed fragment must match
    expect(JSON.stringify(parsed[schemaName])).toBe(JSON.stringify(fragment));
  });

  test("codegen is deterministic (same inputs → same output)", () => {
    const schema = getProviderSchema("github")!;
    const r1 = generateOpenApiResource("github", schema);
    const r2 = generateOpenApiResource("github", schema);
    expect(r1.json).toBe(r2.json);
    expect(r1.schemaName).toBe(r2.schemaName);
  });

  test("github: x-stack-mapping meta entries are present", () => {
    const schema = getProviderSchema("github")!;
    const { fragment } = generateOpenApiResource("github", schema);
    const mapping = fragment["x-stack-mapping"] as Record<string, unknown>;
    const meta = mapping.meta as Record<string, string>;
    expect(meta.node_id).toBe("node_id");
    expect(meta.type).toBe("type");
  });

  test("fragment type is 'object' for all standard providers", () => {
    for (const name of ["supabase", "neon", "vercel", "stripe", "github"]) {
      const schema = getProviderSchema(name)!;
      const { fragment } = generateOpenApiResource(name, schema);
      expect(fragment.type).toBe("object");
    }
  });

  test("schema-level description is included when present", () => {
    const schema = getProviderSchema("neon")!;
    const { fragment } = generateOpenApiResource("neon", schema);
    expect(typeof fragment.description).toBe("string");
    expect((fragment.description as string).length).toBeGreaterThan(0);
  });

  // Round-trip integrity: schema→OpenAPI→parse→re-validate required fields
  test("round-trip integrity: required fields survive JSON serialization", () => {
    const schema = getProviderSchema("supabase")!;
    const { json } = generateOpenApiResource("supabase", schema);
    const parsed = JSON.parse(json) as Record<string, Record<string, unknown>>;
    const fragmentKey = "ProvisionResponse_Supabase";
    const fragment = parsed[fragmentKey];
    expect(Array.isArray(fragment.required)).toBe(true);
    const required = fragment.required as string[];
    expect(required).toContain("id");
    expect(required).toContain("name");
  });

  test("round-trip integrity: property types survive JSON serialization", () => {
    const schema = getProviderSchema("neon")!;
    const { json } = generateOpenApiResource("neon", schema);
    const parsed = JSON.parse(json);
    const fragment = parsed["ProvisionResponse_Neon"];
    const props = fragment.properties as Record<string, Record<string, unknown>>;
    expect(props.id.type).toBe("string");
    expect(props.pg_version.type).toBe("integer");
    expect(props.pg_version.minimum).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// generateTerraformResource
// ---------------------------------------------------------------------------

describe("generateTerraformResource — HCL docs", () => {
  test("supabase: resource type follows <provider>_stack_provisioned convention", () => {
    const schema = getProviderSchema("supabase")!;
    const { resourceType } = generateTerraformResource("supabase", schema);
    expect(resourceType).toBe("supabase_stack_provisioned");
  });

  test("neon: resource type is correct", () => {
    const schema = getProviderSchema("neon")!;
    const { resourceType } = generateTerraformResource("neon", schema);
    expect(resourceType).toBe("neon_stack_provisioned");
  });

  test("vercel: resource type is correct", () => {
    const schema = getProviderSchema("vercel")!;
    const { resourceType } = generateTerraformResource("vercel", schema);
    expect(resourceType).toBe("vercel_stack_provisioned");
  });

  test("HCL output starts with AUTO-GENERATED comment", () => {
    const schema = getProviderSchema("supabase")!;
    const { hcl } = generateTerraformResource("supabase", schema);
    expect(hcl).toContain("AUTO-GENERATED");
    expect(hcl).toContain("do not edit by hand");
  });

  test("HCL contains resource block with correct type and 'example' label", () => {
    const schema = getProviderSchema("supabase")!;
    const { hcl } = generateTerraformResource("supabase", schema);
    expect(hcl).toContain('resource "supabase_stack_provisioned" "example" {');
    expect(hcl).toContain("}");
  });

  test("HCL documents required fields with <required> placeholder", () => {
    const schema = getProviderSchema("supabase")!;
    const { hcl } = generateTerraformResource("supabase", schema);
    expect(hcl).toContain('id');
    expect(hcl).toContain('"<required>"');
    expect(hcl).toContain('name');
  });

  test("HCL documents optional fields as commented-out lines", () => {
    const schema = getProviderSchema("supabase")!;
    const { hcl } = generateTerraformResource("supabase", schema);
    // Optional fields (region, organization_id, status) should be commented
    const lines = hcl.split("\n");
    const optionalLines = lines.filter((l) => l.trim().startsWith("# region") || l.trim().startsWith("# organization_id"));
    expect(optionalLines.length).toBeGreaterThan(0);
  });

  test("HCL contains Stack field mapping comments", () => {
    const schema = getProviderSchema("supabase")!;
    const { hcl } = generateTerraformResource("supabase", schema);
    expect(hcl).toContain("id           ←");
    expect(hcl).toContain("displayName  ←");
  });

  test("neon: HCL has pg_version documented", () => {
    const schema = getProviderSchema("neon")!;
    const { hcl } = generateTerraformResource("neon", schema);
    expect(hcl).toContain("pg_version");
  });

  test("neon: region_id mapping appears in header comments", () => {
    const schema = getProviderSchema("neon")!;
    const { hcl } = generateTerraformResource("neon", schema);
    expect(hcl).toContain("region_id");
  });

  test("github: HCL has login as required field", () => {
    const schema = getProviderSchema("github")!;
    const { hcl } = generateTerraformResource("github", schema);
    expect(hcl).toContain("login");
    expect(hcl).toContain('"<required>"');
  });

  test("HCL is syntactically well-formed: balanced braces", () => {
    for (const name of ["supabase", "neon", "vercel", "stripe", "github"]) {
      const schema = getProviderSchema(name)!;
      const { hcl } = generateTerraformResource(name, schema);
      const opens = (hcl.match(/\{/g) ?? []).length;
      const closes = (hcl.match(/\}/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  test("codegen is deterministic", () => {
    const schema = getProviderSchema("stripe")!;
    const r1 = generateTerraformResource("stripe", schema);
    const r2 = generateTerraformResource("stripe", schema);
    expect(r1.hcl).toBe(r2.hcl);
    expect(r1.resourceType).toBe(r2.resourceType);
  });

  test("provider name appears in HCL header comment", () => {
    const schema = getProviderSchema("stripe")!;
    const { hcl } = generateTerraformResource("stripe", schema);
    expect(hcl).toContain("stripe");
    expect(hcl).toContain("Stripe Account");
  });

  // Hyphenated provider name → valid terraform identifier
  test("hyphenated provider names produce valid terraform identifier", () => {
    const customSchema: ProvisionResponseSchema = {
      title: "My-Service Resource",
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
    const { resourceType, hcl } = generateTerraformResource("my-service", customSchema);
    expect(resourceType).toBe("my_service_stack_provisioned");
    // resource type in HCL must not contain hyphens
    expect(hcl).not.toMatch(/resource "my-service/);
    expect(hcl).toContain('resource "my_service_stack_provisioned"');
  });
});

// ---------------------------------------------------------------------------
// Round-trip integrity: schema → OpenAPI → re-parse, schema → HCL → parse
// ---------------------------------------------------------------------------

describe("round-trip integrity", () => {
  const providers = ["supabase", "neon", "vercel", "stripe", "github"];

  for (const name of providers) {
    test(`${name}: OpenAPI fragment JSON round-trips without data loss`, () => {
      const schema = getProviderSchema(name)!;
      const { schemaName, json } = generateOpenApiResource(name, schema);

      // Must be valid JSON
      let parsed: Record<string, unknown>;
      expect(() => {
        parsed = JSON.parse(json);
      }).not.toThrow();

      // Top-level key must be the schema name
      expect(Object.keys(parsed!)).toEqual([schemaName]);

      // Fragment must have title
      const fragment = parsed![schemaName] as Record<string, unknown>;
      expect(typeof fragment.title).toBe("string");

      // Fragment must have x-stack-mapping
      expect(fragment["x-stack-mapping"]).toBeDefined();

      // Required fields must match original schema
      if (schema.schema.required) {
        expect(fragment.required).toEqual(schema.schema.required);
      }
    });

    test(`${name}: OpenAPI → re-emit → same JSON (idempotent)`, () => {
      const schema = getProviderSchema(name)!;
      const r1 = generateOpenApiResource(name, schema);
      const r2 = generateOpenApiResource(name, schema);
      expect(r1.json).toBe(r2.json);
    });

    test(`${name}: Terraform HCL round-trip — resource type consistent`, () => {
      const schema = getProviderSchema(name)!;
      const r1 = generateTerraformResource(name, schema);
      const r2 = generateTerraformResource(name, schema);
      expect(r1.resourceType).toBe(r2.resourceType);
      expect(r1.hcl).toBe(r2.hcl);
    });
  }
});

// ---------------------------------------------------------------------------
// runCodegenForAllProviders — dry-run mode
// ---------------------------------------------------------------------------

describe("runCodegenForAllProviders (dry-run)", () => {
  test("returns all registered providers", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    const registered = listRegisteredSchemas();
    expect(result.providers.sort()).toEqual(registered.sort());
  });

  test("openApiFiles count matches providers count", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    expect(result.openApiFiles.length).toBe(result.providers.length);
  });

  test("terraformFiles count matches providers count", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    expect(result.terraformFiles.length).toBe(result.providers.length);
  });

  test("openApiFiles paths end with -provision-response.json", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    for (const path of result.openApiFiles) {
      expect(path).toMatch(/-provision-response\.json$/);
    }
  });

  test("terraformFiles paths end with -stack-provisioned.tf", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    for (const path of result.terraformFiles) {
      expect(path).toMatch(/-stack-provisioned\.tf$/);
    }
  });

  test("openApiFiles paths contain schemas directory segment", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    for (const path of result.openApiFiles) {
      expect(path).toContain("schemas");
    }
  });

  test("terraformFiles paths contain terraform directory segment", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    for (const path of result.terraformFiles) {
      expect(path).toContain("terraform");
    }
  });

  test("supabase path appears in openApiFiles", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    const supabasePath = result.openApiFiles.find((p) =>
      p.includes("supabase"),
    );
    expect(supabasePath).toBeDefined();
    expect(supabasePath).toMatch(/supabase-provision-response\.json$/);
  });

  test("supabase path appears in terraformFiles", () => {
    const result = runCodegenForAllProviders({ dryRun: true });
    const supabasePath = result.terraformFiles.find((p) =>
      p.includes("supabase"),
    );
    expect(supabasePath).toBeDefined();
    expect(supabasePath).toMatch(/supabase-stack-provisioned\.tf$/);
  });

  test("extra providers supplied at runtime are included in output", () => {
    const extraSchema: ProvisionResponseSchema = {
      title: "Test Extra Provider",
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
    // Register directly so dryRun picks it up
    registerProviderSchema("__codegen_test_extra__", extraSchema);

    const result = runCodegenForAllProviders({ dryRun: true });
    expect(result.providers).toContain("__codegen_test_extra__");
    const found = result.openApiFiles.find((p) =>
      p.includes("__codegen_test_extra__"),
    );
    expect(found).toBeDefined();
  });

  test("dry-run with custom publicDir uses that dir in paths", () => {
    const result = runCodegenForAllProviders({
      dryRun: true,
      publicDir: "/tmp/stack-codegen-test",
    });
    for (const path of result.openApiFiles) {
      expect(path.startsWith("/tmp/stack-codegen-test")).toBe(true);
    }
    for (const path of result.terraformFiles) {
      expect(path.startsWith("/tmp/stack-codegen-test")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// generateOpenApiResource — all 39 registered providers
// ---------------------------------------------------------------------------

describe("generateOpenApiResource — all 39 providers", () => {
  const allProviders = listRegisteredSchemas();

  for (const name of allProviders) {
    test(`${name}: generates valid OpenAPI fragment`, () => {
      const schema = getProviderSchema(name)!;
      expect(schema).toBeDefined();

      const { schemaName, fragment, json } = generateOpenApiResource(name, schema);

      // Schema name convention
      const pascal = name
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      expect(schemaName).toBe(`ProvisionResponse_${pascal}`);

      // Must be valid JSON
      expect(() => JSON.parse(json)).not.toThrow();

      // Must have title
      expect(typeof fragment.title).toBe("string");

      // Must have x-stack-mapping with id and displayName
      const mapping = fragment["x-stack-mapping"] as Record<string, unknown>;
      expect(typeof mapping.id).toBe("string");
      expect(typeof mapping.displayName).toBe("string");
    });
  }
});

// ---------------------------------------------------------------------------
// generateTerraformResource — all 39 registered providers
// ---------------------------------------------------------------------------

describe("generateTerraformResource — all 39 providers", () => {
  const allProviders = listRegisteredSchemas();

  for (const name of allProviders) {
    test(`${name}: generates valid HCL block`, () => {
      const schema = getProviderSchema(name)!;
      expect(schema).toBeDefined();

      const { resourceType, hcl } = generateTerraformResource(name, schema);

      // Resource type convention
      expect(resourceType).toBe(
        `${name.replace(/-/g, "_")}_stack_provisioned`,
      );

      // HCL must contain the resource declaration
      expect(hcl).toContain(`resource "${resourceType}" "example" {`);

      // Must have AUTO-GENERATED header
      expect(hcl).toContain("AUTO-GENERATED");

      // Must be balanced braces
      const opens = (hcl.match(/\{/g) ?? []).length;
      const closes = (hcl.match(/\}/g) ?? []).length;
      expect(opens).toBe(closes);

      // Must contain Stack field mapping comment
      expect(hcl).toContain("Stack field mappings:");
    });
  }
});
