import { defineCommand } from "citty";
import {
  addService,
  assertPhantomInstalled,
  emptyConfig,
  hasConfig,
  listProviderNames,
  readConfig,
  scanSource,
  writeConfig,
} from "@ashlr/stack-core";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";

/**
 * `stack scan` — look at the current repo's source (package.json, config files,
 * etc.) and report which curated providers the code already uses. With
 * `--auto`, Stack will seed a .stack.toml (if missing) and offer to run
 * `stack add` for each detected provider.
 */
export const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description: "Detect providers used by this repo (package.json, config files, .env.example).",
  },
  args: {
    path: { type: "string", default: ".", description: "Directory to scan." },
    auto: {
      type: "boolean",
      default: false,
      description: "After scanning, offer to run `stack add` for each detected provider.",
    },
    confidence: {
      type: "string",
      default: "medium",
      description: "Minimum confidence to surface: low | medium | high.",
    },
  },
  async run({ args }) {
    intro("stack scan");
    const cwd = String(args.path);
    const hits = await scanSource(cwd);
    const minimum = String(args.confidence).toLowerCase() as "low" | "medium" | "high";
    const order: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const filtered = hits.filter((h) => order[h.confidence] >= order[minimum]);

    if (filtered.length === 0) {
      outro(colors.dim("No providers detected. Run `stack scan --confidence low` to see weaker signals."));
      return;
    }

    console.log();
    console.log(
      `  ${colors.bold(String(filtered.length))} provider(s) detected in ${colors.dim(cwd)}:`,
    );
    for (const h of filtered) {
      const dot =
        h.confidence === "high"
          ? colors.green("●")
          : h.confidence === "medium"
            ? colors.yellow("●")
            : colors.dim("●");
      console.log(`  ${dot} ${h.provider.padEnd(12)} ${colors.dim(h.signals.slice(0, 3).join("  "))}`);
    }
    console.log();

    if (!args.auto) {
      const suggestion = filtered.map((h) => `stack add ${h.provider}`).join("\n  ");
      console.log(colors.dim("  Next steps:"));
      console.log(colors.dim(`    ${suggestion}\n`));
      outro(colors.dim("scan complete — nothing written."));
      return;
    }

    // --auto path: seed config if missing, offer each addition interactively.
    try {
      await assertPhantomInstalled();
    } catch (err) {
      outroError((err as Error).message);
      return;
    }

    if (!hasConfig(cwd)) {
      await writeConfig(emptyConfig("from-scan"), cwd);
      prompts.log.info(colors.dim("Seeded a fresh .stack.toml."));
    }

    const config = await readConfig(cwd);
    const registered = new Set(listProviderNames());

    for (const h of filtered) {
      if (!registered.has(h.provider)) continue;
      if (config.services[h.provider]) {
        prompts.log.info(colors.dim(`${h.provider}: already in stack, skipping`));
        continue;
      }
      const shouldAdd = await prompts.confirm({
        message: `Add ${h.provider}? (${h.signals.slice(0, 2).join(", ")})`,
        initialValue: true,
      });
      if (prompts.isCancel(shouldAdd) || !shouldAdd) continue;

      const spinner = prompts.spinner();
      spinner.start(`Adding ${h.provider}…`);
      try {
        const result = await addService({
          providerName: h.provider,
          cwd,
          interactive: process.stdout.isTTY === true,
          log: (event) => {
            spinner.stop();
            logEvent(event);
            spinner.start(`Adding ${h.provider}…`);
          },
        });
        spinner.stop(`${colors.green("●")} ${h.provider} → ${result.displayName}`);
      } catch (err) {
        spinner.stop(colors.red(`✗ ${h.provider}: ${(err as Error).message}`));
      }
    }

    outro(colors.green("scan complete."));
  },
});
