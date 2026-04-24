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
import { defineCommand } from "citty";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";

/**
 * `stack scan` — look at the current repo's source (package.json, config files,
 * etc.) and report which curated providers the code already uses. With
 * `--auto`, Stack will seed a .stack.toml (if missing) and offer to run
 * `stack add` for each detected provider.
 *
 * CI / non-interactive flags:
 *   --yes          Accept all hits at/above --confidence threshold without prompting.
 *                  Implies --auto. Safe to combine with explicit --auto.
 *   --confidence   Minimum tier to act on: high | medium | low.
 *                  Default: "high" when --yes is set, "medium" otherwise.
 *   --json         Emit detection results as JSON and exit 0. No prompts, no add.
 *
 * Non-TTY + no flags: prints a one-line CI usage hint and exits 0.
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
    yes: {
      type: "boolean",
      default: false,
      description:
        "Non-interactive: accept all hits at/above --confidence threshold. Implies --auto.",
    },
    confidence: {
      type: "string",
      default: "",
      description: "Minimum confidence to surface/act on: low | medium | high.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Output detection results as JSON and exit 0. No prompts, no add.",
    },
  },
  async run({ args }) {
    const isTTY = process.stdout.isTTY === true;
    const isYes = args.yes === true;
    const isJson = args.json === true;
    // --yes implies --auto
    const isAuto = args.auto === true || isYes;

    // Resolve confidence threshold:
    //   explicit flag > default-for-mode (high when --yes, medium otherwise)
    const rawConfidence = String(args.confidence).toLowerCase();
    const validTiers = ["low", "medium", "high"];
    const minimum: "low" | "medium" | "high" = validTiers.includes(rawConfidence)
      ? (rawConfidence as "low" | "medium" | "high")
      : isYes
        ? "high"
        : "medium";

    const cwd = String(args.path);
    const hits = await scanSource(cwd);
    const order: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const filtered = hits.filter((h) => order[h.confidence] >= order[minimum]);

    // ── --json mode ────────────────────────────────────────────────────────────
    if (isJson) {
      const output = {
        hits: filtered.map((h) => ({
          provider: h.provider,
          confidence: h.confidence,
          sources: h.signals,
        })),
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return;
    }

    // ── Non-TTY without CI flags: hint and exit ─────────────────────────────
    if (!isTTY && !isYes) {
      console.log(
        "stack scan: no TTY detected. Run with --json for machine-readable output, or --yes to accept high-confidence hits headlessly.",
      );
      return;
    }

    // ── Human-readable header (interactive or --yes headless) ─────────────
    intro("stack scan");

    if (filtered.length === 0) {
      outro(
        colors.dim(
          "No providers detected. Run `stack scan --confidence low` to see weaker signals.",
        ),
      );
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
      console.log(
        `  ${dot} ${h.provider.padEnd(12)} ${colors.dim(h.signals.slice(0, 3).join("  "))}`,
      );
    }
    console.log();

    if (!isAuto) {
      const suggestion = filtered.map((h) => `stack add ${h.provider}`).join("\n  ");
      console.log(colors.dim("  Next steps:"));
      console.log(colors.dim(`    ${suggestion}\n`));
      outro(colors.dim("scan complete — nothing written."));
      return;
    }

    // ── --auto / --yes path ────────────────────────────────────────────────
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

      if (isYes) {
        // Headless: add without prompting. Log skips for below-threshold hits
        // (they're already filtered out above, so every hit here is above threshold).
        const spinner = prompts.spinner();
        spinner.start(`Adding ${h.provider}…`);
        try {
          const result = await addService({
            providerName: h.provider,
            cwd,
            interactive: false,
            log: (event) => {
              spinner.stop();
              logEvent(event);
              spinner.start(`Adding ${h.provider}…`);
            },
          });
          spinner.stop(`${colors.green("●")} ${h.provider} → ${result.displayName}`);
        } catch (err) {
          spinner.stop(colors.red(`✗ ${h.provider}: ${(err as Error).message}`));
          process.exitCode = 1;
        }
        continue;
      }

      // Interactive prompt (TTY + --auto, no --yes)
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
          interactive: true,
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
