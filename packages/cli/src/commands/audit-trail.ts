/**
 * `stack audit-trail <sessionId> [--format md|json] [--out <file>]`
 *
 * Exports a human-readable markdown + JSON audit trail for a completed
 * provision session, including:
 *   - Full provenance steps with timestamps, decisions, and checksums
 *   - Decision justification for each step (created_new vs attached_existing)
 *   - Links partial failures to their decision points
 *
 * Used for SLA compliance reporting and post-incident analysis.
 */

import {
  readReplayLog,
  readReplaySessionMeta,
  listReplaySessions,
  checksumOutput,
  type ProvisionReplayLog,
  type ReplaySessionMeta,
  type ProvisionProvenance,
  type ProvenanceStep,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { writeFile } from "node:fs/promises";
import { colors, intro, outro, outroError } from "../ui.ts";

export const auditTrailCommand = defineCommand({
  meta: {
    name: "audit-trail",
    description:
      "Export a full audit trail (markdown + JSON) for a completed provision session. " +
      "Shows per-step checksums, timestamps, decision trees, and failure linkage.",
  },
  args: {
    sessionId: {
      type: "positional",
      description: "Session ID to audit (from `stack replay --list` or error output).",
      required: false,
    },
    format: {
      type: "string",
      default: "md",
      description: "Output format: md (markdown, default) | json | both.",
    },
    out: {
      type: "string",
      description:
        "Write output to this file path instead of stdout. " +
        "For --format both, omit extension — .md and .json are appended automatically.",
    },
    list: {
      type: "boolean",
      default: false,
      description: "List available session IDs instead of exporting a specific session.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Alias for --format json. Emits machine-readable JSON to stdout.",
    },
  },
  async run({ args }) {
    const jsonFlag = Boolean(args.json);
    const format = jsonFlag ? "json" : ((args.format ?? "md") as "md" | "json" | "both");
    const outPath = args.out as string | undefined;

    // --list: show available sessions
    if (args.list) {
      const sessions = listReplaySessions();
      if (sessions.length === 0) {
        console.log(colors.dim("  No provision sessions found."));
        return;
      }
      console.log();
      console.log(colors.bold("  Available provision sessions:"));
      console.log();
      for (const s of sessions) {
        console.log(
          `    ${colors.cyan(s.sessionId)}  ${colors.dim(s.providerName ?? "unknown")}  ${colors.dim(s.startedAt ?? "")}`,
        );
      }
      console.log();
      console.log(colors.dim(`  Run: stack audit-trail <sessionId>`));
      console.log();
      return;
    }

    const sessionId = args.sessionId as string | undefined;
    if (!sessionId) {
      console.error(
        colors.red("  Error: sessionId is required. Use --list to see available sessions."),
      );
      process.exitCode = 1;
      return;
    }

    if (!jsonFlag) intro(`stack audit-trail ${sessionId}`);

    // Read session data
    let meta: ReplaySessionMeta | undefined;
    try {
      meta = readReplaySessionMeta(sessionId);
    } catch {
      // meta may not exist — continue with what we have
    }

    let replayEntries: ProvisionReplayLog[] = [];
    try {
      replayEntries = readReplayLog(sessionId);
    } catch (e) {
      if (!jsonFlag) {
        outroError(`Failed to read session ${sessionId}: ${(e as Error).message}`);
      } else {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exitCode = 1;
      }
      return;
    }

    // Build provenance from replay log
    const provenance = buildProvenanceFromReplayLog(sessionId, meta, replayEntries);

    if (format === "json" || format === "both") {
      const jsonOut = JSON.stringify(provenance, null, 2);
      if (outPath && format === "json") {
        await writeFile(outPath, jsonOut, "utf-8");
        if (!jsonFlag) outro(colors.green(`Audit trail written to ${outPath}`));
        return;
      } else if (outPath && format === "both") {
        await writeFile(`${outPath}.json`, jsonOut, "utf-8");
      } else {
        process.stdout.write(`${jsonOut}\n`);
        return;
      }
    }

    if (format === "md" || format === "both") {
      const mdOut = buildMarkdownAuditTrail(provenance, replayEntries);
      if (outPath) {
        const mdPath = format === "both" ? `${outPath}.md` : outPath;
        await writeFile(mdPath, mdOut, "utf-8");
        if (!jsonFlag) {
          outro(
            colors.green(
              format === "both"
                ? `Audit trail written to ${outPath}.md and ${outPath}.json`
                : `Audit trail written to ${outPath}`,
            ),
          );
        }
      } else {
        console.log(mdOut);
        if (!jsonFlag) outro(colors.green("Done."));
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Build ProvisionProvenance from a replay log
// ---------------------------------------------------------------------------

/**
 * Derive a ProvenanceStep from a ProvisionReplayLog entry.
 * `ProvisionReplayLog` carries a `timestamp` (step completion time) but no
 * separate startedAt/completedAt/durationMs fields, so we synthesise them.
 */
function buildProvenanceFromReplayLog(
  sessionId: string,
  meta: ReplaySessionMeta | undefined,
  entries: ProvisionReplayLog[],
): ProvisionProvenance {
  const sessionStart = meta?.startedAt ?? (entries[0]?.timestamp ?? new Date().toISOString());

  const steps: ProvenanceStep[] = entries.map((entry) => {
    const completedAt = entry.timestamp;
    // We don't have per-step duration in the replay log, so default to 0
    const durationMs = 0;
    const startedAt = completedAt; // best-effort: same as completed when not stored

    const status: ProvenanceStep["status"] =
      entry.status === "completed"
        ? "success"
        : entry.status === "failed"
        ? "failure"
        : entry.status === "partial"
        ? "failure"
        : "skipped";

    const decision = deriveDecision(entry, status);
    const decisionReason = deriveDecisionReason(entry, decision);

    const step: ProvenanceStep = {
      stepName: entry.stepName,
      providerName: entry.providerName,
      startedAt,
      completedAt,
      durationMs,
      status,
      decision,
      decisionReason,
      outputChecksum: checksumOutput(entry.output),
      outputSummary: buildOutputSummary(entry.output),
    };
    if (entry.error) step.error = entry.error;
    return step;
  });

  const succeededProviders = [
    ...new Set(
      steps
        .filter((s) => s.status === "success" && s.stepName === "provision")
        .map((s) => s.providerName),
    ),
  ];

  const failedStep = steps.find((s) => s.status === "failure");
  const failedProvider = failedStep?.providerName;

  const rolledBack =
    meta?.finalStatus === "partial_crash" ||
    entries.some((e) => e.stepName === "rollback" || e.stepName === "deprovision");

  const completedAt =
    entries[entries.length - 1]?.timestamp ??
    meta?.finishedAt ??
    new Date().toISOString();

  const totalDurationMs = Math.max(
    0,
    new Date(completedAt).getTime() - new Date(sessionStart).getTime(),
  );

  const provenance: ProvisionProvenance = {
    sessionId,
    startedAt: sessionStart,
    completedAt,
    totalDurationMs,
    steps,
    succeededProviders,
    rolledBack,
    tags: {},
  };
  if (failedProvider) provenance.failedProvider = failedProvider;
  return provenance;
}

function deriveDecision(
  entry: ProvisionReplayLog,
  status: ProvenanceStep["status"],
): ProvenanceStep["decision"] {
  if (status === "failure") return "failed";
  if (status === "skipped") return "skipped_dry_run";

  const out = entry.output;
  if (out.attached === true || out.existing === true || out.reused === true) {
    return "attached_existing";
  }
  if (out.alreadyExists === true || out.skipped === true) {
    return "skipped_already_exists";
  }
  return "created_new";
}

function deriveDecisionReason(
  entry: ProvisionReplayLog,
  decision: ProvenanceStep["decision"],
): string {
  const out = entry.output;
  const resourceId = out.resourceId ?? out.id ?? out.projectId ?? null;
  const resourceRef = resourceId != null ? ` ('${String(resourceId)}')` : "";

  switch (decision) {
    case "created_new":
      return `Resource${resourceRef} was freshly created by the ${entry.stepName} step.`;
    case "attached_existing":
      return `Existing resource${resourceRef} was found and attached without recreating.`;
    case "skipped_already_exists":
      return `Resource${resourceRef} already existed; step was skipped to avoid duplication.`;
    case "skipped_dry_run":
      return `Step was skipped (dry-run mode or no-op).`;
    case "failed":
      return `Step failed: ${entry.error ?? "unknown error"}.`;
    default:
      return `Unknown decision.`;
  }
}

function buildOutputSummary(output: Record<string, unknown>): Record<string, string> {
  const summary: Record<string, string> = {};
  const ALLOWED_KEYS = [
    "resourceId", "id", "projectId", "name", "region", "url",
    "provider", "plan", "tier", "status", "version",
  ];
  for (const key of ALLOWED_KEYS) {
    const val = output[key];
    if (val !== undefined && val !== null) {
      summary[key] = String(val);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Markdown audit trail renderer
// ---------------------------------------------------------------------------

function buildMarkdownAuditTrail(
  provenance: ProvisionProvenance,
  replayEntries: ProvisionReplayLog[],
): string {
  const lines: string[] = [];

  lines.push(`# Provision Audit Trail`);
  lines.push("");
  lines.push(`**Session ID:** \`${provenance.sessionId}\``);
  lines.push(`**Started:** ${provenance.startedAt}`);
  lines.push(`**Completed:** ${provenance.completedAt}`);
  lines.push(`**Duration:** ${(provenance.totalDurationMs / 1000).toFixed(2)}s`);
  lines.push(`**Rolled Back:** ${provenance.rolledBack ? "Yes" : "No"}`);

  if (provenance.failedProvider) {
    lines.push(`**Failed Provider:** \`${provenance.failedProvider}\``);
  }
  if (provenance.succeededProviders.length > 0) {
    lines.push(
      `**Succeeded:** ${provenance.succeededProviders.map((p) => `\`${p}\``).join(", ")}`,
    );
  }
  if (Object.keys(provenance.tags).length > 0) {
    lines.push("");
    lines.push("**Tags:**");
    for (const [k, v] of Object.entries(provenance.tags)) {
      lines.push(`- ${k}: \`${v}\``);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Step-by-Step Decision Trail");
  lines.push("");
  lines.push("| # | Provider | Step | Status | Decision | Checksum |");
  lines.push("|---|----------|------|--------|----------|----------|");

  for (let i = 0; i < provenance.steps.length; i++) {
    const s = provenance.steps[i]!;
    const statusEmoji =
      s.status === "success" ? "✅" : s.status === "failure" ? "❌" : "⏭️";
    const decisionLabel = s.decision.replace(/_/g, " ");
    lines.push(
      `| ${i + 1} | \`${s.providerName}\` | ${s.stepName} | ${statusEmoji} ${s.status} | ${decisionLabel} | \`${s.outputChecksum || "—"}\` |`,
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Decision Justifications");
  lines.push("");

  for (let i = 0; i < provenance.steps.length; i++) {
    const s = provenance.steps[i]!;
    lines.push(`### Step ${i + 1}: \`${s.providerName}\` / ${s.stepName}`);
    lines.push("");
    lines.push(`- **Decision:** ${s.decision.replace(/_/g, " ")}`);
    lines.push(`- **Reason:** ${s.decisionReason}`);
    lines.push(`- **Timestamp:** ${s.completedAt}`);

    if (Object.keys(s.outputSummary).length > 0) {
      lines.push(`- **Output Summary:**`);
      for (const [k, v] of Object.entries(s.outputSummary)) {
        lines.push(`  - ${k}: \`${v}\``);
      }
    }
    if (s.outputChecksum) {
      lines.push(`- **Output Checksum:** \`${s.outputChecksum}\``);
    }
    if (s.error) {
      lines.push(`- **Error:** ${s.error}`);
    }
    if (s.errorCode) {
      lines.push(`- **Error Code:** \`${s.errorCode}\``);
    }
    lines.push("");
  }

  // Partial failure linkage section
  const failedSteps = provenance.steps.filter((s) => s.status === "failure");
  if (failedSteps.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Partial Failure Analysis");
    lines.push("");
    lines.push(
      "The following steps failed. Steps executed before the failure point " +
        "are candidates for rollback cleanup.",
    );
    lines.push("");

    for (const failed of failedSteps) {
      lines.push(`### Failure: \`${failed.providerName}\` / ${failed.stepName}`);
      lines.push("");
      lines.push(`- **Error:** ${failed.error ?? "unknown"}`);
      if (failed.errorCode) lines.push(`- **Code:** \`${failed.errorCode}\``);
      lines.push(`- **At:** ${failed.completedAt}`);
      lines.push("");

      // Find steps that ran before this failure (potential rollback candidates)
      const failedIdx = provenance.steps.indexOf(failed);
      const priorSucceeded = provenance.steps
        .slice(0, failedIdx)
        .filter((s) => s.status === "success" && s.decision === "created_new");

      if (priorSucceeded.length > 0) {
        lines.push("**Resources created before this failure (rollback candidates):**");
        lines.push("");
        for (const prior of priorSucceeded) {
          lines.push(
            `- \`${prior.providerName}\` / ${prior.stepName} (checksum: \`${prior.outputChecksum || "—"}\`)`,
          );
        }
        lines.push("");
      }
    }
  }

  // Raw replay log
  if (replayEntries.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Raw Replay Log");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(replayEntries, null, 2));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
