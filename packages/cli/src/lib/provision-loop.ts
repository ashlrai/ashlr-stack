import { readConfig, removeSecret, writeConfig } from "@ashlr/stack-core";
import { removeMcpEntry } from "@ashlr/stack-core/mcp-writer";
import { addCommand } from "../commands/add.ts";
import { colors, prompts } from "../ui.ts";

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
 * `stack add <name>` for each one via `addCommand`.
 *
 * On partial failure, offers to roll back the successful adds unless
 * `opts.rollback` is false. In non-TTY mode (CI), rolls back automatically.
 *
 * When `opts.dryRun` is true, only prints what would be provisioned — no
 * `addCommand` calls, no rollback.
 *
 * The helper lives in `packages/cli/src/lib/` (not in `@ashlr/stack-core`)
 * because it imports spinner/prompt helpers from `../ui.ts` and calls
 * `addCommand` directly — both of which are CLI-layer concerns.
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
      await addCommand.run?.({
        args: { service: name, dryRun: false, _: [] },
        cmd: addCommand,
        rawArgs: [name],
        data: undefined,
      } as unknown as Parameters<NonNullable<typeof addCommand.run>>[0]);
      succeeded.push(name);
    } catch (err) {
      failures.push({ name, message: (err as Error).message });
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
    for (const name of names) {
      const entry = config.services[name];
      if (!entry) continue;
      for (const secret of entry.secrets) {
        try {
          await removeSecret(secret);
        } catch {
          /* secret may already be gone; keep going */
        }
      }
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
    console.log(colors.dim("  rollback complete — re-run to retry."));
  } catch (err) {
    console.log(colors.yellow(`  ⚠ rollback failed: ${(err as Error).message}`));
  }
}
