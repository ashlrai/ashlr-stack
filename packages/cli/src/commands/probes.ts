/**
 * `stack probes` — health-check probe registry commands.
 *
 * Subcommands:
 *   stack probes generate-missing [--dry-run] [--output-dir <dir>]
 *     Scans all catalog providers against the built-in probe registry,
 *     lists the 32 missing probes, and optionally writes TypeScript stub
 *     files to the output directory.
 *
 *   stack probes coverage
 *     Report probe coverage % (covered / total catalog providers).
 *     Alias: same info is shown by `stack doctor --coverage`.
 */

import {
  PROVIDERS_REF,
  defaultProbeRegistry,
  generateProbeStub,
  writeProbeStub,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors } from "../ui.ts";

// ---------------------------------------------------------------------------
// generate-missing
// ---------------------------------------------------------------------------

const generateMissingCommand = defineCommand({
  meta: {
    name: "generate-missing",
    description:
      "List providers without probe stubs and optionally write TypeScript skeleton files.",
  },
  args: {
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Print what would be written without creating any files.",
    },
    "output-dir": {
      type: "string",
      default: "./generated",
      description: "Directory to write stub files into (created if absent).",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON and exit.",
    },
  },
  async run({ args }) {
    const dryRun = Boolean(args["dry-run"]);
    const outputDir = String(args["output-dir"] ?? "./generated");
    const json = Boolean(args.json);

    const registry = defaultProbeRegistry;
    const { total, covered, pct, missing } = registry.coverageStats();

    if (json) {
      const result: {
        total: number;
        covered: number;
        pct: number;
        missing: string[];
        written?: string[];
      } = { total, covered, pct, missing };

      if (!dryRun) {
        const written: string[] = [];
        for (const name of missing) {
          const filePath = writeProbeStub(name, outputDir);
          written.push(filePath);
        }
        result.written = written;
      }

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    // Human-readable output
    console.log();
    console.log(
      `  ${colors.bold("Probe coverage:")} ${covered}/${total} providers (${colors.bold(`${pct}%`)})`,
    );
    console.log();

    if (missing.length === 0) {
      console.log(`  ${colors.green("✓")} All ${total} providers have probe stubs. Nothing to generate.`);
      console.log();
      return;
    }

    console.log(
      `  ${colors.yellow("⚠")} ${missing.length} provider${missing.length !== 1 ? "s" : ""} missing probe stubs:`,
    );
    console.log();

    for (const name of missing) {
      const ref = PROVIDERS_REF.find((p) => p.name === name);
      const displayName = ref?.displayName ?? name;
      const category = ref?.category ?? "–";
      console.log(
        `    ${colors.dim("·")} ${colors.bold(name)} ${colors.dim(`(${displayName} · ${category})`)}`,
      );
    }

    console.log();

    if (dryRun) {
      console.log(
        `  ${colors.dim(`[dry-run] Would write ${missing.length} stub file(s) to ${outputDir}/`)}`,
      );
      console.log();
      // In dry-run mode, print the stub for the first missing provider as a preview.
      const preview = missing[0];
      if (preview) {
        console.log(`  ${colors.bold("Preview stub for")} ${colors.cyan(preview)}:`);
        console.log();
        const stub = generateProbeStub(preview);
        // Indent the stub for readability in terminal output.
        for (const line of stub.split("\n").slice(0, 30)) {
          console.log(`    ${line}`);
        }
        if (stub.split("\n").length > 30) {
          console.log(`    ${colors.dim("…")}`);
        }
        console.log();
      }
      return;
    }

    // Write stubs
    const written: string[] = [];
    for (const name of missing) {
      const filePath = writeProbeStub(name, outputDir);
      written.push(filePath);
      console.log(`  ${colors.green("+")} ${colors.dim(filePath)}`);
    }

    console.log();
    console.log(
      `  ${colors.green("✓")} Wrote ${written.length} stub file${written.length !== 1 ? "s" : ""} to ${colors.bold(outputDir)}/`,
    );
    console.log(
      `  ${colors.dim("Next:")} fill in the TODO sections (quota endpoint URL + response parsing).`,
    );
    console.log();
  },
});

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

const coverageCommand = defineCommand({
  meta: {
    name: "coverage",
    description: "Report probe coverage % across all catalog providers.",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON.",
    },
  },
  run({ args }) {
    const json = Boolean(args.json);
    const { total, covered, pct, missing } = defaultProbeRegistry.coverageStats();

    if (json) {
      process.stdout.write(`${JSON.stringify({ total, covered, pct, missing }, null, 2)}\n`);
      return;
    }

    console.log();
    console.log(
      `  ${colors.bold("Probe coverage:")} ${covered}/${total} providers (${colors.bold(`${pct}%`)})`,
    );
    if (missing.length === 0) {
      console.log(`  ${colors.green("✓")} All providers have probe stubs.`);
    } else {
      console.log(
        `  ${colors.yellow("⚠")} Missing probes: ${missing.map((n) => colors.bold(n)).join(", ")}`,
      );
      console.log(
        `  ${colors.dim("→ Run `stack probes generate-missing` to scaffold stubs.")}`,
      );
    }
    console.log();
  },
});

// ---------------------------------------------------------------------------
// Root probes command
// ---------------------------------------------------------------------------

export const probesCommand = defineCommand({
  meta: {
    name: "probes",
    description: "Manage health-check probe stubs for all catalog providers.",
  },
  subCommands: {
    "generate-missing": generateMissingCommand,
    coverage: coverageCommand,
  },
});
