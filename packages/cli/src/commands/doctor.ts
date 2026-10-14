import {
  type ProviderContext,
  type ServiceEntry,
  addService,
  getProvider,
  isPhantomInstalled,
  listProjects,
  listSecrets,
  readConfig,
  scanSource,
  takeRevealRefusals,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { requirePhantom } from "../lib/phantom-preflight.ts";
import { colors, intro, logEvent, outro, outroError, prompts, spinnerBridge } from "../ui.ts";

export interface ServiceCheck {
  name: string;
  status: "ok" | "warn" | "error" | "unchecked";
  detail?: string;
  latencyMs?: number;
}

interface DoctorReport {
  project: string;
  path: string;
  services: ServiceCheck[];
}

/**
 * Phantom Secrets >= 0.7.3 reveals values only into an attached terminal, so a
 * healthcheck that needs a stored token cannot read it from here. Such a
 * service is reported `unchecked` (stored, not verified), never "missing".
 */
export const UNREADABLE_DETAIL =
  "stored in Phantom; live check skipped because Phantom reveals values only in an attached terminal (run `phantom validate --check-all` there)";

export interface ReconcileReport {
  configured: string[];
  detected: string[];
  orphans: string[];
  untracked: string[];
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Verify every service is reachable and credentials are valid.",
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
  },
  async run({ args }) {
    const json = Boolean(args.json);
    const reconcile = Boolean(args.reconcile);

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

  // Names only. Unknown inventory (older Phantom, uninitialized project)
  // leaves every verdict to the provider's own healthcheck.
  const inventory = await listSecrets(cwd)
    .then((names) => new Set(names))
    .catch(() => undefined);

  const failingNames: string[] = [];
  for (const [name, entry] of services) {
    const spinner = json ? undefined : prompts.spinner();
    spinner?.start(`Checking ${name}…`);
    const check = await checkService(name, entry, ctx, inventory);
    report.services.push(check);
    if (check.status === "error") failingNames.push(name);
    if (check.status === "ok") {
      spinner?.stop(
        `  ${colors.green("●")} ${name}${check.latencyMs ? colors.dim(` (${check.latencyMs}ms)`) : ""}`,
      );
    } else if (check.status === "warn") {
      spinner?.stop(`  ${colors.yellow("●")} ${name}: ${check.detail}`);
    } else if (check.status === "unchecked") {
      spinner?.stop(colors.dim(`  ${name}: ${check.detail ?? "no healthcheck implemented"}`));
    } else {
      spinner?.stop(`  ${colors.red("●")} ${name}: ${check.detail}`);
    }
  }

  if (fix && failingNames.length > 0 && !json) {
    console.log();
    prompts.log.info(colors.bold("  Attempting remediation…"));
    // Phantom never replaces a stored secret, and re-running setup writes the
    // service's secrets again, so a service whose secrets are still stored
    // cannot be re-wired until they are removed.
    let vaultNames: Set<string>;
    try {
      vaultNames = new Set(await listSecrets(cwd));
    } catch {
      if (!json)
        console.log(colors.yellow("  Phantom inventory is unavailable; remediation skipped."));
      return report;
    }
    for (const name of failingNames) {
      const entry = config.services[name];
      const stored = entry.secrets.filter((secret) => vaultNames.has(secret));
      if (stored.length > 0) {
        console.log(
          `  ${colors.dim("·")} ${name}: skipped — still stored in Phantom: ${stored.join(", ")}. Run \`phantom remove <NAME>\` for each in a terminal, then \`stack doctor --fix\`.`,
        );
        continue;
      }
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
          ...spinnerBridge(spinner, `  Re-running ${name}…`),
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
 * One service's doctor verdict. `inventory` is the set of names in the
 * Phantom vault, or undefined when it could not be read.
 */
export async function checkService(
  name: string,
  entry: ServiceEntry,
  ctx: ProviderContext,
  inventory: Set<string> | undefined,
): Promise<ServiceCheck> {
  try {
    const provider = await getProvider(name);
    if (!provider.healthcheck) {
      return { name, status: "unchecked", detail: "no healthcheck implemented" };
    }
    takeRevealRefusals();
    const status = await provider.healthcheck(ctx, entry);
    const refused = takeRevealRefusals();
    if (status.kind === "ok") return { name, status: "ok", latencyMs: status.latencyMs };
    if (status.kind === "warn") return { name, status: "warn", detail: status.detail };
    // The provider could not read a token Phantom holds: unverified, not broken.
    if (inventory && refused.length > 0 && refused.every((secret) => inventory.has(secret))) {
      return { name, status: "unchecked", detail: `${refused.join(", ")} ${UNREADABLE_DETAIL}` };
    }
    return { name, status: "error", detail: status.detail };
  } catch (err) {
    return { name, status: "error", detail: (err as Error).message };
  }
}
