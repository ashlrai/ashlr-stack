import {
  generateTypeScript,
  getProvider,
  getProviderSchema,
  listProviderNames,
  listRegisteredSchemas,
  validateProvisionResponse,
  validateSchema,
  validateSchemaCompleteness,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

/**
 * `stack validate-schema <provider>`
 *
 * Validates the provision-response schema for one or all providers.
 *
 * Examples:
 *   stack validate-schema supabase          # validate schema completeness
 *   stack validate-schema supabase --mock   # also run against a live-shaped mock
 *   stack validate-schema supabase --codegen # print generated TS types
 *   stack validate-schema --all             # completeness check for all 43 providers
 *   stack validate-schema --all --json      # machine-readable summary
 */
export const validateSchemaCommand = defineCommand({
  meta: {
    name: "validate-schema",
    description:
      "Validate provision-response schemas for providers. Use --all to check all 43 providers.",
  },
  args: {
    provider: {
      type: "positional",
      required: false,
      description: 'Provider name to validate (e.g. "supabase"). Omit with --all.',
    },
    all: {
      type: "boolean",
      default: false,
      description: "Check schema completeness for every registered provider.",
    },
    mock: {
      type: "boolean",
      default: false,
      description:
        "Validate a provider's schema against a built-in mock response (where available).",
    },
    codegen: {
      type: "boolean",
      default: false,
      description: "Print the auto-generated TypeScript types + validators for the provider.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit results as JSON.",
    },
  },
  async run({ args }) {
    intro("stack validate-schema");

    const isAll = args.all === true;
    const isJson = args.json === true;
    const isMock = args.mock === true;
    const isCodegen = args.codegen === true;
    const providerArg = args.provider as string | undefined;

    // ── --all mode ────────────────────────────────────────────────────────────
    if (isAll) {
      const allProviders = listProviderNames();
      const registeredSchemas = new Set(listRegisteredSchemas());
      const results: Array<{
        provider: string;
        hasSchema: boolean;
        complete: boolean;
        issues: string[];
      }> = [];

      for (const name of allProviders) {
        const schema = getProviderSchema(name);
        if (!schema) {
          results.push({ provider: name, hasSchema: false, complete: false, issues: ["no schema registered"] });
          continue;
        }
        const check = validateSchemaCompleteness(name, schema);
        results.push({
          provider: name,
          hasSchema: true,
          complete: check.issues.length === 0,
          issues: check.issues,
        });
      }

      if (isJson) {
        const withSchemas = results.filter((r) => r.hasSchema).length;
        const complete = results.filter((r) => r.complete).length;
        process.stdout.write(
          `${JSON.stringify({ total: results.length, withSchemas, complete, providers: results }, null, 2)}\n`,
        );
        return;
      }

      // Human-readable summary
      const withSchemas = results.filter((r) => r.hasSchema).length;
      const complete = results.filter((r) => r.complete).length;
      console.log();
      console.log(
        `  ${colors.bold("Schema coverage:")} ${colors.green(String(withSchemas))}/${String(results.length)} providers have schemas (${colors.green(String(complete))} complete)`,
      );
      console.log();

      for (const r of results) {
        const icon = r.complete
          ? colors.green("✓")
          : r.hasSchema
            ? colors.yellow("⚠")
            : colors.dim("·");
        const label = r.provider.padEnd(14);
        if (r.issues.length > 0) {
          console.log(`  ${icon} ${label} ${colors.dim(r.issues.join("; "))}`);
        } else {
          console.log(`  ${icon} ${label}`);
        }
      }
      console.log();

      const missing = results.filter((r) => !r.hasSchema).length;
      if (missing > 0) {
        console.log(
          colors.dim(
            `  ${missing} provider(s) lack schemas — register them with registerProviderSchema().`,
          ),
        );
      }

      outro(
        complete === results.length
          ? colors.green("All provider schemas are complete.")
          : colors.yellow(
              `${results.length - complete} provider(s) have incomplete or missing schemas.`,
            ),
      );
      return;
    }

    // ── Single-provider mode ──────────────────────────────────────────────────
    if (!providerArg) {
      outroError("Provide a provider name or use --all. Example: stack validate-schema supabase");
      process.exitCode = 1;
      return;
    }

    const name = providerArg.toLowerCase();

    // Verify the provider is known
    const knownProviders = listProviderNames();
    if (!knownProviders.includes(name)) {
      outroError(
        `Unknown provider "${name}". Run \`stack providers\` to see available providers.`,
      );
      process.exitCode = 1;
      return;
    }

    const schema = getProviderSchema(name);
    const completeness = validateSchemaCompleteness(name, schema ?? undefined);

    if (isJson) {
      process.stdout.write(`${JSON.stringify({ provider: name, ...completeness }, null, 2)}\n`);
      return;
    }

    console.log();
    console.log(`  ${colors.bold("Provider:")} ${name}`);
    console.log(`  ${colors.bold("Has schema:")} ${completeness.hasSchema ? colors.green("yes") : colors.red("no")}`);
    console.log(`  ${colors.bold("Id mapping:")} ${completeness.hasIdMapping ? colors.green("yes") : colors.red("no")}`);
    console.log(`  ${colors.bold("DisplayName mapping:")} ${completeness.hasDisplayNameMapping ? colors.green("yes") : colors.red("no")}`);
    console.log();

    if (completeness.issues.length > 0) {
      console.log(`  ${colors.yellow("Issues:")}`);
      for (const issue of completeness.issues) {
        console.log(`    ${colors.yellow("·")} ${issue}`);
      }
      console.log();
    } else {
      console.log(`  ${colors.green("✓")} Schema is complete.`);
      console.log();
    }

    // ── --mock: validate against a fake live-shaped response ─────────────────
    if (isMock && schema) {
      const mockResponse = buildMockResponse(name);
      if (mockResponse) {
        console.log(`  ${colors.bold("Mock validation:")}`);
        try {
          const resource = validateProvisionResponse(name, mockResponse);
          console.log(
            `  ${colors.green("✓")} Mock response valid — extracted resource: id=${resource.id}, displayName="${resource.displayName}"`,
          );
        } catch (err) {
          console.log(`  ${colors.red("✗")} Mock validation failed: ${(err as Error).message}`);
          process.exitCode = 1;
        }
        console.log();
      } else {
        console.log(
          `  ${colors.dim("·")} No mock response defined for ${name} — skipping mock validation.`,
        );
        console.log();
      }
    }

    // ── --codegen: print generated TypeScript ────────────────────────────────
    if (isCodegen && schema) {
      const generated = generateTypeScript(name, schema);
      console.log(colors.dim("  ─── Generated TypeScript ───────────────────────────────────────"));
      console.log();
      console.log(generated);
      console.log(colors.dim("  ────────────────────────────────────────────────────────────────"));
      console.log();
    } else if (isCodegen && !schema) {
      console.log(
        `  ${colors.dim("·")} No schema registered for ${name} — cannot generate TypeScript.`,
      );
    }

    if (completeness.issues.length === 0) {
      outro(colors.green(`Schema for "${name}" is valid.`));
    } else {
      outro(
        colors.yellow(`Schema for "${name}" has ${completeness.issues.length} issue(s).`),
      );
      process.exitCode = 1;
    }
  },
});

// ---------------------------------------------------------------------------
// Built-in mock responses for smoke-testing schemas against live-shaped data
// ---------------------------------------------------------------------------

function buildMockResponse(provider: string): Record<string, unknown> | null {
  switch (provider) {
    case "supabase":
      return {
        id: "abcdefghij",
        name: "stack-mock-project",
        region: "us-east-1",
        organization_id: "org_mock123",
        status: "ACTIVE_HEALTHY",
      };
    case "neon":
      return {
        id: "crimson-moon-12345678",
        name: "stack-mock-neon",
        region_id: "aws-us-east-2",
        pg_version: 16,
        created_at: "2024-01-01T00:00:00Z",
      };
    case "vercel":
      return {
        id: "prj_mock123abc",
        name: "stack-mock-vercel",
        accountId: "team_mock456",
        framework: "nextjs",
        link: null,
      };
    case "stripe":
      return {
        id: "acct_mock123abc",
        display_name: "Mock Business",
        email: "billing@example.com",
        country: "US",
        business_type: "company",
        charges_enabled: true,
      };
    case "github":
      return {
        login: "mock-user",
        id: 12345678,
        node_id: "MDQ6VXNlcjEyMzQ1Njc4",
        name: "Mock User",
        email: "mock@example.com",
        company: "Example Corp",
        type: "User",
        html_url: "https://github.com/mock-user",
      };
    default:
      return null;
  }
}
