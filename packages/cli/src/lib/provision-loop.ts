import { readConfig, writeConfig } from "@ashlr/stack-core";
import { removeMcpEntry } from "@ashlr/stack-core/mcp-writer";
import { runAdd } from "../commands/add.ts";
import { colors, prompts } from "../ui.ts";
import { removeVaultSecrets } from "./phantom-preflight.ts";

/**
 * Minimal description of a provider to provision.
 */
export interface ProvisionTarget {
  name: string;
  hints?: { region?: string };
}

export interface ProvisionLoopResult {
  succeeded: string[];
  failures: Array<{ name: string; message: string }>;
}

/**
 * Shared provisioning loop used by both `stack apply` and `stack init
 * --template`. Iterates over `targets` in order (intentionally serial — some
 * providers depend on cwd state written by earlier steps), calling
 * `stack add <name>` for each one via `runAdd`.
 *
 * On partial failure, offers to roll back the successful adds unless
 * `opts.rollback` is false. In non-TTY mode (CI), rolls back automatically.
 *
 * When `opts.dryRun` is true, only prints what would be provisioned — no
 * `runAdd` calls, no rollback.
 *
 * The helper lives in `packages/cli/src/lib/` (not in `@ashlr/stack-core`)
 * because it imports spinner/prompt helpers from `../ui.ts` and calls
 * `runAdd` directly — both of which are CLI-layer concerns.
 */
export async function provisionProviders(
  targets: ProvisionTarget[],
  opts: { rollback: boolean; dryRun?: boolean },
): Promise<ProvisionLoopResult> {
  if (opts.dryRun) {
    console.log();
    console.log(colors.bold("  Dry run — would provision:"));
    for (const { name } of targets) {
      console.log(`    ${colors.cyan("›")} ${name}`);
    }
    console.log();
    return { succeeded: [], failures: [] };
  }

  const succeeded: string[] = [];
  const failures: Array<{ name: string; message: string }> = [];

  for (const { name } of targets) {
    try {
      console.log(colors.dim(`  › stack add ${name}`));
      // runAdd throws instead of exiting, so one failed provider does not
      // end the loop before the rest run and the rollback below.
      await runAdd({ service: name, dryRun: false });
      succeeded.push(name);
    } catch (err) {
      const message = (err as Error).message;
      console.log(`  ${colors.red("✗")} ${name}: ${message}`);
      failures.push({ name, message });
    }
  }

  // On partial failure, offer to roll back the successful adds so re-running
  // isn't blocked by SERVICE_ALREADY_ADDED errors. Default to rolling back in
  // non-TTY mode (CI-friendly) unless opts.rollback is false.
  if (failures.length > 0 && succeeded.length > 0 && opts.rollback) {
    const shouldRollback = process.stdout.isTTY
      ? await prompts.confirm({
          message: `Partially provisioned (${succeeded.length} succeeded, ${failures.length} failed). Roll back successful adds so you can re-run cleanly?`,
          initialValue: true,
        })
      : true;
    if (shouldRollback && !prompts.isCancel(shouldRollback)) {
      await rollbackProviders(succeeded);
    } else {
      console.log(
        colors.dim(
          "  Keeping partial state. Run `stack doctor --fix` or `stack remove <name>` to clean up.",
        ),
      );
    }
  }

  return { succeeded, failures };
}

/**
 * Undo a partial provision. Reads the config, deletes each named service's
 * secrets + MCP entry, and rewrites the config without them. Best-effort: a
 * failure removing one service does not block the others.
 */
export async function rollbackProviders(names: string[]): Promise<void> {
  if (names.length === 0) return;
  console.log();
  console.log(colors.dim(`  rolling back ${names.length} partial add(s)…`));
  try {
    const config = await readConfig();
    // Rollback only forgets local state; it never deletes upstream resources.
    // Name each one before its entry (the only local record of the id) is
    // dropped, or a re-run silently creates a second resource.
    const upstream: Array<{ name: string; id: string }> = [];
    for (const name of names) {
      const entry = config.services[name];
      if (!entry) continue;
      if (entry.resource_id) upstream.push({ name, id: entry.resource_id });
      // Rollback runs under a spinner: never hand Phantom the terminal here.
      await removeVaultSecrets(entry.secrets, { interactive: false });
      if (entry.mcp) {
        try {
          await removeMcpEntry(entry.mcp);
        } catch {
          /* keep going */
        }
      }
      delete config.services[name];
    }
    await writeConfig(config);
    for (const { name, id } of upstream) {
      console.log(
        `  ${colors.yellow("!")} ${name}: upstream resource ${colors.bold(id)} was not deleted. Delete it on the provider dashboard, or reuse it with ${colors.bold(`stack add ${name} --use ${id}`)}.`,
      );
    }
    console.log(
      colors.dim(
        "  rollback complete — remove any secrets Phantom kept (listed above), then re-run.",
      ),
    );
  } catch (err) {
    console.log(colors.yellow(`  ⚠ rollback failed: ${(err as Error).message}`));
  }
}
