import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findProviderRef, isPhantomInstalled, listSecrets, readConfig } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

/**
 * `stack env show [--env prod]` — pretty-print the effective env-var surface
 * for this stack. For each secret the project declares, show whether it's
 * present in the Phantom vault (masked) or missing. Designed for debugging
 * "why does my app boot without Supabase?" kinds of questions.
 */
export const envCommand = defineCommand({
  meta: {
    name: "env",
    description: "Inspect the effective env-var map for this stack.",
  },
  subCommands: {
    show: defineCommand({
      meta: { name: "show", description: "Show which secrets are present in Phantom." },
      args: {
        env: { type: "string", default: "dev", description: "Environment overlay to preview." },
      },
      async run({ args }) {
        intro(`stack env show (${args.env})`);
        const phantomOk = await isPhantomInstalled();
        if (!phantomOk) {
          outroError("Phantom not installed.");
          return;
        }
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
    }),
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
        intro("stack env export");
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
          outro(colors.dim("printed to stdout."));
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
      async run() {
        intro("stack env diff");
        if (!(await isPhantomInstalled())) {
          outroError("Phantom not installed.");
          return;
        }
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
});
