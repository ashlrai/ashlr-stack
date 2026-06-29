/**
 * Provision Schema Codegen — OpenAPI 3.1 + Terraform HCL Docs Export
 *
 * Extends the provision-schema TypeScript codegen with two new entry points:
 *
 *   - `generateOpenApiResource(providerName, schema)` — emits a reusable
 *     OpenAPI 3.1 component fragment: `#/components/schemas/ProvisionResponse_<Provider>`
 *
 *   - `generateTerraformResource(providerName, schema)` — emits a valid HCL
 *     `resource "<provider>_stack_provisioned" { }` block with all required
 *     fields documented as comments.
 *
 *   - `runCodegenForAllProviders(opts)` — writes OpenAPI fragments to
 *     `packages/site/public/schemas/` and HCL docs to
 *     `packages/site/public/terraform/`, then auto-registers every
 *     new provider schema found at build time.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getProviderSchema,
  listRegisteredSchemas,
  type JsonSchemaProperty,
  type ProvisionResponseSchema,
} from "./provision-schema.ts";
import {
  generateAllComplianceRulesJson,
  generateComplianceRulesJson,
  listComplianceProviders,
  type ComplianceRulesJson,
} from "./provision-compliance.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str.replace(/(^\w|-\w)/g, (m) => m.replace("-", "").toUpperCase());
}

function toTerraformIdentifier(name: string): string {
  // Lowercase, replace hyphens/spaces with underscores
  return name.toLowerCase().replace(/[-\s]+/g, "_");
}

/**
 * Convert a JsonSchemaProperty type to an OpenAPI 3.1-compatible type object.
 * OpenAPI 3.1 uses JSON Schema draft 2020-12 natively, so we can emit the
 * type field directly — including type arrays and nullable via `null` union.
 */
function jsonSchemaPropertyToOpenApi(
  prop: JsonSchemaProperty,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Type — handle nullable + union
  const types = Array.isArray(prop.type)
    ? [...prop.type]
    : prop.type
      ? [prop.type]
      : [];
  if (prop.nullable && !types.includes("null")) types.push("null");

  if (types.length === 0) {
    // no-op — OpenAPI allows omitting type
  } else if (types.length === 1) {
    out.type = types[0];
  } else {
    out.type = types; // OpenAPI 3.1 supports type arrays
  }

  if (prop.description) out.description = prop.description;
  if (prop.pattern) out.pattern = prop.pattern;
  if (prop.minLength !== undefined) out.minLength = prop.minLength;
  if (prop.maxLength !== undefined) out.maxLength = prop.maxLength;
  if (prop.minimum !== undefined) out.minimum = prop.minimum;
  if (prop.maximum !== undefined) out.maximum = prop.maximum;
  if (prop.enum !== undefined) out.enum = prop.enum;

  if (prop.properties) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prop.properties)) {
      props[k] = jsonSchemaPropertyToOpenApi(v);
    }
    out.properties = props;
  }
  if (prop.required) out.required = prop.required;
  if (prop.additionalProperties !== undefined) {
    out.additionalProperties =
      typeof prop.additionalProperties === "boolean"
        ? prop.additionalProperties
        : jsonSchemaPropertyToOpenApi(prop.additionalProperties);
  }
  if (prop.items) out.items = jsonSchemaPropertyToOpenApi(prop.items);

  return out;
}

// ---------------------------------------------------------------------------
// OpenAPI codegen
// ---------------------------------------------------------------------------

export interface OpenApiResourceFragment {
  /** The schema name (key inside #/components/schemas) */
  schemaName: string;
  /** The full fragment object — merge into your openapi.json components.schemas */
  fragment: Record<string, unknown>;
  /** JSON string of the fragment, ready to write to disk */
  json: string;
}

/**
 * Generate a reusable OpenAPI 3.1 component schema fragment for a provider's
 * provision response. The fragment can be merged into an existing openapi.json
 * under `components.schemas`.
 *
 * Schema name: `ProvisionResponse_<PascalCaseProvider>`
 *
 * Example:
 * ```
 * const { schemaName, fragment } = generateOpenApiResource("supabase", schema);
 * // schemaName === "ProvisionResponse_Supabase"
 * // fragment is the JSON Schema object for the component
 * ```
 */
export function generateOpenApiResource(
  providerName: string,
  schema: ProvisionResponseSchema,
): OpenApiResourceFragment {
  const schemaName = `ProvisionResponse_${toPascalCase(providerName)}`;

  const fragment: Record<string, unknown> = {
    title: schema.title,
    ...(schema.description ? { description: schema.description } : {}),
    ...jsonSchemaPropertyToOpenApi(schema.schema),
    // OpenAPI 3.1 extension: document the Stack field mapping
    "x-stack-mapping": {
      id: schema.mapping.id,
      displayName: schema.mapping.displayName,
      ...(schema.mapping.region ? { region: schema.mapping.region } : {}),
      ...(schema.mapping.meta ? { meta: schema.mapping.meta } : {}),
      ...(schema.mapping.urls ? { urls: schema.mapping.urls } : {}),
    },
  };

  const json = JSON.stringify({ [schemaName]: fragment }, null, 2);

  return { schemaName, fragment, json };
}

// ---------------------------------------------------------------------------
// Terraform HCL codegen
// ---------------------------------------------------------------------------

export interface TerraformResourceDoc {
  /** Terraform resource type, e.g. "vercel_stack_provisioned" */
  resourceType: string;
  /** The HCL block string */
  hcl: string;
}

/**
 * Generate a valid Terraform HCL `resource` block documenting the provision
 * response fields for a provider. This is a documentation/scaffolding artifact
 * — downstream users can wrap Stack resources in their IaC configs.
 *
 * All required fields are emitted as `= "<required>"` placeholders.
 * Optional fields are emitted as commented-out lines.
 *
 * Example output:
 * ```hcl
 * # AUTO-GENERATED by ashlr-stack codegen — do not edit by hand
 * # Provider: supabase (Supabase Project)
 * resource "supabase_stack_provisioned" "example" {
 *   # Required fields (mapped from provision response)
 *   id          = "<required>"  # Supabase project ref
 *   name        = "<required>"  # Human-readable project name
 *
 *   # Optional fields
 *   # region     = ""  # AWS region slug
 * }
 * ```
 */
export function generateTerraformResource(
  providerName: string,
  schema: ProvisionResponseSchema,
): TerraformResourceDoc {
  const resourceType = `${toTerraformIdentifier(providerName)}_stack_provisioned`;
  const lines: string[] = [];

  lines.push(`# AUTO-GENERATED by ashlr-stack codegen — do not edit by hand`);
  lines.push(`# Provider: ${providerName} (${schema.title})`);
  if (schema.description) {
    lines.push(`# ${schema.description}`);
  }
  lines.push(`#`);
  lines.push(`# Stack field mappings:`);
  lines.push(`#   id           ← ${schema.mapping.id}`);
  lines.push(`#   displayName  ← ${schema.mapping.displayName}`);
  if (schema.mapping.region) {
    lines.push(`#   region       ← ${schema.mapping.region}`);
  }
  if (schema.mapping.meta) {
    for (const [k, v] of Object.entries(schema.mapping.meta)) {
      lines.push(`#   meta.${k.padEnd(8)} ← ${v}`);
    }
  }
  lines.push(``);
  lines.push(`resource "${resourceType}" "example" {`);

  const props = schema.schema.properties ?? {};
  const required = new Set(schema.schema.required ?? []);

  // Max key length for alignment
  const allKeys = Object.keys(props);
  const maxLen = allKeys.reduce((m, k) => Math.max(m, k.length), 0);

  const requiredKeys = allKeys.filter((k) => required.has(k));
  const optionalKeys = allKeys.filter((k) => !required.has(k));

  if (requiredKeys.length > 0) {
    lines.push(`  # Required fields`);
    for (const key of requiredKeys) {
      const prop = props[key];
      const pad = " ".repeat(Math.max(0, maxLen - key.length));
      const comment = prop.description ? `  # ${prop.description}` : "";
      lines.push(`  ${key}${pad} = "<required>"${comment}`);
    }
  }

  if (optionalKeys.length > 0) {
    if (requiredKeys.length > 0) lines.push(``);
    lines.push(`  # Optional fields (uncomment to use)`);
    for (const key of optionalKeys) {
      const prop = props[key];
      const pad = " ".repeat(Math.max(0, maxLen - key.length));
      const comment = prop.description ? `  # ${prop.description}` : "";
      lines.push(`  # ${key}${pad} = ""${comment}`);
    }
  }

  lines.push(`}`);
  lines.push(``);

  return { resourceType, hcl: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Batch runner — writes files + auto-registers at build time
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Compliance rules codegen
// ---------------------------------------------------------------------------

export { type ComplianceRulesJson };

/**
 * Generate a compliance-rules.json descriptor for a single provider and return
 * it as a formatted JSON string.  Returns undefined when no rules are registered.
 */
export function generateComplianceRulesJsonString(provider: string): string | undefined {
  const descriptor = generateComplianceRulesJson(provider);
  if (!descriptor) return undefined;
  return JSON.stringify(descriptor, null, 2);
}

/**
 * Generate compliance-rules.json descriptors for ALL providers that have
 * registered compliance rules and return them as a map of provider → JSON string.
 */
export function generateAllComplianceRulesJsonStrings(): Record<string, string> {
  const all = generateAllComplianceRulesJson();
  const out: Record<string, string> = {};
  for (const [provider, descriptor] of Object.entries(all)) {
    out[provider] = JSON.stringify(descriptor, null, 2);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch runner opts / result (extended with compliance)
// ---------------------------------------------------------------------------

export interface CodegenRunnerOpts {
  /**
   * Absolute path to the site's public/ directory.
   * Defaults to the standard monorepo layout relative to this file.
   */
  publicDir?: string;
  /**
   * If true, skip writing files (useful in tests).
   */
  dryRun?: boolean;
  /**
   * Extra providers to register before running. Each entry should be
   * `{ name, schema }`. This lets build scripts inject newly discovered
   * providers before codegen runs.
   */
  extraProviders?: Array<{ name: string; schema: ProvisionResponseSchema }>;
  /**
   * When true (default), also emit compliance-rules.json files alongside the
   * OpenAPI and Terraform outputs.  Set to false to skip compliance codegen.
   */
  includeCompliance?: boolean;
}

export interface CodegenRunnerResult {
  providers: string[];
  openApiFiles: string[];
  terraformFiles: string[];
  /** Paths of written compliance-rules.json files (empty when includeCompliance is false). */
  complianceFiles: string[];
}

/**
 * Run OpenAPI + Terraform codegen for all registered providers and write the
 * output files.
 *
 * - OpenAPI fragments → `<publicDir>/schemas/<provider>-provision-response.json`
 * - Terraform HCL docs → `<publicDir>/terraform/<provider>-stack-provisioned.tf`
 *
 * Returns a summary of what was written.
 */
export function runCodegenForAllProviders(
  opts: CodegenRunnerOpts = {},
): CodegenRunnerResult {
  // Resolve publicDir relative to this file's location
  const thisFile = (import.meta as { url?: string; filename?: string }).filename
    ?? (import.meta as { url?: string }).url
    ?? "";
  const thisDir = thisFile.startsWith("file://")
    ? dirname(fileURLToPath(thisFile))
    : dirname(thisFile) || process.cwd();

  const publicDir =
    opts.publicDir ??
    resolve(thisDir, "../../../site/public");

  const schemasDir = resolve(publicDir, "schemas");
  const terraformDir = resolve(publicDir, "terraform");

  if (!opts.dryRun) {
    mkdirSync(schemasDir, { recursive: true });
    mkdirSync(terraformDir, { recursive: true });
  }

  // Register any extra providers supplied by the caller
  if (opts.extraProviders) {
    const { registerProviderSchema } = require("./provision-schema.ts");
    for (const { name, schema } of opts.extraProviders) {
      registerProviderSchema(name, schema);
    }
  }

  const providers = listRegisteredSchemas();
  const openApiFiles: string[] = [];
  const terraformFiles: string[] = [];
  const complianceFiles: string[] = [];

  // Compliance dir — only created when compliance codegen is enabled
  const includeCompliance = opts.includeCompliance !== false;
  const complianceDir = resolve(publicDir, "compliance");
  if (includeCompliance && !opts.dryRun) {
    mkdirSync(complianceDir, { recursive: true });
  }

  for (const providerName of providers) {
    const schema = getProviderSchema(providerName);
    if (!schema) continue;

    // OpenAPI fragment
    const openApi = generateOpenApiResource(providerName, schema);
    const openApiPath = resolve(
      schemasDir,
      `${providerName}-provision-response.json`,
    );
    if (!opts.dryRun) {
      writeFileSync(openApiPath, openApi.json, "utf8");
    }
    openApiFiles.push(openApiPath);

    // Terraform HCL doc
    const terraform = generateTerraformResource(providerName, schema);
    const terraformPath = resolve(
      terraformDir,
      `${providerName}-stack-provisioned.tf`,
    );
    if (!opts.dryRun) {
      writeFileSync(terraformPath, terraform.hcl, "utf8");
    }
    terraformFiles.push(terraformPath);
  }

  // Compliance rules JSON — one file per provider that has registered rules
  if (includeCompliance) {
    for (const providerName of listComplianceProviders()) {
      const jsonStr = generateComplianceRulesJsonString(providerName);
      if (!jsonStr) continue;
      const compliancePath = resolve(
        complianceDir,
        `${providerName}-compliance-rules.json`,
      );
      if (!opts.dryRun) {
        writeFileSync(compliancePath, jsonStr, "utf8");
      }
      complianceFiles.push(compliancePath);
    }
  }

  return { providers, openApiFiles, terraformFiles, complianceFiles };
}
