import {
  type ProviderContext,
  addService,
  defaultProbeRegistry,
  getProvider,
  isPhantomInstalled,
  listProviderNames,
  listProjects,
  providers,
  readConfig,
  scanSource,
  ResourceLifecycle,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { requirePhantom } from "../lib/phantom-preflight.ts";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";
import {
  auditAllSessions,
  formatAuditReport,
  type MultiSessionAuditReport,
} from "@ashlr/stack-core/rollback-audit";

interface DoctorReport {
  project: string;
  path: string;
  services: Array<{
    name: string;
    status: "ok" | "warn" | "error" | "unchecked";
    detail?: string;
    latencyMs?: number;
  }>;
}

export interface ReconcileReport {
  configured: string[];
  detected: string[];
  orphans: string[];
  untracked: string[];
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description:
      "Verify every service is reachable and credentials are valid. Use --coverage to report healthcheck coverage across all registered providers.",
  },
  args: {
    fix: {
      type: "boolean",
      default: false,
      description: "Attempt to auto-remediate by re-running `stack add` for failing services.",
    },
    all: {
      type: "boolean",
      default: false,
      description: "Run doctor across every registered project on this machine.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON (exit 0/1 on pass/fail). CI-friendly.",
    },
    reconcile: {
      type: "boolean",
      default: false,
      description: "Check whether .stack.toml services are still present in source code.",
    },
    coverage: {
      type: "boolean",
      default: false,
      description: "Report healthcheck coverage % across all registered providers and exit.",
    },
    audit: {
      type: "boolean",
      default: false,
      description:
        "Audit rollback state from prior failed provisions — detect orphaned secrets, MCP entries, and config entries that were not cleaned up.",
    },
    "audit-permissions": {
      type: "boolean",
      default: false,
      description:
        "Check that all configured provider credentials are least-privilege. " +
        "Detects overprivileged tokens/keys and surfaces remediation guidance.",
    },
    drift: {
      type: "boolean",
      default: false,
      description:
        "Surface stale, deleted, or degraded resources tracked in .stack.local.toml. " +
        "Use `stack reconcile` to auto-remediate detected drift.",
    },
  },
  async run({ args }) {
    const json = Boolean(args.json);
    const reconcile = Boolean(args.reconcile);

    // --audit: scan replay sessions for orphaned/dangling state.
    if (args.audit) {
      await runAudit(process.cwd(), json);
      return;
    }

    // --audit-permissions: validate credential scopes for all configured providers.
    if (args["audit-permissions"]) {
      const { auditPermissionsCommand } = await import("./audit-permissions.ts");
      // Delegate to the dedicated command, forwarding the --json and --fix flags.
      const fixArg = Boolean((args as Record<string, unknown>).fix);
      // citty's CommandContext carries more internal fields than we can
      // synthesise here; the command only reads `args`, so route through
      // `unknown` to construct the minimal shape it actually consumes.
      await auditPermissionsCommand.run!({
        args: { fix: fixArg, provider: undefined, json },
        cmd: auditPermissionsCommand,
        rawArgs: [],
      } as unknown as Parameters<NonNullable<typeof auditPermissionsCommand.run>>[0]);
      return;
    }

    // --drift: surface stale/deleted/degraded lifecycle records.
    if (args.drift) {
      await runDriftCheck(process.cwd(), json);
      return;
    }

    // --coverage: report healthcheck coverage % across all registered providers.
    if (args.coverage) {
      await runCoverage(json);
      return;
    }

    // --reconcile mode: source-drift check (additive — runs alongside reachability if both given)
    if (reconcile) {
      await runReconcile(process.cwd(), json);
      if (!json) {
        // If only --reconcile was requested (no reachability check), stop here
        if (!args.fix && !args.all) return;
      } else {
        return;
      }
    }

    if (!json) intro("stack doctor");

    if (!(await isPhantomInstalled())) {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ error: "Phantom is not installed. Stack cannot verify secrets without it." })}\n`,
        );
        process.exitCode = 1;
        return;
      }
      await requirePhantom();
    }

    const scope: Array<{ path: string; name: string }> = args.all
      ? (await listProjects()).map((p) => ({ path: p.path, name: p.name }))
      : [{ path: process.cwd(), name: "cwd" }];

    if (scope.length === 0) {
      if (json) {
        process.stdout.write(`${JSON.stringify({ reports: [] })}\n`);
        return;
      }
      outro(colors.dim("No registered projects yet."));
      return;
    }

    const reports: DoctorReport[] = [];
    let anyFailed = false;
    for (const project of scope) {
      if (!json && args.all) {
        console.log(`\n${colors.bold(project.name)} ${colors.dim(project.path)}`);
      }
      const report = await runDoctor(project.path, project.name, Boolean(args.fix), json);
      reports.push(report);
      if (report.services.some((s) => s.status === "error")) anyFailed = true;
    }

    if (json) {
      process.stdout.write(`${JSON.stringify({ reports }, null, 2)}\n`);
      process.exitCode = anyFailed ? 1 : 0;
      return;
    }

    if (anyFailed)
      outroError("One or more services failed. Re-run with --fix to attempt remediation.");
    else outro(colors.green("All services healthy."));
  },
});

export async function runReconcile(cwd: string, json: boolean): Promise<void> {
  const config = await readConfig(cwd).catch(() => undefined);
  const configured = config ? Object.keys(config.services) : [];

  const detections = await scanSource(cwd);
  const detected = detections.map((d) => d.provider);

  const detectedSet = new Set(detected);
  const configuredSet = new Set(configured);

  const orphans = configured.filter((name) => !detectedSet.has(name));
  const untracked = detected.filter((name) => !configuredSet.has(name));

  const report: ReconcileReport = { configured, detected, orphans, untracked };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    // --json: exit 0 always, let tooling handle structured output
    return;
  }

  // Human-readable output
  console.log();
  console.log(
    `  ${colors.bold("●")} ${configured.length} service${configured.length !== 1 ? "s" : ""} configured · ${detected.length} detected in source`,
  );
  console.log();

  if (orphans.length === 0 && untracked.length === 0) {
    console.log(`  ${colors.green("✓")} No drift — configured services match source.`);
    console.log();
    return;
  }

  for (const name of orphans) {
    console.log(
      `  ${colors.yellow("⚠")} 1 orphan: ${colors.bold(name)} ${colors.dim(`(no longer imported — run \`stack remove ${name}\`)`)}`,
    );
  }
  if (orphans.length > 1) {
    console.log(
      `  ${colors.dim(`  → or run \`stack remove --allOrphans\` to remove all ${orphans.length} at once`)}`,
    );
  }

  for (const name of untracked) {
    // Find the signal (file where it was detected)
    const detection = detections.find((d) => d.provider === name);
    const signal = detection?.signals[0] ?? "source";
    console.log(
      `  ${colors.cyan("○")} 1 untracked: ${colors.bold(name)} ${colors.dim(`(found in ${signal} — run \`stack add ${name}\`)`)}`,
    );
  }

  console.log();

  const hasIssues = orphans.length > 0 || untracked.length > 0;
  if (hasIssues) {
    process.exitCode = 2;
  }
}

async function runDoctor(
  cwd: string,
  projectName: string,
  fix: boolean,
  json: boolean,
): Promise<DoctorReport> {
  const report: DoctorReport = { project: projectName, path: cwd, services: [] };
  const config = await readConfig(cwd).catch(() => undefined);
  if (!config) {
    if (!json) console.log(colors.dim("  (no .stack.toml)"));
    return report;
  }
  const services = Object.entries(config.services);
  if (services.length === 0) {
    if (!json) console.log(colors.dim("  (no services configured)"));
    return report;
  }

  const ctx: ProviderContext = {
    cwd,
    interactive: !json && process.stdout.isTTY === true,
    log: json ? () => {} : logEvent,
  };

  const failingNames: string[] = [];
  for (const [name, entry] of services) {
    const spinner = json ? undefined : prompts.spinner();
    spinner?.start(`Checking ${name}…`);
    try {
      const provider = await getProvider(name);
      if (!provider.healthcheck) {
        report.services.push({ name, status: "unchecked" });
        spinner?.stop(colors.dim(`  ${name}: no healthcheck implemented`));
        continue;
      }
      const _t0 = Date.now();
      const status = await provider.healthcheck(ctx, entry);
      const measuredLatencyMs = status.kind === "ok" && status.latencyMs !== undefined
        ? status.latencyMs
        : Date.now() - _t0;
      if (status.kind === "ok") {
        report.services.push({ name, status: "ok", latencyMs: measuredLatencyMs });
        spinner?.stop(
          `  ${colors.green("●")} ${name} ${colors.dim(`${measuredLatencyMs}ms`)}`,
        );
      } else if (status.kind === "warn") {
        report.services.push({ name, status: "warn", detail: status.detail, latencyMs: measuredLatencyMs });
        spinner?.stop(`  ${colors.yellow("●")} ${name}: ${status.detail} ${colors.dim(`(${measuredLatencyMs}ms)`)}`);
      } else {
        failingNames.push(name);
        report.services.push({ name, status: "error", detail: status.detail });
        spinner?.stop(`  ${colors.red("●")} ${name}: ${status.detail}`);
      }
    } catch (err) {
      failingNames.push(name);
      report.services.push({ name, status: "error", detail: (err as Error).message });
      spinner?.stop(`  ${colors.red("●")} ${name}: ${(err as Error).message}`);
    }
  }

  if (fix && failingNames.length > 0 && !json) {
    console.log();
    prompts.log.info(colors.bold("  Attempting remediation…"));
    for (const name of failingNames) {
      const entry = config.services[name];
      // Confirm before re-running, because `addService` may trigger a browser
      // OAuth flow or provision new upstream resources. Doing that silently
      // during a routine `doctor --fix` surprises users.
      const confirmed = process.stdout.isTTY
        ? await prompts.confirm({
            message: `Re-run setup for ${name}? (may open browser / create new resource)`,
            initialValue: true,
          })
        : true;
      if (!confirmed || prompts.isCancel(confirmed)) {
        console.log(`  ${colors.dim("·")} ${name}: skipped`);
        continue;
      }
      const spinner = prompts.spinner();
      spinner.start(`  Re-running ${name}…`);
      try {
        await addService({
          providerName: name,
          cwd,
          existingResourceId: entry.resource_id,
          interactive: process.stdout.isTTY === true,
          log: (event) => {
            spinner.stop();
            logEvent(event);
            spinner.start(`  Re-running ${name}…`);
          },
        });
        spinner.stop(`  ${colors.green("●")} ${name} re-wired.`);
      } catch (err) {
        spinner.stop(`  ${colors.red("●")} ${name}: ${(err as Error).message}`);
      }
    }
  }

  return report;
}

/**
 * Audit rollback state from prior failed provisions.
 * Reads replay logs and cross-checks claimed rollback items against live
 * filesystem state (Phantom vault, .mcp.json, .stack.toml) to surface
 * orphaned secrets/entries that were not cleaned up.
 */
async function runAudit(cwd: string, json: boolean): Promise<void> {
  if (!json) {
    intro("stack doctor --audit");
    console.log(colors.dim("  Scanning replay sessions for dangling state…\n"));
  }

  const multiReport: MultiSessionAuditReport = await auditAllSessions(cwd);

  if (json) {
    process.stdout.write(`${JSON.stringify(multiReport, null, 2)}\n`);
    process.exitCode = multiReport.totalOrphans > 0 || multiReport.totalStale > 0 ? 1 : 0;
    return;
  }

  if (multiReport.sessionCount === 0) {
    outro(colors.dim("No replay sessions found. Run `stack add <provider>` to create one."));
    return;
  }

  console.log(
    `  ${colors.bold("Sessions audited:")} ${multiReport.sessionCount}  |  ` +
    `${colors.yellow(`${multiReport.totalOrphans} orphan(s)`)}  |  ` +
    `${colors.red(`${multiReport.totalStale} stale item(s)`)}`,
  );
  console.log();

  if (multiReport.dirty.length === 0) {
    outro(colors.green("All sessions verified clean — no dangling state detected."));
    return;
  }

  console.log(colors.bold(`  ${multiReport.dirty.length} session(s) with issues:\n`));
  for (const sessionReport of multiReport.dirty) {
    console.log(formatAuditReport(sessionReport));
    console.log();
  }

  process.exitCode = 1;
  outroError(
    `${multiReport.dirty.length} session(s) have dangling state. Follow the recommendations above to clean up.`,
  );
}

/**
 * Report healthcheck coverage % across all registered providers.
 * A provider "has coverage" when its loaded instance exposes a `healthcheck`
 * method (either a hand-written one or via makeApiKeyProvider's built-in).
 *
 * Also reports probe (health-check probe suite) coverage from the
 * ProbeRegistry, showing how many of the 43 catalog providers have
 * a dedicated probe implementation.
 */
async function runCoverage(json: boolean): Promise<void> {
  const names = listProviderNames();
  const results: Array<{ name: string; hasCoverage: boolean }> = [];

  for (const name of names) {
    try {
      const p = await providers[name]!();
      results.push({ name, hasCoverage: typeof p.healthcheck === "function" });
    } catch {
      results.push({ name, hasCoverage: false });
    }
  }

  const total = results.length;
  const covered = results.filter((r) => r.hasCoverage).length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const missing = results.filter((r) => !r.hasCoverage).map((r) => r.name);

  // Probe registry coverage (separate from healthcheck adapters)
  const probeCoverage = defaultProbeRegistry.coverageStats();

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          total,
          covered,
          pct,
          missing,
          probes: {
            total: probeCoverage.total,
            covered: probeCoverage.covered,
            pct: probeCoverage.pct,
            missing: probeCoverage.missing,
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log();
  console.log(
    `  ${colors.bold("Healthcheck coverage:")} ${covered}/${total} providers (${colors.bold(`${pct}%`)})`,
  );
  if (missing.length === 0) {
    console.log(`  ${colors.green("✓")} All providers have healthchecks.`);
  } else {
    console.log(`  ${colors.yellow("⚠")} Missing healthcheck: ${missing.join(", ")}`);
  }

  console.log();
  console.log(
    `  ${colors.bold("Probe coverage:")} ${probeCoverage.covered}/${probeCoverage.total} providers (${colors.bold(`${probeCoverage.pct}%`)})`,
  );
  if (probeCoverage.missing.length === 0) {
    console.log(`  ${colors.green("✓")} All providers have probe stubs.`);
  } else {
    console.log(
      `  ${colors.yellow("⚠")} Missing probes (${probeCoverage.missing.length}): ${probeCoverage.missing.join(", ")}`,
    );
    console.log(
      `  ${colors.dim("→ Run `stack probes generate-missing` to scaffold stubs.")}`,
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// --drift: surface stale lifecycle records
// ---------------------------------------------------------------------------

/**
 * Run a drift check against the resource lifecycle registry stored in
 * `.stack.local.toml`.  Surfaces stale, deleted, and degraded resources.
 * Use `stack reconcile` (or `stack reconcile --apply`) to remediate.
 */
async function runDriftCheck(cwd: string, json: boolean): Promise<void> {
  const registry = await ResourceLifecycle.load(cwd);
  const services = registry.services();

  if (services.length === 0) {
    if (json) {
      process.stdout.write(`${JSON.stringify({ drift: [], total: 0 })}\n`);
      return;
    }
    outro(colors.dim("No lifecycle records found. Resources are tracked after `stack add`."));
    return;
  }

  // Compute drift without live probes (pure local staleness / field checks).
  const drifts = services.map((s) => registry.computeDrift(s));

  if (json) {
    process.stdout.write(`${JSON.stringify({ drift: drifts, total: drifts.length }, null, 2)}\n`);
    const hasDrift = drifts.some((d) => d.kind !== "ok" && d.kind !== "unknown");
    process.exitCode = hasDrift ? 1 : 0;
    return;
  }

  if (!json) intro("stack doctor --drift");

  console.log(
    `\n  ${colors.bold("●")} ${services.length} tracked resource(s)\n`,
  );

  let hasDrift = false;
  for (const drift of drifts) {
    const icon =
      drift.kind === "ok"
        ? colors.green("●")
        : drift.kind === "deleted"
          ? colors.red("✗")
          : drift.kind === "degraded"
            ? colors.yellow("▲")
            : drift.kind === "stale"
              ? colors.cyan("○")
              : colors.dim("?");

    console.log(`  ${icon} ${colors.bold(drift.service)} ${colors.dim(`[${drift.kind}]`)}`);
    if (drift.kind !== "ok") {
      console.log(`    ${colors.dim(drift.detail)}`);
      hasDrift = true;
    }
  }

  console.log();

  if (hasDrift) {
    process.exitCode = 1;
    outroError(
      `Drift detected. Run ${colors.bold("stack reconcile")} to inspect or ${colors.bold("stack reconcile --apply")} to fix.`,
    );
  } else {
    outro(colors.green("All tracked resources are up to date."));
  }
}
