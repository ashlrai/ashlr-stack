import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addSecret,
  assertPhantomInstalled,
  assertProjectInitialized,
  emptyConfig,
  groupByProvider,
  hasConfig,
  listProviderNames,
  listSecrets,
  parseEnv,
  readConfig,
  toServiceEntry,
  writeConfig,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";

/** Validate the whole file before importing, without including values in errors. */
function parseImportEnv(raw: string): ReturnType<typeof parseEnv> {
  const seen = new Set<string>();
  for (const [index, rawLine] of raw.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    const key = eq < 0 ? "" : line.slice(0, eq).trim();
    const value = eq < 0 ? "" : line.slice(eq + 1).trim();
    let reason: string | undefined;
    if (eq < 0 || !/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      reason = "expected a valid KEY=VALUE assignment";
    } else if (
      (value.startsWith('"') || value.startsWith("'")) &&
      (value.length < 2 || !value.endsWith(value[0]))
    ) {
      reason = "unterminated quoted value";
    } else if (seen.has(key)) {
      reason = `duplicate key ${key}`;
    }
    if (reason) throw new Error(`Invalid .env input on line ${index + 1}: ${reason}.`);
    seen.add(key);
  }
  return parseEnv(raw);
}

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
    json: {
      type: "boolean",
      default: false,
      description:
        "Emit machine-readable JSON (schema ashlr.stack.import/v1, names only): what was stored, skipped and wired.",
    },
  },
  async run({ args }) {
    if (args.json) {
      await runImportJson(String(args.from), Boolean(args.dryRun));
      return;
    }
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

    let entries: ReturnType<typeof parseEnv>;
    try {
      entries = parseImportEnv(await readFile(envPath, "utf-8"));
    } catch (err) {
      outroError((err as Error).message);
      return;
    }
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
    //    Phantom never replaces a stored name, so names already in the vault
    //    are skipped and reported instead of aborting the import half-way.
    await assertProjectInitialized(process.cwd());
    const existing = new Set(await listSecrets());
    const skipped: string[] = [];
    let stored = 0;
    for (const { key, value } of entries) {
      if (value.length === 0) continue;
      if (existing.has(key)) {
        skipped.push(key);
        continue;
      }
      await addSecret(key, value);
      stored += 1;
    }
    if (skipped.length > 0) {
      console.log(
        colors.yellow(
          `  ⚠ Already in Phantom, left unchanged: ${skipped.join(", ")}. Run \`phantom remove <NAME>\` first to replace one.`,
        ),
      );
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

/**
 * `stack import --json`: one JSON object on stdout, secret names only, never a
 * value. `stored` is what reached Phantom; `skipped_existing` were already in
 * the vault (Phantom never replaces a name) and `skipped_empty` had no value.
 * An error prints `{"error": ...}` and exits 1, with `stored` naming anything
 * written before it, so a caller can tell a clean failure from a partial one.
 */
async function runImportJson(from: string, dryRun: boolean): Promise<void> {
  const stored: string[] = [];
  const fail = (error: string) => {
    process.stdout.write(`${JSON.stringify(stored.length > 0 ? { error, stored } : { error })}\n`);
    process.exitCode = 1;
  };
  try {
    const envPath = join(process.cwd(), from);
    if (!existsSync(envPath)) {
      fail(`${envPath} not found.`);
      return;
    }
    let phantomInstalled = true;
    try {
      await assertPhantomInstalled();
    } catch (err) {
      if (!dryRun) {
        fail((err as Error).message);
        return;
      }
      phantomInstalled = false;
    }

    const entries = parseImportEnv(await readFile(envPath, "utf-8"));
    const grouped = groupByProvider(entries.map((e) => e.key));
    const registered = new Set(listProviderNames());
    const detected = Object.keys(grouped).filter((p) => registered.has(p));
    const unattributed = entries
      .map((e) => e.key)
      .filter((name) => !detected.some((p) => grouped[p].includes(name)));
    const providers = Object.fromEntries(detected.map((p) => [p, grouped[p]]));

    const skippedExisting: string[] = [];
    const skippedEmpty = entries.filter((e) => e.value.length === 0).map((e) => e.key);
    const servicesAdded: string[] = [];
    const servicesKept: string[] = [];

    if (!dryRun && entries.length > 0) {
      await assertProjectInitialized(process.cwd());
      const existing = new Set(await listSecrets());
      for (const { key, value } of entries) {
        if (value.length === 0) continue;
        if (existing.has(key)) {
          skippedExisting.push(key);
          continue;
        }
        await addSecret(key, value);
        stored.push(key);
      }
      const config = hasConfig() ? await readConfig() : emptyConfig();
      for (const provider of detected) {
        if (config.services[provider]) {
          servicesKept.push(provider);
          continue;
        }
        config.services[provider] = toServiceEntry(provider, grouped[provider]);
        servicesAdded.push(provider);
      }
      await writeConfig(config);
    }

    const report = {
      schema: "ashlr.stack.import/v1",
      from,
      dry_run: dryRun,
      phantom_installed: phantomInstalled,
      providers,
      unattributed,
      stored,
      skipped_existing: skippedExisting,
      skipped_empty: skippedEmpty,
      services_added: servicesAdded,
      services_kept: servicesKept,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (err) {
    fail((err as Error).message);
  }
}
