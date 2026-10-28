import { defineCommand } from "citty";
import pkg from "../../package.json" with { type: "json" };
import { installUpgrade, isReleaseVersion } from "../lib/upgrade-install.ts";
import { colors, intro, outro, outroError } from "../ui.ts";

const PKG = "@ashlr/stack";
const CURRENT_VERSION = pkg.version;

export const upgradeCommand = defineCommand({
  meta: {
    name: "upgrade",
    description: "Check for a release or safely upgrade an npm global CLI install.",
  },
  args: {
    apply: {
      type: "boolean",
      default: false,
      description:
        "Upgrade the npm global CLI, restoring the previous install on failed health checks.",
    },
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Print what would be installed without changing the installation.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit a machine-readable upgrade report without a banner.",
    },
  },
  async run({ args }) {
    await runUpgrade({ apply: args.apply, dryRun: args.dryRun, json: args.json });
  },
});

export interface UpgradeReport {
  schema: "ashlr.stack.upgrade/v1";
  package: string;
  current: string;
  latest: string;
  status: "up_to_date" | "update_available" | "ahead";
  /** Manual installation hint, present only when an update exists. */
  install: string | null;
}

export function buildUpgradeReport(current: string, latest: string): UpgradeReport {
  const status =
    latest === current ? "up_to_date" : isNewer(latest, current) ? "update_available" : "ahead";
  return {
    schema: "ashlr.stack.upgrade/v1",
    package: PKG,
    current,
    latest,
    status,
    install: status === "update_available" ? `bun add -g ${PKG}@${latest}` : null,
  };
}

export async function runUpgrade(
  options: { apply?: boolean; dryRun?: boolean; json?: boolean },
  current = CURRENT_VERSION,
  install = installUpgrade,
): Promise<void> {
  if (!options.json) intro("stack upgrade");
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PKG)}/latest`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`npm registry returned ${res.status}.`);
    const latest = ((await res.json()) as { version?: unknown }).version;
    if (!isReleaseVersion(latest)) {
      throw new Error("npm registry response missing a valid stable version field.");
    }
    const report = buildUpgradeReport(current, latest);
    const applied = options.apply && !options.dryRun && report.status === "update_available";
    if (applied) await install(current, latest);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(applied ? { ...report, status: "upgraded", install: null } : report, null, 2)}\n`,
      );
    } else if (applied) {
      outro(colors.green(`Upgraded to ${latest}; version and help health checks passed.`));
    } else if (report.status === "update_available") {
      console.log(`  ${current} → ${latest}`);
      console.log("  stack upgrade --apply   # npm global installs, with rollback");
      console.log(`  ${report.install}   # manual install`);
      outro(
        colors.yellow(
          options.dryRun ? "Dry run - nothing installed." : "A newer version is available.",
        ),
      );
    } else {
      outro(
        report.status === "up_to_date"
          ? `Up to date (${latest}).`
          : `Local version (${current}) is ahead of npm (${latest}).`,
      );
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Upgrade failed.";
    if (options.json) process.stdout.write(`${JSON.stringify({ error, current })}\n`);
    else outroError(error);
    process.exitCode = 1;
  }
}

/** Read-only compatibility entry point. */
export async function runUpgradeJson(current: string = CURRENT_VERSION): Promise<void> {
  await runUpgrade({ json: true }, current);
}

export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
