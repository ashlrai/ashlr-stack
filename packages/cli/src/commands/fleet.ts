import { execFile } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import { type GhRunner, checkRepos } from "../lib/doctor-repos.ts";
import { fleetCollisionsSubcommand } from "./fleet-collisions.ts";
import { fleetSloSubcommand } from "./fleet-slo.ts";

const unknown = "unknown" as const;
const count = (value: unknown): number | "unknown" =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : unknown;

/** Project only public status fields; never echo raw files or subprocess errors. */
export function fleetLanes(slotsText: string, log: string) {
  let slots: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(slotsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) slots = parsed;
  } catch {}
  let running: Record<string, unknown> = {};
  let lastTick: string | "unknown" = unknown;
  // Only the final tick is authoritative, even when it is malformed.
  const tick = log
    .split(/\r?\n/)
    .filter((line) => line.includes("tick run="))
    .at(-1);
  if (tick) {
    try {
      const match = tick.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) tick run=(\{.*?\}) q=/);
      if (match) {
        const parsed = JSON.parse(match[2]!);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          running = parsed;
          lastTick = match[1]!;
        }
      }
    } catch {}
  }
  return {
    lastTick,
    lanes: [...new Set([...Object.keys(slots), ...Object.keys(running)])].sort().map((lane) => {
      const slot = slots[lane];
      return {
        lane,
        target: count(
          slot && typeof slot === "object" ? (slot as Record<string, unknown>).target : undefined,
        ),
        running: count(running[lane]),
      };
    }),
  };
}

const locusGh: GhRunner = (args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      "locus",
      ["exec", "--", "gh", ...args],
      { signal, timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

async function readOrUnknown(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/** Bound memory and I/O even for a long-lived dispatcher's log. */
async function logTail(path: string) {
  try {
    const file = await open(path, "r");
    try {
      const size = (await file.stat()).size;
      const start = Math.max(0, size - 65536);
      const buffer = Buffer.alloc(Math.min(size, 65536));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      return start ? text.slice(text.indexOf("\n") + 1) : text;
    } finally {
      await file.close();
    }
  } catch {
    return "";
  }
}

export async function collectFleet(
  queue: string,
  runner: GhRunner = locusGh,
  logPath = join(queue, "dispatchd.log"),
) {
  const [slots, log, health] = await Promise.all([
    readOrUnknown(join(queue, "slots.json")),
    logTail(logPath),
    checkRepos(runner),
  ]);
  return {
    schemaVersion: 1,
    repos: health.repos.map((repo) => ({
      repo: repo.repo,
      defaultBranch: repo.default_branch ?? unknown,
      openPrCount: repo.open_pr_count ?? unknown,
      ci:
        repo.ci_conclusion ??
        (repo.detail === "latest default-branch workflow is pending" ? "pending" : unknown),
    })),
    ...fleetLanes(slots, log),
  };
}

export const fleetCommand = defineCommand({
  meta: {
    name: "fleet",
    description: "Show repository CI, open PR counts, and dispatcher lane status.",
  },
  args: {
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON." },
    log: {
      type: "string",
      description: "Dispatcher log path (default: ~/.ashlr-runs/dispatchd.log).",
    },
    queue: {
      type: "string",
      description: "Dispatcher queue directory (default: ~/.ashlr-runs/queue).",
    },
  },
  subCommands: {
    slo: fleetSloSubcommand,
    collisions: fleetCollisionsSubcommand,
  },
  // citty 0.1.6 also calls this parent `run` after a matched subcommand, so
  // only act when none was given (the env command does the same). Option
  // values arrive joined by bindParentOptionValues (`--queue=/path`).
  async run({ args, rawArgs }) {
    if (rawArgs.some((a) => !a.startsWith("-"))) return;
    const report = await collectFleet(
      args.queue ?? join(homedir(), ".ashlr-runs", "queue"),
      locusGh,
      args.log ?? join(homedir(), ".ashlr-runs", "dispatchd.log"),
    );
    if (args.json) console.log(JSON.stringify(report));
    else {
      for (const repo of report.repos)
        console.log(`${repo.repo}: CI ${repo.ci}, open PRs ${repo.openPrCount}`);
      console.log(`Dispatcher tick: ${report.lastTick}`);
      for (const lane of report.lanes)
        console.log(`${lane.lane}: ${lane.running} running / ${lane.target} target`);
    }
  },
});
