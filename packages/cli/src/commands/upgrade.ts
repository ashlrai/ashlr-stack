import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

import pkg from "../../package.json" with { type: "json" };

const PKG = "@ashlr/stack";
const CURRENT_VERSION = pkg.version;

/**
 * `stack upgrade` — lightweight self-update helper. Checks npm for the latest
 * @ashlr/stack version, prints a hint when a newer one exists. Does not
 * auto-install (too many opinions about bun vs npm vs brew).
 */
export const upgradeCommand = defineCommand({
  meta: {
    name: "upgrade",
    description: "Check npm for a newer @ashlr/stack release.",
  },
  args: {
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Print what would be installed without running the install command.",
    },
    json: {
      type: "boolean",
      default: false,
      description:
        "Emit machine-readable JSON (schema ashlr.stack.upgrade/v1): current, latest, status and the install command.",
    },
  },
  async run({ args }) {
    if (args.json) {
      await runUpgradeJson();
      return;
    }
    intro("stack upgrade");
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PKG)}/latest`);
      if (!res.ok) {
        outroError(`npm registry returned ${res.status}.`);
        return;
      }
      const body = (await res.json()) as { version?: string };
      const latest = body.version;
      if (!latest) {
        outroError("npm registry response missing version field.");
        return;
      }
      if (latest === CURRENT_VERSION) {
        outro(colors.green(`Up to date (${latest}).`));
        return;
      }
      if (isNewer(latest, CURRENT_VERSION)) {
        console.log();
        console.log(
          `  ${colors.bold(CURRENT_VERSION)} ${colors.dim("→")} ${colors.bold(colors.green(latest))}`,
        );
        console.log();
        if (args.dryRun) {
          console.log(colors.dim("  (dry-run) would run:"));
          console.log(
            colors.dim(`    bun add -g ${PKG}@${latest}   # or: npm i -g ${PKG}@${latest}`),
          );
          console.log();
          outro(colors.yellow("Dry run — nothing installed."));
        } else {
          console.log(colors.dim("  Install:"));
          console.log(colors.dim(`    bun add -g ${PKG}   # or: npm i -g ${PKG}`));
          console.log();
          outro(colors.yellow("A newer version is available."));
        }
      } else {
        outro(colors.dim(`Local version (${CURRENT_VERSION}) is ahead of npm (${latest}).`));
      }
    } catch (err) {
      outroError(`Couldn't reach npm: ${(err as Error).message}`);
    }
  },
});

export interface UpgradeReport {
  schema: "ashlr.stack.upgrade/v1";
  package: string;
  current: string;
  latest: string;
  status: "up_to_date" | "update_available" | "ahead";
  /** The command a person runs to upgrade; null unless an update exists. Never run by Stack. */
  install: string | null;
}

/** The `--json` report for a known registry version. Pure, for tests. */
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

/**
 * `stack upgrade --json`: one JSON object on stdout, no banner. It only reads
 * the registry and installs nothing. An unreachable or malformed registry
 * prints `{"error": ...}` and exits 1.
 */
export async function runUpgradeJson(current: string = CURRENT_VERSION): Promise<void> {
  const fail = (error: string) => {
    process.stdout.write(`${JSON.stringify({ error, current })}\n`);
    process.exitCode = 1;
  };
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PKG)}/latest`);
    if (!res.ok) {
      fail(`npm registry returned ${res.status}.`);
      return;
    }
    const latest = ((await res.json()) as { version?: unknown }).version;
    if (typeof latest !== "string" || !latest) {
      fail("npm registry response missing version field.");
      return;
    }
    process.stdout.write(`${JSON.stringify(buildUpgradeReport(current, latest), null, 2)}\n`);
  } catch (err) {
    fail(`Couldn't reach npm: ${(err as Error).message}`);
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10));
  const pb = b.split(".").map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
