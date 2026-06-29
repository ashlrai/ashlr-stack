/**
 * `stack replay <error-id>`
 *
 * Re-runs the exact failed provider step captured in a previous
 * `.stack/errors/<timestamp>-<id>.replay.json` sidecar.
 *
 * Transient failures (TIMEOUT, NETWORK_ERROR, API_DEGRADED, RATE_LIMITED)
 * trigger a fresh authentication pass before re-running `stack add`.
 *
 * Non-transient failures (QUOTA_EXCEEDED, RESOURCE_CONFLICT, etc.) print
 * the original report's hints and ask the user to confirm they have performed
 * the manual remediation before retrying.
 */

import {
  addService,
  loadProvisionErrorReport,
  loadReplayRecord,
  printProvisionError,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";

export const replayCommand = defineCommand({
  meta: {
    name: "replay",
    description:
      "Re-run the exact failed provider from a previous error. Pass the error-id shown after a provisioning failure.",
  },
  args: {
    errorId: {
      type: "positional",
      required: true,
      description: "The error-id shown in the failure output (e.g. abc123xyz789).",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Skip the confirmation prompt for non-transient failures.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON on completion.",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const errorId = args.errorId as string;
    const json = Boolean(args.json);

    if (!json) intro(`stack replay ${errorId}`);

    // --- Load replay record ---
    const record = loadReplayRecord(errorId, cwd);
    if (!record) {
      const msg = `No replay record found for error-id "${errorId}". Check .stack/errors/ for available ids.`;
      if (json) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
        process.exitCode = 1;
        return;
      }
      outroError(msg);
      return;
    }

    // Load the full report for its hints (best-effort).
    const report = loadProvisionErrorReport(errorId, cwd);

    if (!json) {
      console.log();
      console.log(
        `  ${colors.bold("Provider:")} ${record.providerName}   ${colors.dim(`Step: ${record.stepName}  ·  Original failure: ${record.timestamp}`)}`,
      );
      if (report) {
        console.log(`  ${colors.bold("Code:")} ${report.code}  —  ${report.title}`);
      }
      console.log();
    }

    // --- Non-transient: show hints and ask for confirmation ---
    if (!record.requiresFreshAuth && !args.force) {
      if (report) {
        if (!json) {
          console.log(
            colors.yellow(
              `  This failure (${report.code}) requires manual remediation before replay.`,
            ),
          );
          console.log();
          printProvisionError(report);
          console.log();
        }
        const proceed = process.stdout.isTTY
          ? await prompts.confirm({
              message: "Have you completed the manual remediation steps above?",
              initialValue: false,
            })
          : false;
        if (!proceed || prompts.isCancel(proceed)) {
          const msg = "Replay cancelled. Complete remediation steps first, then re-run.";
          if (json) {
            process.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
          } else {
            outroError(msg);
          }
          return;
        }
      }
    }

    // --- Execute replay ---
    if (!json) {
      const authNote = record.requiresFreshAuth
        ? " (will attempt fresh authentication)"
        : "";
      console.log(
        colors.cyan(`  Replaying ${record.providerName} provisioning${authNote}…`),
      );
      console.log();
    }

    try {
      const result = await addService({
        providerName: record.providerName,
        cwd,
        interactive: !json && process.stdout.isTTY === true,
        log: json ? () => {} : logEvent,
      });

      if (json) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, providerName: result.providerName, resourceId: result.resourceId, displayName: result.displayName })}\n`,
        );
      } else {
        outro(
          colors.green(
            `Replay succeeded — ${result.displayName} (${result.resourceId}) is live.`,
          ),
        );
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (json) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
        process.exitCode = 1;
      } else {
        outroError(`Replay failed: ${msg}`);
      }
    }
  },
});
