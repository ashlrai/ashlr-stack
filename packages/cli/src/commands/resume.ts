/**
 * `stack resume [session-id]`
 *
 * Lists recent failed provision sessions and replays from the last checkpoint,
 * skipping any steps that already completed successfully.
 *
 * When called without a session-id, prints a table of recent failed/partial
 * sessions so the operator can pick one to resume.
 *
 * When called with a session-id, delegates to `resumeProvisionFromLog()` which
 * reads the JSONL replay log and re-runs only the incomplete steps.
 */

import { listReplaySessions, resumeProvisionFromLog } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, logEvent, outro, outroError } from "../ui.ts";

export const resumeCommand = defineCommand({
  meta: {
    name: "resume",
    description:
      "Resume a crashed or interrupted provision session from its last checkpoint. Omit the session-id to list recent failed sessions.",
  },
  args: {
    sessionId: {
      type: "positional",
      required: false,
      description: "Session ID to resume (shown after a crash or in `stack resume` list).",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON.",
    },
    timeout: {
      type: "string",
      description:
        "Wall-clock timeout in seconds for each provider step. Defaults to 30. Pass 0 to disable.",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const json = Boolean(args.json);
    const sessionId = args.sessionId as string | undefined;

    // --- No session-id: list recent failed sessions ---
    if (!sessionId) {
      const sessions = listReplaySessions().filter(
        (s) => s.finalStatus !== "success",
      );

      if (json) {
        process.stdout.write(`${JSON.stringify({ ok: true, sessions })}\n`);
        return;
      }

      intro("stack resume");

      if (sessions.length === 0) {
        outro(colors.dim("No failed provision sessions found. Nothing to resume."));
        return;
      }

      console.log();
      console.log(
        colors.bold(
          `  Found ${sessions.length} incomplete session${sessions.length === 1 ? "" : "s"}:\n`,
        ),
      );

      for (const s of sessions) {
        const statusColor =
          s.finalStatus === "partial_crash"
            ? colors.yellow
            : s.finalStatus === "failed"
              ? colors.red
              : (colors.dim as (s: string) => string);
        console.log(
          `  ${colors.cyan(s.sessionId)}`,
        );
        console.log(
          `    Provider : ${s.providerName}`,
        );
        console.log(
          `    Status   : ${statusColor(s.finalStatus ?? "in_progress")}`,
        );
        console.log(
          `    Started  : ${colors.dim(s.startedAt)}`,
        );
        if (s.finishedAt) console.log(`    Ended    : ${colors.dim(s.finishedAt)}`);
        console.log(`    CWD      : ${colors.dim(s.cwd)}`);
        console.log();
      }

      console.log(
        colors.dim(
          `  Run ${colors.bold(`stack resume <session-id>`)} to replay from the last checkpoint.`,
        ),
      );
      console.log();
      return;
    }

    // --- Resume a specific session ---
    if (!json) intro(`stack resume ${sessionId}`);

    const timeoutSecs = args.timeout ? Number(args.timeout) : undefined;
    const timeoutMs =
      timeoutSecs === undefined ? undefined : timeoutSecs === 0 ? 0 : timeoutSecs * 1000;

    try {
      const result = await resumeProvisionFromLog(sessionId, {
        cwd,
        interactive: !json && process.stdout.isTTY === true,
        log: json ? () => {} : logEvent,
        timeoutMs,
      });

      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            sessionId,
            providerName: result.providerName,
            resourceId: result.resourceId,
            displayName: result.displayName,
            secretCount: result.secretCount,
            mcpWired: result.mcpWired,
          })}\n`,
        );
      } else {
        outro(
          colors.green(
            `Resumed — ${result.displayName} (${result.resourceId}) is live.`,
          ),
        );
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (json) {
        process.stdout.write(`${JSON.stringify({ ok: false, sessionId, error: msg })}\n`);
        process.exitCode = 1;
      } else {
        outroError(`Resume failed: ${msg}`);
      }
    }
  },
});
