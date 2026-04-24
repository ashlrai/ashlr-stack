import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addSecret,
  assertPhantomInstalled,
  emptyConfig,
  groupByProvider,
  hasConfig,
  listProviderNames,
  parseEnv,
  readConfig,
  toServiceEntry,
  writeConfig,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";

/**
 * `stack import [--from .env]` — inhale an existing .env, route each secret
 * into Phantom, and populate .stack.toml with a best-guess service map.
 *
 * This is the most important migration command: most users arrive at Stack
 * with projects that already have filled-in .env files. They shouldn't have
 * to re-paste 20 keys to try the product.
 */
export const importCommand = defineCommand({
  meta: {
    name: "import",
    description: "Import an existing .env into Phantom + .stack.toml.",
  },
  args: {
    from: { type: "string", default: ".env", description: "Path to the .env file to import." },
    dryRun: {
      type: "boolean",
      default: false,
      description: "Print what would happen without writing anything.",
    },
  },
  async run({ args }) {
    intro("stack import");

    const envPath = join(process.cwd(), String(args.from));
    if (!existsSync(envPath)) {
      outroError(`${envPath} not found.`);
      return;
    }

    try {
      await assertPhantomInstalled();
    } catch (err) {
      if (!args.dryRun) {
        outroError((err as Error).message);
        return;
      }
      prompts.log.warn(colors.yellow("Phantom not installed — dry-run mode will still preview."));
    }

    const raw = await readFile(envPath, "utf-8");
    const entries = parseEnv(raw);
    if (entries.length === 0) {
      outro(colors.dim(`${args.from}: nothing to import.`));
      return;
    }

    const grouped = groupByProvider(entries.map((e) => e.key));
    const registered = new Set(listProviderNames());
    const detectedProviders = Object.keys(grouped).filter((p) => registered.has(p));
    const detectedSecretCount = detectedProviders.reduce((acc, p) => acc + grouped[p].length, 0);
    const orphanSecrets = entries
      .map((e) => e.key)
      .filter((name) => !detectedProviders.some((p) => grouped[p].includes(name)));

    console.log();
    console.log(
      `  ${colors.bold(String(entries.length))} env vars · ${colors.bold(String(detectedProviders.length))} providers detected · ${colors.bold(String(orphanSecrets.length))} unattributed`,
    );
    for (const provider of detectedProviders) {
      console.log(
        `  ${colors.green("●")} ${provider.padEnd(14)} ${colors.dim(grouped[provider].join(", "))}`,
      );
    }
    if (orphanSecrets.length > 0) {
      console.log(
        `  ${colors.dim("·")} ${"(orphans)".padEnd(14)} ${colors.dim(orphanSecrets.join(", "))}`,
      );
    }
    console.log();

    if (args.dryRun) {
      outro(colors.dim("dry-run: nothing written."));
      return;
    }

    // 1. Store every secret in Phantom (provider-matched + orphans alike).
    let stored = 0;
    for (const { key, value } of entries) {
      if (value.length === 0) continue;
      await addSecret(key, value);
      stored += 1;
    }

    // 2. Update .stack.toml — create one if missing, then populate service entries.
    const config = hasConfig() ? await readConfig() : emptyConfig();
    for (const provider of detectedProviders) {
      if (config.services[provider]) continue; // don't clobber pre-existing entries
      config.services[provider] = toServiceEntry(provider, grouped[provider]);
    }
    await writeConfig(config);

    outro(
      colors.green(
        `Imported ${stored} secret(s); wired ${detectedProviders.length} service(s) in .stack.toml. Run \`stack doctor\` to verify.`,
      ),
    );
  },
});
