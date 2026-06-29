/**
 * Provision Schema Validation Framework
 *
 * Defines what constitutes a valid, successfully-provisioned resource across
 * all providers. Validates post-provision API responses against JSON Schema
 * before materialize() is called, catching malformed API responses early.
 *
 * Key entry points:
 *   - `registerProviderSchema(name, schema)` — register a schema for a provider
 *   - `validateProvisionResponse(providerName, raw)` — validate + coerce to Resource
 *   - `generateTypeScript(name, schema)` — codegen: emit TS types from a schema
 *   - `validateSchemaCompleteness(name, schema)` — check schema has required fields
 */

// ---------------------------------------------------------------------------
// JSON Schema types (subset we actually use — no external dependencies)
// ---------------------------------------------------------------------------

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface JsonSchemaProperty {
  type: JsonSchemaType | JsonSchemaType[];
  description?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  /** For type "object" */
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaProperty;
  /** For type "array" */
  items?: JsonSchemaProperty;
  /** Allow null by adding "null" to the type union */
  nullable?: boolean;
}

/**
 * Top-level schema for a provider's provision response.
 * Required fields map to the `Resource` interface in _base.ts.
 */
export interface ProvisionResponseSchema {
  /** Human label shown in CLI output. */
  title: string;
  description?: string;
  /**
   * Required field mappings: how to extract `id` and `displayName` from the
   * raw API response. Use dot-notation for nested fields, e.g. "project.id".
   */
  mapping: {
    /** Path into raw response that maps to Resource.id */
    id: string;
    /** Path into raw response that maps to Resource.displayName */
    displayName: string;
    /** Optional: path that maps to Resource.region */
    region?: string;
    /** Optional: record of paths that map into Resource.meta */
    meta?: Record<string, string>;
    /** Optional: record of paths that map into Materialized.urls */
    urls?: Record<string, string>;
  };
  /** Full JSON Schema for the raw API response body. */
  schema: JsonSchemaProperty;
}

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

const _registry = new Map<string, ProvisionResponseSchema>();

/**
 * Register a provision-response schema for a provider.
 * Idempotent: re-registering replaces the previous entry.
 */
export function registerProviderSchema(name: string, schema: ProvisionResponseSchema): void {
  _registry.set(name.toLowerCase(), schema);
}

/**
 * Retrieve a registered schema. Returns undefined if not found.
 */
export function getProviderSchema(name: string): ProvisionResponseSchema | undefined {
  return _registry.get(name.toLowerCase());
}

/**
 * List all registered provider schema names.
 */
export function listRegisteredSchemas(): string[] {
  return [..._registry.keys()].sort();
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export class ProvisionSchemaValidationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly violations: SchemaViolation[],
  ) {
    const summary = violations
      .slice(0, 3)
      .map((v) => `${v.path}: ${v.message}`)
      .join("; ");
    super(`Provision response schema validation failed for "${provider}": ${summary}`);
    this.name = "ProvisionSchemaValidationError";
  }
}

export interface SchemaViolation {
  path: string;
  message: string;
  received?: unknown;
}

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

/**
 * Validate a raw object against a JSON Schema property definition.
 * Returns a (possibly empty) list of violations.
 */
export function validateSchema(
  value: unknown,
  schema: JsonSchemaProperty,
  path = "$",
): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  // Resolve nullable: treat nullable:true as also allowing null type
  const allowedTypes: JsonSchemaType[] = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (schema.nullable && !allowedTypes.includes("null")) allowedTypes.push("null");

  // null check
  if (value === null || value === undefined) {
    if (allowedTypes.includes("null")) return [];
    violations.push({ path, message: "value is null/undefined", received: value });
    return violations;
  }

  // Type check
  if (allowedTypes.length > 0) {
    const actualType = getJsonType(value);
    const matches = allowedTypes.some((t) => typeMatches(actualType, t, value));
    if (!matches) {
      violations.push({
        path,
        message: `expected type ${allowedTypes.join("|")}, got ${actualType}`,
        received: value,
      });
      return violations; // no point checking deeper if type is wrong
    }
  }

  // String constraints
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      violations.push({
        path,
        message: `string too short (min ${schema.minLength}, got ${value.length})`,
        received: value,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      violations.push({
        path,
        message: `string too long (max ${schema.maxLength}, got ${value.length})`,
        received: value,
      });
    }
    if (schema.pattern !== undefined) {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        violations.push({
          path,
          message: `string does not match pattern /${schema.pattern}/`,
          received: value,
        });
      }
    }
  }

  // Number constraints
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      violations.push({
        path,
        message: `number below minimum ${schema.minimum}`,
        received: value,
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      violations.push({
        path,
        message: `number above maximum ${schema.maximum}`,
        received: value,
      });
    }
  }

  // Enum check
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      violations.push({
        path,
        message: `value not in enum [${schema.enum.join(", ")}]`,
        received: value,
      });
    }
  }

  // Object: check required fields and recurse into properties
  if (isObject(value) && schema.properties) {
    const required = schema.required ?? [];
    for (const req of required) {
      if (!(req in value)) {
        violations.push({ path: `${path}.${req}`, message: "required field missing" });
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        violations.push(
          ...validateSchema((value as Record<string, unknown>)[key], propSchema, `${path}.${key}`),
        );
      }
    }
  }

  // Array: recurse into items
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      violations.push(...validateSchema(value[i], schema.items, `${path}[${i}]`));
    }
  }

  return violations;
}

function getJsonType(value: unknown): JsonSchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value as JsonSchemaType;
}

function typeMatches(actual: JsonSchemaType, expected: JsonSchemaType, value: unknown): boolean {
  if (actual === expected) return true;
  // integer is a subtype of number
  if (expected === "number" && actual === "integer") return true;
  if (expected === "integer" && actual === "number" && Number.isInteger(value)) return true;
  return false;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Path resolution (dot-notation)
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-notation path into a nested object.
 * e.g. resolvePath({project: {id: "abc"}}, "project.id") → "abc"
 */
export function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Post-provision validation + Resource extraction
// ---------------------------------------------------------------------------

import type { Resource } from "./providers/_base.ts";

/**
 * Validate a raw provision API response against the registered schema for
 * `providerName`, then extract and return a typed `Resource`.
 *
 * Throws `ProvisionSchemaValidationError` on violations.
 * Returns the extracted `Resource` on success.
 *
 * If no schema is registered for the provider, passes through with a warning
 * logged (backwards-compatible: existing providers without schemas still work).
 */
export function validateProvisionResponse(
  providerName: string,
  raw: unknown,
  opts: { strict?: boolean } = {},
): Resource {
  const schema = getProviderSchema(providerName);
  if (!schema) {
    if (opts.strict) {
      throw new ProvisionSchemaValidationError(providerName, [
        { path: "$", message: "no schema registered for this provider" },
      ]);
    }
    // Pass-through: extract id/displayName directly (best-effort)
    const obj = isObject(raw) ? raw : {};
    return {
      id: String(obj.id ?? obj.name ?? ""),
      displayName: String(obj.displayName ?? obj.name ?? obj.id ?? ""),
      region: typeof obj.region === "string" ? obj.region : undefined,
      meta: typeof obj.meta === "object" && obj.meta !== null
        ? (obj.meta as Record<string, unknown>)
        : undefined,
    };
  }

  // Validate the raw response
  const violations = validateSchema(raw, schema.schema);
  if (violations.length > 0) {
    throw new ProvisionSchemaValidationError(providerName, violations);
  }

  // Extract Resource fields via path mapping
  const m = schema.mapping;
  const id = String(resolvePath(raw, m.id) ?? "");
  const displayName = String(resolvePath(raw, m.displayName) ?? "");

  if (!id) {
    throw new ProvisionSchemaValidationError(providerName, [
      { path: m.id, message: "mapped 'id' field resolved to empty string" },
    ]);
  }

  const resource: Resource = { id, displayName };

  if (m.region) {
    const region = resolvePath(raw, m.region);
    if (typeof region === "string") resource.region = region;
  }

  if (m.meta) {
    const meta: Record<string, unknown> = {};
    for (const [key, path] of Object.entries(m.meta)) {
      const val = resolvePath(raw, path);
      if (val !== undefined) meta[key] = val;
    }
    if (Object.keys(meta).length > 0) resource.meta = meta;
  }

  return resource;
}

// ---------------------------------------------------------------------------
// Schema completeness validation
// ---------------------------------------------------------------------------

export interface SchemaCompletenessResult {
  provider: string;
  hasSchema: boolean;
  hasRequiredFields: boolean;
  hasIdMapping: boolean;
  hasDisplayNameMapping: boolean;
  issues: string[];
}

/**
 * Validate that a schema definition is complete and well-formed.
 */
export function validateSchemaCompleteness(
  name: string,
  schema?: ProvisionResponseSchema,
): SchemaCompletenessResult {
  const s = schema ?? getProviderSchema(name);
  const result: SchemaCompletenessResult = {
    provider: name,
    hasSchema: !!s,
    hasRequiredFields: false,
    hasIdMapping: false,
    hasDisplayNameMapping: false,
    issues: [],
  };

  if (!s) {
    result.issues.push("no schema registered");
    return result;
  }

  result.hasIdMapping = !!s.mapping.id;
  result.hasDisplayNameMapping = !!s.mapping.displayName;

  if (!result.hasIdMapping) result.issues.push("mapping.id is missing");
  if (!result.hasDisplayNameMapping) result.issues.push("mapping.displayName is missing");

  // Check the schema's object properties for id and displayName (via mapping)
  const idField = s.mapping.id.split(".")[0];
  const dnField = s.mapping.displayName.split(".")[0];

  const topLevelProps = s.schema.properties ?? {};
  const topLevelRequired = s.schema.required ?? [];

  const hasIdProp = idField in topLevelProps || s.schema.type !== "object";
  const hasDnProp = dnField in topLevelProps || s.schema.type !== "object";

  result.hasRequiredFields = hasIdProp && hasDnProp;

  if (!hasIdProp) result.issues.push(`schema is missing property for id mapping field "${idField}"`);
  if (!hasDnProp)
    result.issues.push(`schema is missing property for displayName mapping field "${dnField}"`);

  if (topLevelRequired.length === 0 && s.schema.type === "object") {
    result.issues.push('schema has no required fields — consider adding at minimum ["id"]');
  }

  return result;
}

// ---------------------------------------------------------------------------
// TypeScript codegen
// ---------------------------------------------------------------------------

/**
 * Generate a TypeScript interface + validator function from a
 * ProvisionResponseSchema. Output is a self-contained .ts snippet that can be
 * written to disk or diffed.
 */
export function generateTypeScript(name: string, schema: ProvisionResponseSchema): string {
  const typeName = toPascalCase(name) + "ProvisionResponse";
  const lines: string[] = [];

  lines.push(`// AUTO-GENERATED by provision-schema codegen — do not edit by hand`);
  lines.push(`// Source: ${name} provision schema (${schema.title})`);
  lines.push(``);
  lines.push(`import { validateSchema, type SchemaViolation } from "../provision-schema.ts";`);
  lines.push(``);

  // Emit the TypeScript interface
  lines.push(`/** ${schema.description ?? schema.title} */`);
  lines.push(`export interface ${typeName} {`);
  if (schema.schema.properties) {
    for (const [key, prop] of Object.entries(schema.schema.properties)) {
      const required = schema.schema.required?.includes(key) ?? false;
      const tsType = jsonSchemaToTsType(prop);
      const comment = prop.description ? `  /** ${prop.description} */\n` : "";
      lines.push(`${comment}  ${key}${required ? "" : "?"}: ${tsType};`);
    }
  } else {
    lines.push(`  [key: string]: unknown;`);
  }
  lines.push(`}`);
  lines.push(``);

  // Emit the schema constant
  lines.push(`const _schema = ${JSON.stringify(schema.schema, null, 2)} as const;`);
  lines.push(``);

  // Emit the validator function
  lines.push(`/**`);
  lines.push(` * Validate a raw ${name} provision API response.`);
  lines.push(` * Returns violations (empty array = valid).`);
  lines.push(` */`);
  lines.push(
    `export function validate${toPascalCase(name)}ProvisionResponse(raw: unknown): SchemaViolation[] {`,
  );
  lines.push(`  // biome-ignore lint/suspicious/noExplicitAny: schema cast`);
  lines.push(`  return validateSchema(raw, _schema as any);`);
  lines.push(`}`);
  lines.push(``);

  // Emit a type-guard
  lines.push(`/**`);
  lines.push(` * Type-guard: narrow unknown → ${typeName}.`);
  lines.push(` * Throws on invalid response so callers get a clear error at provision-time.`);
  lines.push(` */`);
  lines.push(
    `export function assert${toPascalCase(name)}ProvisionResponse(raw: unknown): ${typeName} {`,
  );
  lines.push(
    `  const violations = validate${toPascalCase(name)}ProvisionResponse(raw);`,
  );
  lines.push(`  if (violations.length > 0) {`);
  lines.push(
    `    const msg = violations.map(v => \`\${v.path}: \${v.message}\`).join("; ");`,
  );
  lines.push(
    `    throw new Error(\`${name} provision response validation failed: \${msg}\`);`,
  );
  lines.push(`  }`);
  lines.push(`  return raw as ${typeName};`);
  lines.push(`}`);
  lines.push(``);

  return lines.join("\n");
}

function toPascalCase(str: string): string {
  return str.replace(/(^\w|-\w)/g, (m) => m.replace("-", "").toUpperCase());
}

function jsonSchemaToTsType(prop: JsonSchemaProperty): string {
  const types = Array.isArray(prop.type) ? prop.type : prop.type ? [prop.type] : ["unknown"];
  const tsTypes = types.map((t) => {
    switch (t) {
      case "string":
        return prop.enum ? prop.enum.map((v) => JSON.stringify(v)).join(" | ") : "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return prop.items ? `Array<${jsonSchemaToTsType(prop.items)}>` : "unknown[]";
      case "object": {
        if (!prop.properties) return "Record<string, unknown>";
        const fields = Object.entries(prop.properties).map(([k, v]) => {
          const req = prop.required?.includes(k) ?? false;
          return `${k}${req ? "" : "?"}: ${jsonSchemaToTsType(v)}`;
        });
        return `{ ${fields.join("; ")} }`;
      }
      default:
        return "unknown";
    }
  });
  const union = tsTypes.join(" | ");
  return prop.nullable && !types.includes("null") ? `${union} | null` : union;
}

// ---------------------------------------------------------------------------
// Built-in schemas: 5 high-value providers
// ---------------------------------------------------------------------------

registerProviderSchema("supabase", {
  title: "Supabase Project",
  description: "Response from POST /v1/projects",
  mapping: {
    id: "id",
    displayName: "name",
    region: "region",
    meta: { organization_id: "organization_id" },
  },
  schema: {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: {
        type: "string",
        description: "Supabase project ref (short alphanumeric id)",
        minLength: 1,
      },
      name: {
        type: "string",
        description: "Human-readable project name",
        minLength: 1,
      },
      region: {
        type: "string",
        description: "AWS region slug (e.g. us-east-1)",
      },
      organization_id: {
        type: "string",
        description: "Owning organization id",
      },
      status: {
        type: "string",
        description: "Project status (ACTIVE_HEALTHY, COMING_UP, etc.)",
      },
    },
    additionalProperties: true,
  },
});

registerProviderSchema("neon", {
  title: "Neon Project",
  description: "Response from POST /v2/projects (body.project)",
  mapping: {
    id: "id",
    displayName: "name",
    region: "region_id",
    meta: { pg_version: "pg_version", created_at: "created_at" },
  },
  schema: {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: {
        type: "string",
        description: "Neon project id",
        minLength: 1,
      },
      name: {
        type: "string",
        description: "Human-readable project name",
        minLength: 1,
      },
      region_id: {
        type: "string",
        description: "Region (e.g. aws-us-east-2)",
      },
      pg_version: {
        type: "integer",
        description: "PostgreSQL major version",
        minimum: 14,
      },
      created_at: {
        type: "string",
        description: "ISO 8601 creation timestamp",
      },
    },
    additionalProperties: true,
  },
});

registerProviderSchema("vercel", {
  title: "Vercel Project",
  description: "Response from POST /v10/projects",
  mapping: {
    id: "id",
    displayName: "name",
    meta: { accountId: "accountId", framework: "framework" },
  },
  schema: {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: {
        type: "string",
        description: "Vercel project id (prj_…)",
        minLength: 1,
      },
      name: {
        type: "string",
        description: "Project slug / display name",
        minLength: 1,
      },
      accountId: {
        type: "string",
        description: "Owning account id",
      },
      framework: {
        type: ["string", "null"],
        description: "Detected framework (nextjs, vite, etc.)",
        nullable: true,
      },
      link: {
        type: ["object", "null"],
        description: "Git repository linkage",
        nullable: true,
        properties: {
          type: { type: "string" },
          repo: { type: "string" },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
});

registerProviderSchema("stripe", {
  title: "Stripe Account",
  description: "Response from GET /v1/account (identity verification)",
  mapping: {
    id: "id",
    displayName: "display_name",
    meta: { email: "email", country: "country", business_type: "business_type" },
  },
  schema: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description: "Stripe account id (acct_… or 'live'/'test' for the default account)",
        minLength: 1,
      },
      display_name: {
        type: ["string", "null"],
        description: "Business display name",
        nullable: true,
      },
      email: {
        type: ["string", "null"],
        description: "Account email",
        nullable: true,
      },
      country: {
        type: ["string", "null"],
        description: "ISO 3166-1 alpha-2 country code",
        nullable: true,
      },
      business_type: {
        type: ["string", "null"],
        description: "individual | company | non_profit | government_entity",
        nullable: true,
      },
      charges_enabled: {
        type: "boolean",
        description: "Whether the account can accept charges",
      },
    },
    additionalProperties: true,
  },
});

registerProviderSchema("github", {
  title: "GitHub User / Org",
  description: "Response from GET /user (identity verification)",
  mapping: {
    id: "login",
    displayName: "name",
    meta: { node_id: "node_id", type: "type", company: "company" },
  },
  schema: {
    type: "object",
    required: ["login", "id"],
    properties: {
      login: {
        type: "string",
        description: "GitHub username/handle",
        minLength: 1,
      },
      id: {
        type: "integer",
        description: "GitHub numeric user id",
        minimum: 1,
      },
      node_id: {
        type: "string",
        description: "GraphQL node id",
      },
      name: {
        type: ["string", "null"],
        description: "Display name",
        nullable: true,
      },
      email: {
        type: ["string", "null"],
        description: "Public email",
        nullable: true,
      },
      company: {
        type: ["string", "null"],
        description: "Company affiliation",
        nullable: true,
      },
      type: {
        type: "string",
        description: "User | Organization | Bot",
        enum: ["User", "Organization", "Bot"],
      },
      html_url: {
        type: "string",
        description: "Profile URL",
      },
    },
    additionalProperties: true,
  },
});

// ---------------------------------------------------------------------------
// SchemaValidator — compiled + cached validators
// ---------------------------------------------------------------------------

/**
 * A compiled validator entry cached by provider name.
 * Stores both the schema reference and a pre-built validation function so
 * compilation is amortised across repeated calls (e.g. during `--validate-only`
 * batch runs or high-frequency pipeline tests).
 */
export interface CompiledValidator {
  providerName: string;
  schemaVersion: string;
  /** Direct reference to the registered ProvisionResponseSchema */
  schema: ProvisionResponseSchema;
  /**
   * Compiled validation function — runs the schema validator and returns
   * violations. Equivalent to `validateSchema(raw, schema.schema)` but cached
   * so the schema property lookup is skipped on each call.
   */
  validate(raw: unknown): SchemaViolation[];
  /**
   * Validate raw AND extract a typed Resource in one step.
   * Throws `ProvisionSchemaValidationError` on violations.
   */
  validateAndExtract(raw: unknown): Resource;
}

/**
 * `SchemaValidator` compiles provider schemas into runtime validators and
 * caches them by provider name. Compilation is O(1) (just a closure over the
 * schema object) but caching avoids repeated registry lookups in tight loops.
 *
 * Usage:
 * ```ts
 * const sv = new SchemaValidator();
 * const validator = sv.compile("neon");      // compiles + caches
 * const resource  = validator.validateAndExtract(rawApiResponse);
 * ```
 */
export class SchemaValidator {
  private readonly _cache = new Map<string, CompiledValidator>();

  /**
   * Compile (or return cached) a validator for `providerName`.
   * Returns `undefined` when no schema is registered for the provider.
   * Callers that need strict enforcement should check for `undefined`.
   */
  compile(providerName: string): CompiledValidator | undefined {
    const key = providerName.toLowerCase();
    if (this._cache.has(key)) return this._cache.get(key)!;

    const schema = getProviderSchema(key);
    if (!schema) return undefined;

    const compiled: CompiledValidator = {
      providerName: key,
      schemaVersion: (schema as ProvisionResponseSchemaWithVersion).schemaVersion ?? "1.0.0",
      schema,
      validate: (raw: unknown) => validateSchema(raw, schema.schema),
      validateAndExtract: (raw: unknown) => validateProvisionResponse(key, raw),
    };
    this._cache.set(key, compiled);
    return compiled;
  }

  /**
   * Invalidate the cached entry for `providerName`.
   * Call after `registerProviderSchema()` to force recompilation.
   */
  invalidate(providerName: string): void {
    this._cache.delete(providerName.toLowerCase());
  }

  /** Clear the entire cache. */
  clear(): void {
    this._cache.clear();
  }

  /** Return the number of currently-cached compiled validators. */
  get size(): number {
    return this._cache.size;
  }

  /**
   * Return all currently-cached provider names (sorted).
   */
  cachedProviders(): string[] {
    return [...this._cache.keys()].sort();
  }
}

/** Module-level singleton validator — shared across pipeline calls. */
export const schemaValidator = new SchemaValidator();

// ---------------------------------------------------------------------------
// Provider schema version typing
// ---------------------------------------------------------------------------

/**
 * Extended ProvisionResponseSchema that carries an optional `schemaVersion`
 * string (semver). Providers that declare `provisionResponseSchema` on their
 * Provider object should also set this to enable cache invalidation and
 * changelog tracking.
 */
export interface ProvisionResponseSchemaWithVersion extends ProvisionResponseSchema {
  /**
   * Semver string for this schema definition, e.g. "1.0.0".
   * Used by SchemaValidator to tag compiled entries and by `stack validate-schema`
   * to surface schema-version drift across providers.
   */
  schemaVersion?: string;
}

// ---------------------------------------------------------------------------
// Validate-only mode  (for `stack validate-schema --validate-only`)
// ---------------------------------------------------------------------------

export interface ValidateOnlyResult {
  providerName: string;
  schemaVersion: string;
  passed: boolean;
  violations: SchemaViolation[];
  /**
   * Time taken to run the validator in microseconds (wall-clock).
   * Useful for benchmarking schema compile + validate overhead.
   */
  durationUs: number;
}

/**
 * Run validators against a map of `{ providerName → mockResponse }` without
 * persisting anything. This is the `--validate-only` mode used by
 * `stack validate-schema`.
 *
 * Each entry is compiled (or fetched from cache) and validated. The results
 * are returned in the same order as the input entries.
 *
 * @param mocks   Map of provider name → raw mock response object
 * @param sv      Optional SchemaValidator instance (defaults to module singleton)
 * @returns       Array of per-provider results
 */
export function runValidateOnly(
  mocks: Record<string, unknown>,
  sv: SchemaValidator = schemaValidator,
): ValidateOnlyResult[] {
  const results: ValidateOnlyResult[] = [];

  for (const [providerName, mockResponse] of Object.entries(mocks)) {
    const t0 = performance.now();
    const validator = sv.compile(providerName);

    if (!validator) {
      const durationUs = Math.round((performance.now() - t0) * 1000);
      results.push({
        providerName,
        schemaVersion: "unknown",
        passed: false,
        violations: [{ path: "$", message: `no schema registered for provider "${providerName}"` }],
        durationUs,
      });
      continue;
    }

    const violations = validator.validate(mockResponse);
    const durationUs = Math.round((performance.now() - t0) * 1000);

    results.push({
      providerName,
      schemaVersion: validator.schemaVersion,
      passed: violations.length === 0,
      violations,
      durationUs,
    });
  }

  return results;
}

/**
 * Format a `runValidateOnly` result array as a human-readable string suitable
 * for CLI output. Mirrors the style of `stack validate-schema --validate-only`.
 *
 * Example output:
 * ```
 * neon          PASS (v1.0.0) — 12 µs
 * stripe        FAIL (v1.0.0) — $.id: required field missing
 * ```
 */
export function formatValidateOnlyResults(results: ValidateOnlyResult[]): string {
  return results
    .map((r) => {
      const status = r.passed ? "PASS" : "FAIL";
      const version = `v${r.schemaVersion}`;
      if (r.passed) {
        return `${r.providerName.padEnd(20)} ${status} (${version}) — ${r.durationUs} µs`;
      }
      const detail = r.violations
        .slice(0, 3)
        .map((v) => `${v.path}: ${v.message}`)
        .join("; ");
      return `${r.providerName.padEnd(20)} ${status} (${version}) — ${detail}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Built-in schemas: remaining 34 providers
// ---------------------------------------------------------------------------

// --- Turso ---
registerProviderSchema("turso", {
  title: "Turso Database",
  description: "Response from POST /v1/organizations/:org/databases",
  mapping: {
    id: "name",
    displayName: "name",
    region: "primary_region",
    meta: { group: "group", type: "type" },
  },
  schema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", description: "Database name", minLength: 1 },
      primary_region: { type: "string", description: "Primary region slug" },
      group: { type: "string", description: "Group the database belongs to" },
      type: { type: "string", description: "Database type (logical, etc.)" },
      hostname: { type: "string", description: "Database hostname" },
    },
    additionalProperties: true,
  },
});

// --- Convex ---
registerProviderSchema("convex", {
  title: "Convex Deployment",
  description: "Synthetic resource returned from Convex CLI-based provision",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { slug: "slug" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Convex deployment id or slug", minLength: 1 },
      displayName: { type: "string", description: "Human-readable deployment name", minLength: 1 },
      slug: { type: "string", description: "URL slug" },
      region: { type: "string", description: "Deployment region" },
    },
    additionalProperties: true,
  },
});

// --- Railway ---
registerProviderSchema("railway", {
  title: "Railway Account",
  description: "Synthetic resource from Railway API key verification (me.id)",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Railway user/team id", minLength: 1 },
      displayName: { type: "string", description: "Display name (email or Railway displayName)", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Fly ---
registerProviderSchema("fly", {
  title: "Fly.io Account",
  description: "Synthetic resource from Fly API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Fly account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Cloudflare ---
registerProviderSchema("cloudflare", {
  title: "Cloudflare Account",
  description: "Response from GET /client/v4/user or accounts",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Cloudflare account/user id", minLength: 1 },
      displayName: { type: "string", description: "Account name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Render ---
registerProviderSchema("render", {
  title: "Render Account",
  description: "Synthetic resource from Render API key verification (/v1/owners)",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { name: "name" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Render owner id", minLength: 1 },
      displayName: { type: "string", description: "Owner display name", minLength: 1 },
      name: { type: "string", description: "Owner name" },
    },
    additionalProperties: true,
  },
});

// --- Firebase ---
registerProviderSchema("firebase", {
  title: "Firebase Project",
  description: "Synthetic resource from Firebase/GCP CLI-based provision",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { projectId: "projectId" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Firebase project id or number", minLength: 1 },
      displayName: { type: "string", description: "Project display name", minLength: 1 },
      projectId: { type: "string", description: "Firebase project id slug" },
    },
    additionalProperties: true,
  },
});

// --- Upstash ---
registerProviderSchema("upstash", {
  title: "Upstash Account",
  description: "Synthetic resource from Upstash API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Upstash account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- OpenAI ---
registerProviderSchema("openai", {
  title: "OpenAI Account",
  description: "Synthetic resource from OpenAI API key verification (/v1/models)",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { models: "models" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name", minLength: 1 },
      models: { type: "string", description: "Number of available models" },
    },
    additionalProperties: true,
  },
});

// --- Anthropic ---
registerProviderSchema("anthropic", {
  title: "Anthropic Account",
  description: "Synthetic resource from Anthropic API key verification (/v1/models)",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { models: "models" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name", minLength: 1 },
      models: { type: "string", description: "Number of available models" },
    },
    additionalProperties: true,
  },
});

// --- xAI ---
registerProviderSchema("xai", {
  title: "xAI Account",
  description: "Synthetic resource from xAI API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { models: "models" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name", minLength: 1 },
      models: { type: "string", description: "Number of available models" },
    },
    additionalProperties: true,
  },
});

// --- DeepSeek ---
registerProviderSchema("deepseek", {
  title: "DeepSeek Account",
  description: "Synthetic resource from DeepSeek API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { models: "models" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name", minLength: 1 },
      models: { type: "string", description: "Number of available models" },
    },
    additionalProperties: true,
  },
});

// --- Replicate ---
registerProviderSchema("replicate", {
  title: "Replicate Account",
  description: "Synthetic resource from Replicate API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { username: "username" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or username", minLength: 1 },
      displayName: { type: "string", description: "Account display name", minLength: 1 },
      username: { type: "string", description: "Replicate username" },
    },
    additionalProperties: true,
  },
});

// --- Braintrust ---
registerProviderSchema("braintrust", {
  title: "Braintrust Account",
  description: "Synthetic resource from Braintrust API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Modal ---
registerProviderSchema("modal", {
  title: "Modal Account",
  description: "Synthetic resource from Modal API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- PostHog ---
registerProviderSchema("posthog", {
  title: "PostHog Account",
  description: "Synthetic resource from PostHog API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Sentry ---
registerProviderSchema("sentry", {
  title: "Sentry Organization",
  description: "Synthetic resource from Sentry API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { org_slug: "org_slug" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Sentry org id or slug", minLength: 1 },
      displayName: { type: "string", description: "Org display name", minLength: 1 },
      org_slug: { type: "string", description: "Sentry org slug" },
    },
    additionalProperties: true,
  },
});

// --- Linear ---
registerProviderSchema("linear", {
  title: "Linear Workspace",
  description: "Synthetic resource from Linear API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Linear team/user id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Workspace display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Resend ---
registerProviderSchema("resend", {
  title: "Resend Account",
  description: "Synthetic resource from Resend API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- SendGrid ---
registerProviderSchema("sendgrid", {
  title: "SendGrid Account",
  description: "Synthetic resource from SendGrid API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Mailgun ---
registerProviderSchema("mailgun", {
  title: "Mailgun Account",
  description: "Synthetic resource from Mailgun API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Postmark ---
registerProviderSchema("postmark", {
  title: "Postmark Account",
  description: "Synthetic resource from Postmark API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- Clerk ---
registerProviderSchema("clerk", {
  title: "Clerk Application",
  description: "Synthetic resource from Clerk API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { application_id: "application_id" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Clerk application id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Application display name", minLength: 1 },
      application_id: { type: "string", description: "Clerk application id" },
    },
    additionalProperties: true,
  },
});

// --- AWS ---
registerProviderSchema("aws", {
  title: "AWS Account",
  description: "Synthetic resource from AWS credentials verification (STS GetCallerIdentity)",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { account_id: "account_id", arn: "arn" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "AWS account id or user id", minLength: 1 },
      displayName: { type: "string", description: "Account display name or ARN", minLength: 1 },
      account_id: { type: "string", description: "AWS account id (12-digit)" },
      arn: { type: "string", description: "Caller ARN" },
    },
    additionalProperties: true,
  },
});

// --- Auth0 ---
registerProviderSchema("auth0", {
  title: "Auth0 Tenant",
  description: "Synthetic resource from Auth0 API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { domain: "domain" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Auth0 tenant id or domain", minLength: 1 },
      displayName: { type: "string", description: "Tenant display name or domain", minLength: 1 },
      domain: { type: "string", description: "Auth0 tenant domain" },
    },
    additionalProperties: true,
  },
});

// --- Datadog ---
registerProviderSchema("datadog", {
  title: "Datadog Account",
  description: "Synthetic resource from Datadog API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { site: "site" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Datadog org id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Org display name", minLength: 1 },
      site: { type: "string", description: "Datadog site (datadoghq.com, etc.)" },
    },
    additionalProperties: true,
  },
});

// --- DigitalOcean ---
registerProviderSchema("digitalocean", {
  title: "DigitalOcean Account",
  description: "Synthetic resource from DigitalOcean API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- GCP ---
registerProviderSchema("gcp", {
  title: "GCP Project",
  description: "Synthetic resource from GCP credentials verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { project_id: "project_id" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "GCP project id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Project display name", minLength: 1 },
      project_id: { type: "string", description: "GCP project id" },
    },
    additionalProperties: true,
  },
});

// --- Grafana ---
registerProviderSchema("grafana", {
  title: "Grafana Cloud Stack",
  description: "Synthetic resource from Grafana Cloud API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { orgSlug: "orgSlug" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Stack/org id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Stack display name", minLength: 1 },
      orgSlug: { type: "string", description: "Grafana Cloud org slug" },
    },
    additionalProperties: true,
  },
});

// --- Hetzner ---
registerProviderSchema("hetzner", {
  title: "Hetzner Cloud Project",
  description: "Synthetic resource from Hetzner Cloud API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { datacenter: "datacenter" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Hetzner project id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Project display name", minLength: 1 },
      datacenter: { type: "string", description: "Primary datacenter" },
    },
    additionalProperties: true,
  },
});

// --- LaunchDarkly ---
registerProviderSchema("launchdarkly", {
  title: "LaunchDarkly Project",
  description: "Synthetic resource from LaunchDarkly API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { project_key: "project_key" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Project id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Project display name", minLength: 1 },
      project_key: { type: "string", description: "LaunchDarkly project key" },
    },
    additionalProperties: true,
  },
});

// --- Mixpanel ---
registerProviderSchema("mixpanel", {
  title: "Mixpanel Project",
  description: "Synthetic resource from Mixpanel API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { project_id: "project_id" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Project id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Project display name", minLength: 1 },
      project_id: { type: "string", description: "Mixpanel project id" },
    },
    additionalProperties: true,
  },
});

// --- Plausible ---
registerProviderSchema("plausible", {
  title: "Plausible Analytics",
  description: "Synthetic resource from Plausible API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { email: "email" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Account id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Account display name or email", minLength: 1 },
      email: { type: "string", description: "Account email" },
    },
    additionalProperties: true,
  },
});

// --- WorkOS ---
registerProviderSchema("workos", {
  title: "WorkOS Application",
  description: "Synthetic resource from WorkOS API key verification",
  mapping: {
    id: "id",
    displayName: "displayName",
    meta: { environment_id: "environment_id" },
  },
  schema: {
    type: "object",
    required: ["id", "displayName"],
    properties: {
      id: { type: "string", description: "Application id or 'default'", minLength: 1 },
      displayName: { type: "string", description: "Application display name", minLength: 1 },
      environment_id: { type: "string", description: "WorkOS environment id" },
    },
    additionalProperties: true,
  },
});
