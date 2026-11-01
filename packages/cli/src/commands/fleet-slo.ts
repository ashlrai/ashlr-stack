import { defineCommand } from "citty";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { collectFleetLatency, locusGh } from "./fleet-latency.ts";

const PHANTOM_REPO = "ashlrai/phantom";
/** The fleet SLO: twenty merges a six-hour window in ashlrai/phantom. */
const MERGES_TARGET = 20;
/** The fleet SLO: a green PR merges within five minutes of opening. */
const MERGE_WITHIN_SECONDS = 5 * 60;
/** More than a thousand open PRs means the conflicting count is a guess; report unavailable. */
const MAX_OPEN_PAGES = 10;

interface OpenPulls {
  status: "ok" | "unavailable";
  openPrCount: number | null;
  conflictingPrCount: number | null;
}

/**
 * Open PRs and how many GitHub reports as conflicting. `mergeable` can still be
 * UNKNOWN while GitHub computes it; only CONFLICTING nodes count. The cursor is
 * a server-issued opaque string, validated before it is interpolated.
 */
async function collectOpenPulls(repo: string, runner: GhRunner): Promise<OpenPulls> {
  const unavailable: OpenPulls = {
    status: "unavailable",
    openPrCount: null,
    conflictingPrCount: null,
  };
  try {
    const signal = AbortSignal.timeout(10000);
    let cursor: string | null = null;
    let openPrCount: number | null = null;
    let conflicting = 0;
    for (let page = 0; page < MAX_OPEN_PAGES; page++) {
      signal.throwIfAborted();
      const after = cursor === null ? "" : `, after:"${cursor}"`;
      const query = `query { repository(owner:"ashlrai",name:"${repo.split("/")[1]}") {
        pullRequests(states:OPEN, first:100${after}) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { mergeable }
        }
      } }`;
      const metadata = JSON.parse(await runner(["api", "graphql", "-f", `query=${query}`], signal));
      const pulls = metadata.data?.repository?.pullRequests;
      if (
        metadata.errors ||
        !Number.isSafeInteger(pulls?.totalCount) ||
        pulls.totalCount < 0 ||
        !Array.isArray(pulls.nodes) ||
        typeof pulls.pageInfo?.hasNextPage !== "boolean"
      )
        return unavailable;
      openPrCount = pulls.totalCount;
      for (const node of pulls.nodes) {
        if (!["MERGEABLE", "CONFLICTING", "UNKNOWN"].includes(node?.mergeable)) return unavailable;
        if (node.mergeable === "CONFLICTING") conflicting++;
      }
      if (!pulls.pageInfo.hasNextPage)
        return { status: "ok", openPrCount, conflictingPrCount: conflicting };
      if (
        typeof pulls.pageInfo.endCursor !== "string" ||
        !/^[A-Za-z0-9+/=]+$/.test(pulls.pageInfo.endCursor)
      )
        return unavailable;
      cursor = pulls.pageInfo.endCursor;
    }
    return unavailable;
  } catch {
    // Never echo subprocess stderr or API error bodies (they may contain credentials).
    return unavailable;
  }
}

/** Merge window metrics come from fleet-latency; open and conflicting counts add one GraphQL scan. */
export async function collectFleetSlo(runner: GhRunner = locusGh, now = Date.now()) {
  const [latency, pulls] = await Promise.all([
    collectFleetLatency(runner, now),
    Promise.all(DOCTOR_REPOS.map((repo) => collectOpenPulls(repo, runner))),
  ]);
  const byRepo = new Map(pulls.map((pull, index) => [DOCTOR_REPOS[index]!, pull]));
  const repos = latency.repos.map((row) => {
    const open = byRepo.get(row.repo) ?? {
      status: "unavailable",
      openPrCount: null,
      conflictingPrCount: null,
    };
    const status =
      row.status === "ok" && open.status === "ok"
        ? "ok"
        : row.status === "unavailable" && open.status === "unavailable"
          ? "unavailable"
          : "partial";
    return {
      repo: row.repo,
      status,
      mergedPrCount: row.count,
      medianSeconds: row.medianSeconds,
      p90Seconds: row.p90Seconds,
      openPrCount: open.openPrCount,
      conflictingPrCount: open.conflictingPrCount,
      meets: {
        mergesPerWindow:
          row.repo !== PHANTOM_REPO || row.count === null ? null : row.count >= MERGES_TARGET,
        mergeWithin: row.medianSeconds === null ? null : row.medianSeconds <= MERGE_WITHIN_SECONDS,
      },
    };
  });
  return {
    schemaVersion: 1,
    windowStart: latency.windowStart,
    windowEnd: latency.windowEnd,
    targets: {
      mergesPerWindow: { repo: PHANTOM_REPO, count: MERGES_TARGET },
      mergeWithinSeconds: MERGE_WITHIN_SECONDS,
    },
    repos,
  };
}

const sloArgs = {
  json: {
    type: "boolean",
    description:
      "Emit schemaVersion 1 JSON; unavailable metrics and inapplicable targets are null.",
  },
} as const;

async function emitFleetSlo(json: boolean | undefined) {
  const report = await collectFleetSlo();
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  const verdict = (met: boolean | null) => (met === null ? "n/a" : met ? "met" : "missed");
  for (const repo of report.repos)
    console.log(
      `${repo.repo}: ${repo.status}, merged=${repo.mergedPrCount ?? "unknown"}, median=${repo.medianSeconds ?? "unknown"}s, p90=${repo.p90Seconds ?? "unknown"}s, open=${repo.openPrCount ?? "unknown"}, conflicting=${repo.conflictingPrCount ?? "unknown"}, merges/6h ${verdict(repo.meets.mergesPerWindow)}, <=5min ${verdict(repo.meets.mergeWithin)}`,
    );
}

export const fleetSloCommand = defineCommand({
  meta: {
    name: "fleet-slo",
    description:
      "Compare per-repo six-hour merges, open-to-merge latency and conflicting PRs with fleet SLO targets.",
  },
  args: sloArgs,
  async run({ args }) {
    await emitFleetSlo(args.json);
  },
});

/** Same report nested under `fleet` so `stack fleet slo` resolves. */
export const fleetSloSubcommand = defineCommand({
  meta: {
    name: "slo",
    description:
      "Compare per-repo six-hour merges, open-to-merge latency and conflicting PRs with fleet SLO targets.",
  },
  args: sloArgs,
  async run({ args }) {
    await emitFleetSlo(args.json);
  },
});
