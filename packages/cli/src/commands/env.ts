import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findProviderRef, isPhantomInstalled, listSecrets, readConfig } from "@ashlr/stack-core";
import { defineCommand, runCommand } from "citty";
import { requirePhantom } from "../lib/phantom-preflight.ts";
import { colors, intro, outro, outroError } from "../ui.ts";

/**
 * `stack env show [--env prod]` — pretty-print the effective env-var surface
 * for this stack. For each secret the project declares, show whether it's
 * present in the Phantom vault (masked) or missing. Designed for debugging
 * "why does my app boot without Supabase?" kinds of questions.
 */
const envShowCommand = defineCommand({
  meta: { name: "show", description: "Show which secrets are present in Phantom." },
  args: {
    env: { type: "string", default: "dev", description: "Environment overlay to preview." },
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON (schema ashlr.stack.env/v1, secret names only).",
    },
  },
  async run({ args }) {
    if (args.json) {
      await runEnvShowJson(String(args.env));
      return;
    }
    intro(`stack env show (${args.env})`);
    await requirePhantom();
    const config = await readConfig();
    const vaultKeys = new Set(await listSecrets());
    console.log();
    for (const [name, entry] of Object.entries(config.services)) {
      console.log(`  ${colors.bold(name)}`);
      for (const slot of entry.secrets) {
        const present = vaultKeys.has(slot);
        const dot = present ? colors.green("●") : colors.red("○");
        const value = present ? colors.dim("(phm_…)") : colors.red("missing");
        console.log(`    ${dot} ${slot.padEnd(30)} ${value}`);
      }
    }
    const declared = new Set(Object.values(config.services).flatMap((e) => e.secrets));
    const orphans = [...vaultKeys].filter((k) => !declared.has(k)).sort();
    if (orphans.length > 0) {
      console.log();
      console.log(colors.dim("  orphans in vault (not referenced by any service):"));
      for (const k of orphans) console.log(`    ${colors.yellow("●")} ${k}`);
    }
    console.log();
    outro(
      colors.dim(
        `${declared.size} declared · ${vaultKeys.size} in vault · ${orphans.length} orphan(s)`,
      ),
    );
  },
});

/**
 * `stack env show --json`: which declared secret names are in the vault, as
 * one JSON object (names only, never values). A missing project, missing
 * Phantom or unreadable vault prints `{"error": ...}` and exits 1.
 */
async function runEnvShowJson(env: string): Promise<void> {
  const fail = (error: string) => {
    process.stdout.write(`${JSON.stringify({ error })}\n`);
    process.exitCode = 1;
  };
  try {
    if (!(await isPhantomInstalled())) {
      fail("Phantom is not installed. Stack cannot read the vault without it.");
      return;
    }
    const config = await readConfig();
    const vaultKeys = new Set(await listSecrets());
    const services = Object.entries(config.services).map(([name, entry]) => ({
      name,
      secrets: entry.secrets.map((secret) => ({ name: secret, in_vault: vaultKeys.has(secret) })),
    }));
    const declared = [...new Set(Object.values(config.services).flatMap((e) => e.secrets))];
    const report = {
      schema: "ashlr.stack.env/v1",
      env,
      services,
      missing: declared.filter((k) => !vaultKeys.has(k)).sort(),
      orphans: [...vaultKeys].filter((k) => !declared.includes(k)).sort(),
      totals: { declared: declared.length, in_vault: vaultKeys.size },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (err) {
    fail((err as Error).message);
  }
}

/**
 * `stack env diff --json`: the declared secret names missing from the vault,
 * each with the service that declares it. Exits 1 when any are missing, like
 * the human form, so a CI gate works either way. A missing project, missing
 * Phantom or unreadable vault prints `{"error": ...}` and exits 1.
 */
async function runEnvDiffJson(): Promise<void> {
  const fail = (error: string) => {
    process.stdout.write(`${JSON.stringify({ error })}\n`);
    process.exitCode = 1;
  };
  try {
    if (!(await isPhantomInstalled())) {
      fail("Phantom is not installed. Stack cannot read the vault without it.");
      return;
    }
    const config = await readConfig();
    const vaultKeys = new Set(await listSecrets());
    const missing = Object.entries(config.services).flatMap(([service, entry]) =>
      entry.secrets.filter((name) => !vaultKeys.has(name)).map((name) => ({ name, service })),
    );
    const declared = new Set(Object.values(config.services).flatMap((e) => e.secrets));
    const report = {
      schema: "ashlr.stack.env-diff/v1",
      ok: missing.length === 0,
      missing,
      totals: { declared: declared.size, missing: missing.length },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (missing.length > 0) process.exitCode = 1;
  } catch (err) {
    fail((err as Error).message);
  }
}

/** `stack env` — inspect the env-var map. Bare `stack env` runs `show`. */
export const envCommand = defineCommand({
  meta: {
    name: "env",
    description: "Inspect the effective env-var map for this stack.",
  },
  // Bare `stack env` runs `show`, so it takes the same options.
  args: envShowCommand.args,
  subCommands: {
    show: envShowCommand,
    export: defineCommand({
      meta: {
        name: "export",
        description: "Write a .env.example skeleton from the catalog secrets.",
      },
      args: {
        example: {
          type: "boolean",
          default: false,
          description: "Write .env.example (required flag to distinguish from future sub-verbs).",
        },
        stdout: {
          type: "boolean",
          default: false,
          description: "Print to stdout instead of writing a file.",
        },
        force: {
          type: "boolean",
          default: false,
          description: "Overwrite an existing .env.example without prompting.",
        },
      },
      async run({ args }) {
        // With --stdout, stdout is the file (`stack env export --stdout > .env.example`),
        // so no banner or outro goes there.
        if (!args.stdout) intro("stack env export");
        const config = await readConfig();
        const lines: string[] = [];

        for (const [name, entry] of Object.entries(config.services)) {
          const ref = findProviderRef(entry.provider);
          const displayName = ref?.displayName ?? entry.provider;
          const secrets = ref?.secrets ?? entry.secrets;

          // Always emit the header. Skip body only if secrets array is empty.
          lines.push(
            `# ── ${displayName} ${"─".repeat(Math.max(0, 40 - displayName.length - name.length - 1))}`,
          );
          for (const key of secrets) {
            lines.push(`${key}=`);
          }
          lines.push("");
        }

        const content = lines.join("\n");

        if (args.stdout) {
          process.stdout.write(content);
          return;
        }

        const outPath = resolve(join(process.cwd(), ".env.example"));
        if (existsSync(outPath) && !args.force) {
          outroError(".env.example already exists. Use --force to overwrite.");
          return;
        }

        await writeFile(outPath, content, "utf-8");
        outro(`${colors.green("✓")} wrote ${outPath}`);
      },
    }),
    diff: defineCommand({
      meta: { name: "diff", description: "Which declared secrets are missing from the vault?" },
      args: {
        json: {
          type: "boolean",
          default: false,
          description:
            "Emit machine-readable JSON (schema ashlr.stack.env-diff/v1, secret names only). Exits 1 when any are missing.",
        },
      },
      async run({ args }) {
        if (args.json) {
          await runEnvDiffJson();
          return;
        }
        intro("stack env diff");
        await requirePhantom();
        const config = await readConfig();
        const vaultKeys = new Set(await listSecrets());
        const missing: string[] = [];
        for (const entry of Object.values(config.services)) {
          for (const slot of entry.secrets) {
            if (!vaultKeys.has(slot)) missing.push(slot);
          }
        }
        if (missing.length === 0) {
          outro(colors.green("All declared secrets present."));
          return;
        }
        for (const s of missing) console.log(`  ${colors.red("○")} ${s}`);
        outroError(`${missing.length} secret(s) missing from the vault.`);
      },
    }),
  },
  // Bare `stack env` means `stack env show`. citty 0.1.6 also calls this
  // parent `run` after a matched subcommand, so only act when none was given.
  async run({ rawArgs }) {
    if (rawArgs.some((a) => !a.startsWith("-"))) return;
    await runCommand(envShowCommand, { rawArgs });
  },
});
