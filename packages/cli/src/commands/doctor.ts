import { defineCommand } from "citty";
import {
  type ProviderContext,
  addService,
  getProvider,
  isPhantomInstalled,
  listProjects,
  readConfig,
} from "@ashlr/stack-core";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";

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
  },
  async run({ args }) {
    const json = Boolean(args.json);
    if (!json) intro("stack doctor");

    if (!(await isPhantomInstalled())) {
      const msg = "Phantom is not installed. Stack cannot verify secrets without it.";
      if (json) {
        process.stdout.write(`${JSON.stringify({ error: msg })}\n`);
        process.exitCode = 1;
        return;
      }
      outroError(msg);
      return;
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
      const status = await provider.healthcheck(ctx, entry);
      if (status.kind === "ok") {
        report.services.push({ name, status: "ok", latencyMs: status.latencyMs });
        spinner?.stop(
          `  ${colors.green("●")} ${name}${status.latencyMs ? colors.dim(` (${status.latencyMs}ms)`) : ""}`,
        );
      } else if (status.kind === "warn") {
        report.services.push({ name, status: "warn", detail: status.detail });
        spinner?.stop(`  ${colors.yellow("●")} ${name}: ${status.detail}`);
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
