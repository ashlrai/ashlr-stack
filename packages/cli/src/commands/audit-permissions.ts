/**
 * `stack audit-permissions [--fix] [--provider <name>] [--json]`
 *
 * Validates that credentials stored in the Phantom vault are scoped to
 * least-privilege and optionally surfaces remediation instructions.
 *
 * Integration: also called from `stack doctor --audit-permissions`.
 */

import {
  auditPermissions,
  type PermissionAuditReport,
  type PermissionValidationResult,
} from "@ashlr/stack-core/permission-validator";
import type { ProviderContext } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

export const auditPermissionsCommand = defineCommand({
  meta: {
    name: "audit-permissions",
    description:
      "Audit IAM/token permissions for all configured providers. " +
      "Detects overprivileged credentials and surfaces least-privilege remediation guidance.",
  },
  args: {
    fix: {
      type: "boolean",
      default: false,
      description:
        "For providers that support auto-downscoping, apply the fix. " +
        "Otherwise print manual remediation instructions.",
    },
    provider: {
      type: "string",
      description: "Audit a single provider by name (e.g. github, aws, stripe).",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON (exit 0/1 on pass/fail). CI-friendly.",
    },
  },
  async run({ args }) {
    const json = Boolean(args.json);
    const fix = Boolean(args.fix);
    const providerFilter = args.provider ?? undefined;

    if (!json) intro("stack audit-permissions");

    // Import helpers lazily to avoid loading vault ops when not needed.
    const { readConfig, getProvider, listProviderNames } = await import("@ashlr/stack-core");
    const { tryRevealSecret } = await import("@ashlr/stack-core/providers/_helpers");

    const cwd = process.cwd();
    const ctx: ProviderContext = {
      cwd,
      interactive: !json && process.stdout.isTTY === true,
      log: json ? () => {} : (event) => {
        if (event.level === "warn") {
          console.log(`  ${colors.yellow("⚠")} ${event.msg}`);
        }
      },
    };

    // Collect providers to audit
    let providerNames: string[];
    if (providerFilter) {
      providerNames = [providerFilter];
    } else {
      // Use configured services from .stack.toml if available, otherwise all known providers
      const config = await readConfig(cwd).catch(() => undefined);
      providerNames = config ? Object.keys(config.services) : listProviderNames();
    }

    // Build auth entries — attempt to reveal vault secrets for each provider
    const entries: Array<{ provider: string; auth: { token: string; identity?: Record<string, string> } }> = [];

    for (const name of providerNames) {
      try {
        const provider = await getProvider(name);
        // Attempt to get token from vault using provider's known secret keys
        // We use a lightweight approach: check common env var patterns
        const token = await resolveTokenForProvider(name, tryRevealSecret);
        if (token) {
          entries.push({ provider: name, auth: { token } });
        } else if (!json) {
          console.log(`  ${colors.dim("·")} ${name}: no credential in vault — skipping`);
        }
      } catch {
        if (!json) {
          console.log(`  ${colors.dim("·")} ${name}: provider not found — skipping`);
        }
      }
    }

    if (entries.length === 0) {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ ranAt: new Date().toISOString(), results: [], alertCount: 0, cleanCount: 0, skippedCount: 0 }, null, 2)}\n`,
        );
        return;
      }
      outro(colors.dim("No credentials found to audit. Run `stack add <provider>` first."));
      return;
    }

    if (!json) {
      console.log(
        `\n  Auditing ${entries.length} provider${entries.length !== 1 ? "s" : ""}…\n`,
      );
    }

    const report = await auditPermissions(entries, ctx, { fix });

    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.alertCount > 0 ? 1 : 0;
      return;
    }

    // Human-readable output
    printAuditReport(report, fix);

    if (report.alertCount > 0) {
      process.exitCode = 1;
      outroError(
        `${report.alertCount} provider${report.alertCount !== 1 ? "s" : ""} with overprivileged or forbidden credentials. ` +
          (fix ? "See remediation instructions above." : "Re-run with --fix for remediation guidance."),
      );
    } else {
      outro(
        colors.green(
          `All ${report.cleanCount} audited provider${report.cleanCount !== 1 ? "s" : ""} are least-privilege.`,
        ),
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the vault token for a provider by checking canonical secret names.
 * This mirrors what each provider's `login()` does via `tryRevealSecret`.
 */
async function resolveTokenForProvider(
  provider: string,
  tryRevealSecret: (name: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const secretMap: Record<string, string[]> = {
    github: ["GITHUB_TOKEN"],
    aws: ["AWS_ACCESS_KEY_ID"],
    stripe: ["STRIPE_SECRET_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    gcp: ["GCP_SERVICE_ACCOUNT_KEY", "GOOGLE_SERVICE_ACCOUNT_KEY"],
    openai: ["OPENAI_API_KEY"],
    neon: ["DATABASE_URL", "NEON_DATABASE_URL"],
    vercel: ["VERCEL_TOKEN"],
    supabase: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"],
    clerk: ["CLERK_SECRET_KEY"],
    resend: ["RESEND_API_KEY"],
    sendgrid: ["SENDGRID_API_KEY"],
    datadog: ["DD_API_KEY"],
    sentry: ["SENTRY_AUTH_TOKEN"],
    linear: ["LINEAR_API_KEY"],
    posthog: ["POSTHOG_API_KEY"],
    mixpanel: ["MIXPANEL_TOKEN"],
    replicate: ["REPLICATE_API_TOKEN"],
    deepseek: ["DEEPSEEK_API_KEY"],
    xai: ["XAI_API_KEY"],
    braintrust: ["BRAINTRUST_API_KEY"],
    cloudflare: ["CLOUDFLARE_API_TOKEN"],
    fly: ["FLY_API_TOKEN"],
    railway: ["RAILWAY_TOKEN"],
    render: ["RENDER_API_KEY"],
    digitalocean: ["DIGITALOCEAN_TOKEN"],
    turso: ["TURSO_AUTH_TOKEN"],
    upstash: ["UPSTASH_REDIS_REST_TOKEN"],
    firebase: ["FIREBASE_SERVICE_ACCOUNT"],
    auth0: ["AUTH0_MANAGEMENT_API_TOKEN"],
    workos: ["WORKOS_API_KEY"],
    launchdarkly: ["LAUNCHDARKLY_SDK_KEY"],
    mailgun: ["MAILGUN_API_KEY"],
    postmark: ["POSTMARK_API_TOKEN"],
    grafana: ["GRAFANA_API_KEY"],
    hetzner: ["HETZNER_API_TOKEN"],
    plausible: ["PLAUSIBLE_API_KEY"],
    convex: ["CONVEX_DEPLOY_KEY"],
    modal: ["MODAL_TOKEN_ID"],
    supabase_anon: ["SUPABASE_ANON_KEY"],
  };

  const keys = secretMap[provider];
  if (!keys) return undefined;

  for (const key of keys) {
    const val = await tryRevealSecret(key);
    if (val) return val;
  }
  return undefined;
}

/**
 * Print a human-readable audit report to stdout.
 */
function printAuditReport(report: PermissionAuditReport, showFix: boolean): void {
  for (const result of report.results) {
    printResultRow(result, showFix);
  }
  console.log();
  console.log(
    `  ${colors.bold("Summary:")} ` +
      `${colors.green(`${report.cleanCount} ok`)}  ` +
      `${colors.yellow(`${report.results.filter((r) => r.status === "warn").length} warn`)}  ` +
      `${colors.red(`${report.alertCount} alert`)}  ` +
      `${colors.dim(`${report.skippedCount} skipped`)}`,
  );
  console.log();
}

function printResultRow(result: PermissionValidationResult, showFix: boolean): void {
  const icon = statusIcon(result.status);
  const label = colors.bold(result.provider.padEnd(16));

  if (result.status === "ok") {
    const scopes = result.grantedScopes.length > 0
      ? colors.dim(`[${result.grantedScopes.join(", ")}]`)
      : "";
    console.log(`  ${icon} ${label} ${colors.green("ok")}  ${scopes}`);
    return;
  }

  if (result.status === "skipped") {
    console.log(`  ${icon} ${label} ${colors.dim("skipped")}  ${colors.dim(result.detail)}`);
    return;
  }

  if (result.status === "warn") {
    console.log(`  ${icon} ${label} ${colors.yellow("warn")}  ${result.detail}`);
    return;
  }

  // overprivileged or error
  const statusLabel =
    result.status === "error" ? colors.red("error") : colors.yellow("overprivileged");
  console.log(`  ${icon} ${label} ${statusLabel}`);
  console.log(`      ${colors.dim(result.detail)}`);

  if (result.violations.length > 0) {
    for (const v of result.violations) {
      const riskColor = v.riskLevel === "forbidden" ? colors.red : colors.yellow;
      console.log(`      ${riskColor("→")} ${v.scope}: ${colors.dim(v.description)}`);
    }
  }

  if (showFix && result.remediationApplied) {
    const fixText = result.remediationApplied.startsWith("manual:")
      ? result.remediationApplied.slice("manual:".length).trim()
      : result.remediationApplied;
    console.log(`      ${colors.cyan("fix:")} ${fixText}`);
  } else if (!showFix && result.status !== "ok" && result.status !== "skipped") {
    console.log(`      ${colors.dim("→ Re-run with --fix for remediation guidance.")}`);
  }
}

function statusIcon(status: PermissionValidationResult["status"]): string {
  switch (status) {
    case "ok": return colors.green("●");
    case "warn": return colors.yellow("●");
    case "overprivileged": return colors.yellow("▲");
    case "error": return colors.red("●");
    case "skipped": return colors.dim("○");
    default: return colors.dim("○");
  }
}

// Re-export helper for use by doctor.ts
export { printAuditReport };
