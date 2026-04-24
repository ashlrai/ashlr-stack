import {
  addSecret,
  addService,
  findProviderRef,
  findSwap,
  hasConfig,
  readConfig,
  removeSecret,
  revealSecret,
  suggestSwaps,
  writeConfig,
} from "@ashlr/stack-core";
import { removeMcpEntry } from "@ashlr/stack-core/mcp-writer";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";

export const swapCommand = defineCommand({
  meta: {
    name: "swap",
    description: "Migrate a project from one provider to an equivalent in the same category.",
  },
  args: {
    from: {
      type: "positional",
      required: true,
      description: "Provider to remove (e.g. clerk).",
    },
    to: {
      type: "positional",
      required: true,
      description: "Provider to provision (e.g. auth0).",
    },
    dryRun: {
      type: "boolean",
      default: false,
      description: "Print the plan without executing any steps.",
    },
    noRollback: {
      type: "boolean",
      default: false,
      description: "On failure, leave partial state in place instead of rolling back.",
    },
    keepFrom: {
      type: "boolean",
      default: false,
      description: "Provision `to` without removing `from` (side-by-side migration).",
    },
  },
  async run({ args }) {
    const from = String(args.from);
    const to = String(args.to);

    intro(`stack swap ${from} → ${to}${args.dryRun ? colors.dim(" (dry-run)") : ""}`);

    // ── 1. Validate both providers exist in the catalog ───────────────────
    const fromRef = findProviderRef(from);
    const toRef = findProviderRef(to);

    if (!fromRef) {
      outroError(`Unknown provider "${from}". Run \`stack providers\` to see the catalog.`);
      return;
    }
    if (!toRef) {
      outroError(`Unknown provider "${to}". Run \`stack providers\` to see the catalog.`);
      return;
    }

    // ── 2. Same category check ────────────────────────────────────────────
    if (fromRef.category !== toRef.category) {
      outroError(
        `Cannot swap: "${from}" is ${colors.bold(fromRef.category)} but "${to}" is ${colors.bold(toRef.category)}. Both providers must be in the same category.`,
      );
      return;
    }

    // ── 3. Confirm `from` is actually configured ──────────────────────────
    if (!hasConfig()) {
      outroError("No .stack.toml found. Run `stack init` first.");
      return;
    }

    const config = await readConfig();
    const fromEntry = config.services[from];
    if (!fromEntry) {
      outroError(
        `"${from}" is not configured in this stack — nothing to swap from.\nRun \`stack list\` to see active services.`,
      );
      return;
    }

    // ── 4. Look up the swap pair ──────────────────────────────────────────
    const pair = findSwap(from, to);
    if (!pair) {
      const suggestions = suggestSwaps(from);
      if (suggestions.length > 0) {
        console.log(
          colors.yellow(
            `  ⚠ No registered swap pair for ${from} → ${to}. Swap will proceed without env-key aliases.`,
          ),
        );
        console.log(colors.dim(`  Known swaps from "${from}": ${suggestions.join(", ")}`));
      } else {
        console.log(
          colors.yellow(
            `  ⚠ No registered swap pairs for "${from}". Proceeding without env-key aliases.`,
          ),
        );
      }
      console.log();
    }

    const aliases = pair?.aliases ?? {};
    const aliasEntries = Object.entries(aliases);

    // ── 5. Show the plan ──────────────────────────────────────────────────
    console.log();
    console.log(`  ${colors.bold("Plan:")}`);
    console.log(
      `    ${colors.cyan("1.")} Provision  ${colors.bold(to)}  (${toRef.category} · ${toRef.authKind})`,
    );
    if (aliasEntries.length > 0) {
      console.log(`    ${colors.cyan("2.")} Mirror aliases:`);
      for (const [newKey, oldKey] of aliasEntries) {
        console.log(`         ${colors.dim(newKey)} → ${colors.bold(oldKey)}`);
      }
    } else {
      console.log(
        `    ${colors.cyan("2.")} Mirror aliases  ${colors.dim("(none registered for this pair)")}`,
      );
    }
    if (args.keepFrom) {
      console.log(
        `    ${colors.cyan("3.")} Keep ${colors.bold(from)}  ${colors.dim("(--keepFrom set)")}`,
      );
    } else {
      console.log(
        `    ${colors.cyan("3.")} Remove  ${colors.bold(from)}  (${fromEntry.secrets.length} secret(s))`,
      );
    }
    console.log();

    // ── 6. Dry-run: exit here ─────────────────────────────────────────────
    if (args.dryRun) {
      outro(colors.dim("dry-run complete — nothing written."));
      return;
    }

    // ── 7. Confirm (TTY only) ─────────────────────────────────────────────
    if (process.stdout.isTTY) {
      const confirmed = await prompts.confirm({
        message: `Swap ${colors.bold(from)} → ${colors.bold(to)}?`,
        initialValue: true,
      });
      if (!confirmed || prompts.isCancel(confirmed)) {
        outroError("Cancelled.");
        return;
      }
      console.log();
    }

    // ── 8. Provision `to` ─────────────────────────────────────────────────
    const spinner = prompts.spinner();
    let toProvisioned = false;

    try {
      spinner.start(`Provisioning ${to}…`);
      await addService({
        providerName: to,
        interactive: process.stdout.isTTY === true,
        log: (event) => {
          spinner.stop();
          if (event.level === "info") {
            console.log(`  ${colors.dim(event.msg)}`);
          } else if (event.level === "warn") {
            console.log(`  ${colors.yellow(event.msg)}`);
          }
          spinner.start(`Provisioning ${to}…`);
        },
      });
      toProvisioned = true;
      spinner.stop(`${colors.green("●")} ${to} provisioned.`);
    } catch (err) {
      spinner.stop(colors.red("Provisioning failed."));
      outroError(`Failed to provision ${to}: ${(err as Error).message}`);
      return;
    }

    // ── 9. Mirror alias secrets ───────────────────────────────────────────
    if (aliasEntries.length > 0) {
      console.log();
      console.log(colors.dim("  Mirroring env-key aliases…"));
      for (const [newKey, oldKey] of aliasEntries) {
        try {
          const value = await revealSecret(newKey);
          if (value) {
            await addSecret(oldKey, value);
            console.log(`  ${colors.green("✓")} ${newKey} → ${oldKey}`);
          } else {
            console.log(colors.yellow(`  ⚠ ${newKey} has no value — alias ${oldKey} not written.`));
          }
        } catch (err) {
          console.log(
            colors.yellow(`  ⚠ Could not mirror ${newKey} → ${oldKey}: ${(err as Error).message}`),
          );
        }
      }
    }

    // ── 10. Remove `from` (unless --keepFrom) ─────────────────────────────
    if (!args.keepFrom) {
      console.log();
      console.log(colors.dim(`  Removing ${from}…`));
      try {
        const freshConfig = await readConfig();
        const entry = freshConfig.services[from];
        if (entry) {
          for (const secret of entry.secrets) {
            try {
              await removeSecret(secret);
            } catch {
              /* best-effort */
            }
          }
          if (entry.mcp) {
            try {
              await removeMcpEntry(entry.mcp);
            } catch {
              /* best-effort */
            }
          }
          delete freshConfig.services[from];
          await writeConfig(freshConfig);
        }
        console.log(`  ${colors.green("✓")} ${from} removed.`);
      } catch (err) {
        // `to` is already live — do NOT revert it. Warn and let the user clean up.
        console.log();
        console.log(
          colors.yellow(
            `  ⚠ Failed to remove ${from}: ${(err as Error).message}\n` +
              `  ${to} is live. Run \`stack remove ${from}\` manually to finish the swap.`,
          ),
        );
        // Don't exit non-zero — the swap is 90% done.
      }
    }

    // ── 11. Outro ─────────────────────────────────────────────────────────
    console.log();
    outro(
      `${colors.green("✓")} Swapped ${from} → ${to}. ` +
        `Review .env.example changes with ${colors.bold("stack env export --example --force")}`,
    );
  },
});
