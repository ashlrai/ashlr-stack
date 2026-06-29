import {
  listProviderNames,
  listReadinessProviders,
  validateAllProviders,
  runReadinessChecks,
  generateReadinessJson,
  generateAllReadinessJson,
  type BatchValidationResult,
  type ProviderValidationSummary,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";
import { readConfig } from "@ashlr/stack-core";

/**
 * `stack validate [provider]`
 *
 * Runs provider readiness checks for all configured providers (or a single
 * named provider) WITHOUT provisioning anything.  Catches provider-side
 * precondition failures (billing not enabled, quota exceeded, org missing,
 * API limits) before credentials are used or resources are created.
 *
 * Examples:
 *   stack validate                        # check all providers in .stack.toml
 *   stack validate vercel                 # check a single provider
 *   stack validate --all                  # check every registered provider
 *   stack validate --json                 # machine-readable JSON output
 *   stack validate vercel --codegen       # print readiness rules JSON
 */
export const validateReadinessCommand = defineCommand({
  meta: {
    name: "validate",
    description:
      "Run provider readiness checks without provisioning. Catches billing, quota, and API precondition failures early.",
  },
  args: {
    provider: {
      type: "positional",
      required: false,
      description: 'Provider name to check (e.g. "vercel"). Omit to check all configured providers.',
    },
    all: {
      type: "boolean",
      default: false,
      description: "Check every registered provider (not just configured ones).",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit results as machine-readable JSON.",
    },
    codegen: {
      type: "boolean",
      default: false,
      description: "Print the readiness rules JSON descriptor for the provider.",
    },
  },
  async run({ args }) {
    intro("stack validate");

    const isAll = args.all === true;
    const isJson = args.json === true;
    const isCodegen = args.codegen === true;
    const providerArg = args.provider as string | undefined;

    // ── Single-provider mode ──────────────────────────────────────────────
    if (providerArg) {
      const name = providerArg.toLowerCase();

      if (isCodegen) {
        const json = generateReadinessJson(name);
        if (!json) {
          if (isJson) {
            process.stdout.write(
              `${JSON.stringify({ provider: name, error: "no readiness rules registered" }, null, 2)}\n`,
            );
          } else {
            outro(
              colors.dim(
                `No readiness rules registered for "${name}". The provider is transparent to the pipeline.`,
              ),
            );
          }
          return;
        }
        process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
        return;
      }

      const result = runReadinessChecks(name);

      if (isJson) {
        process.stdout.write(
          `${JSON.stringify(
            {
              provider: name,
              ready: result.passed,
              blockingFailures: result.hardOutcomes.filter((o) => !o.passed),
              advisories: result.softOutcomes.filter((o) => !o.passed),
              checkedAt: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      printSingleProviderResult(name, result.passed, result);

      if (!result.passed) {
        process.exitCode = 1;
      }

      outro(
        result.passed
          ? colors.green(`Provider "${name}" passed all readiness checks.`)
          : colors.red(`Provider "${name}" failed ${result.blockingFailures.length} readiness check(s).`),
      );
      return;
    }

    // ── Determine provider list ───────────────────────────────────────────
    let providersToCheck: string[];

    if (isAll) {
      // Every registered provider with readiness rules + all known providers
      // (those without rules pass trivially).
      providersToCheck = listProviderNames();
    } else {
      // Default: providers configured in the local .stack.toml
      try {
        const cwd = process.cwd();
        const config = await readConfig(cwd);
        providersToCheck = Object.keys(config.services);
        if (providersToCheck.length === 0) {
          if (isJson) {
            process.stdout.write(
              `${JSON.stringify({ allReady: true, providers: [], checkedAt: new Date().toISOString() }, null, 2)}\n`,
            );
          } else {
            outro(
              colors.dim(
                "No services configured in .stack.toml. Run `stack add <provider>` first, or use --all.",
              ),
            );
          }
          return;
        }
      } catch {
        // No .stack.toml found — fall back to providers that have readiness rules
        providersToCheck = listReadinessProviders();
        if (providersToCheck.length === 0) {
          if (isJson) {
            process.stdout.write(
              `${JSON.stringify({ allReady: true, providers: [], checkedAt: new Date().toISOString() }, null, 2)}\n`,
            );
          } else {
            outro(colors.dim("No providers with readiness rules found. Use --all to check all providers."));
          }
          return;
        }
      }
    }

    // ── Batch validation ──────────────────────────────────────────────────
    const batchResult: BatchValidationResult = validateAllProviders(providersToCheck);

    if (isJson) {
      process.stdout.write(`${JSON.stringify(batchResult, null, 2)}\n`);
      if (!batchResult.allReady) process.exitCode = 1;
      return;
    }

    printBatchResults(batchResult);

    if (!batchResult.allReady) {
      process.exitCode = 1;
      outroError(
        `${batchResult.providers.filter((p) => !p.ready).length} provider(s) failed readiness checks. ` +
          `Fix the issues above before running \`stack add\`.`,
      );
    } else {
      outro(
        colors.green(
          `All ${providersToCheck.length} provider(s) passed readiness checks. Ready to provision.`,
        ),
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function printSingleProviderResult(
  name: string,
  ready: boolean,
  result: ReturnType<typeof runReadinessChecks>,
): void {
  console.log();
  const icon = ready ? colors.green("✓") : colors.red("✗");
  console.log(`  ${icon} ${colors.bold(name)}`);
  console.log();

  if (result.hardOutcomes.length > 0) {
    console.log(`  ${colors.bold("Hard requirements:")}`);
    for (const o of result.hardOutcomes) {
      const check = o.passed ? colors.green("✓") : colors.red("✗");
      console.log(`    ${check} [${o.ruleId}] ${o.ruleTitle}`);
      if (!o.passed && o.remediation) {
        console.log(`        ${colors.dim("→")} ${colors.yellow(o.remediation)}`);
      }
    }
    console.log();
  }

  if (result.softOutcomes.length > 0) {
    console.log(`  ${colors.bold("Advisories:")}`);
    for (const o of result.softOutcomes) {
      const check = o.passed ? colors.dim("·") : colors.yellow("⚠");
      console.log(`    ${check} [${o.ruleId}] ${o.ruleTitle}`);
      if (!o.passed && o.remediation) {
        console.log(`        ${colors.dim("→")} ${colors.dim(o.remediation)}`);
      }
    }
    console.log();
  }

  if (result.hardOutcomes.length === 0 && result.softOutcomes.length === 0) {
    console.log(
      `  ${colors.dim("·")} No readiness rules registered for "${name}" — provider is transparent to the pipeline.`,
    );
    console.log();
  }
}

function printBatchResults(batchResult: BatchValidationResult): void {
  const { providers } = batchResult;
  const passCount = providers.filter((p) => p.ready).length;
  const failCount = providers.length - passCount;

  console.log();
  console.log(
    `  ${colors.bold("Readiness summary:")} ` +
      `${colors.green(String(passCount))}/${String(providers.length)} providers ready` +
      (failCount > 0 ? `, ${colors.red(String(failCount))} failing` : ""),
  );
  console.log();

  for (const summary of providers) {
    const icon = summary.ready ? colors.green("✓") : colors.red("✗");
    const label = summary.provider.padEnd(16);
    const advisoryNote =
      summary.advisories.length > 0
        ? colors.yellow(` (${summary.advisories.length} advisory)`)
        : "";
    console.log(`  ${icon} ${label}${advisoryNote}`);

    for (const failure of summary.blockingFailures) {
      console.log(`      ${colors.red("✗")} [${failure.ruleId}] ${failure.ruleTitle}`);
      if (failure.remediation) {
        console.log(`          ${colors.dim("→")} ${colors.yellow(failure.remediation)}`);
      }
    }

    for (const advisory of summary.advisories) {
      console.log(`      ${colors.yellow("⚠")} [${advisory.ruleId}] ${advisory.ruleTitle}`);
      if (advisory.remediation) {
        console.log(`          ${colors.dim("→")} ${colors.dim(advisory.remediation)}`);
      }
    }
  }

  console.log();
  console.log(`  ${colors.dim(`Checked at: ${batchResult.checkedAt}`)}`);
  console.log();
}
