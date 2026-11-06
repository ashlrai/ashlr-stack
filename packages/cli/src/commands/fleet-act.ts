import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";

type Action =
  | { verb: "pause" | "resume"; lane: string }
  | { verb: "kill"; job: string }
  | { verb: "reassign"; job: string; lane: string }
  | { verb: "slots"; lane: string; slots: number }
  | { verb: "steer"; job: string; message: string };

/** Closed v1 schema: reject unrelated fields and never interpolate input into a shell. */
export function validateFleetAction(input: Record<string, unknown>): Action {
  const fields: Record<string, string[]> = {
    pause: ["lane"],
    resume: ["lane"],
    kill: ["job"],
    reassign: ["job", "lane"],
    slots: ["lane", "slots"],
    steer: ["job", "message"],
  };
  const verb = input.verb;
  const allowed =
    typeof verb === "string" && Object.hasOwn(fields, verb) ? fields[verb] : undefined;
  if (!allowed) throw new Error("Expected pause, resume, kill, reassign, slots or steer.");
  if (Object.keys(input).some((key) => key !== "verb" && !allowed.includes(key)))
    throw new Error("Unexpected field for fleet action.");
  for (const key of allowed) {
    const value = input[key];
    if (key === "slots") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        throw new Error("slots must be a nonnegative safe integer.");
    } else if (key === "message") {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 4096 ||
        [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw new Error("message must contain 1–4096 characters without control characters.");
    } else if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
      throw new Error(
        `${key} must be a 1–128 character identifier (letters, digits, underscore, hyphen).`,
      );
    }
  }
  return { ...input } as Action;
}

/** The journal is the request outbox, not evidence of dispatcher execution. */
export async function requestFleetAction(
  input: Record<string, unknown>,
  options: { queue?: string; apply?: boolean; dryRun?: boolean } = {},
) {
  const action = validateFleetAction(input);
  if (options.apply && options.dryRun) throw new Error("Use either --apply or --dry-run.");
  const record = {
    schemaVersion: 1,
    requestId: randomUUID(),
    requestedAt: new Date().toISOString(),
    status: options.apply ? "requested" : "dry-run",
    action,
  };
  if (options.apply) {
    const queue = options.queue ?? join(homedir(), ".ashlr-runs", "queue");
    await mkdir(queue, { recursive: true, mode: 0o700 });
    // One append per record, no read/modify/write; refuse symlink destinations.
    const file = await open(
      join(queue, "fleet-act.audit.jsonl"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      if (!(await file.stat()).isFile())
        throw new Error("Fleet audit destination must be a regular file.");
      await file.writeFile(`${JSON.stringify(record)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
  }
  return record;
}

export const fleetActCommand = defineCommand({
  meta: {
    name: "fleet-act",
    description:
      "Preview fleet requests; --apply appends a v1 audit request for a dispatcher consumer.",
  },
  args: {
    verb: {
      type: "positional",
      required: true,
      description: "pause, resume, kill, reassign, slots or steer.",
    },
    lane: { type: "string", description: "Lane identifier (pause/resume/reassign/slots)." },
    job: { type: "string", description: "Job identifier (kill/reassign/steer)." },
    slots: { type: "string", description: "Nonnegative integer target (slots)." },
    message: { type: "string", description: "Steering text; never include secrets (steer)." },
    queue: { type: "string", description: "Queue directory (default: ~/.ashlr-runs/queue)." },
    apply: {
      type: "boolean",
      description: "Append request to fleet-act.audit.jsonl; does not execute it.",
    },
    dryRun: { type: "boolean", description: "Preview without writing (default)." },
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON." },
  },
  async run({ args }) {
    if (args._.length !== 1) throw new Error("Expected exactly one fleet action verb.");
    const input: Record<string, unknown> = { verb: args.verb };
    for (const key of ["lane", "job", "slots", "message"] as const) {
      if (args[key] !== undefined)
        input[key] =
          key === "slots"
            ? /^(0|[1-9]\d*)$/.test(args[key]!)
              ? Number(args[key])
              : Number.NaN
            : args[key];
    }
    const record = await requestFleetAction(input, args);
    console.log(
      args.json
        ? JSON.stringify(record)
        : `${record.status}: ${record.action.verb} (${record.requestId})`,
    );
  },
});
