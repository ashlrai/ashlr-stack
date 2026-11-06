import { defineCommand } from "citty";
import { isFleetRow, readFleetJson } from "../lib/fleet-jsonl.ts";

const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
function timestamp(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v))
    return Number.NaN;
  const time = Date.parse(v);
  return Number.isFinite(time) &&
    new Date(time).toISOString() === v.replace(/Z$/, v.includes(".") ? "Z" : ".000Z")
    ? time
    : Number.NaN;
}

/** Fixture: {latestDeployed:{version,commits:[full lowercase SHA]},
 * commits:[{sha,createdAt,mergedAt:UTC ISO string|null}]}.
 * Membership must enumerate deployed commits, not just the deployment tip.
 */
export function reportFleetDeliveryLag(input: unknown, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Invalid report time");
  const unavailable = {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    status: "unavailable",
    deployedVersion: null,
    missingCount: null,
    oldestPendingCommit: null,
    commits: [],
  };
  if (!isFleetRow(input) || !Array.isArray(input.commits)) return unavailable;
  const deployment = input.latestDeployed;
  if (
    !isFleetRow(deployment) ||
    typeof deployment.version !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(deployment.version) ||
    !Array.isArray(deployment.commits) ||
    !deployment.commits.every(sha)
  )
    return unavailable;
  const deployed = new Set<string>(deployment.commits);
  const counts = new Map<string, number>();
  for (const row of input.commits)
    if (isFleetRow(row) && sha(row.sha)) counts.set(row.sha, (counts.get(row.sha) ?? 0) + 1);
  const commits = input.commits.map((row: unknown, index: number) => {
    const invalid = {
      index,
      sha: null,
      status: "malformed",
      mergeWaitSeconds: null,
      awaitingDeploymentSeconds: null,
      mergedAt: null,
    };
    if (!isFleetRow(row) || !sha(row.sha) || counts.get(row.sha) !== 1) return invalid;
    const created = timestamp(row.createdAt);
    const merged = row.mergedAt === null ? null : timestamp(row.mergedAt);
    if (
      !Number.isFinite(created) ||
      created > now ||
      (merged !== null && (!Number.isFinite(merged) || merged < created || merged > now)) ||
      (merged === null && deployed.has(row.sha))
    )
      return invalid;
    const status =
      merged === null ? "awaiting-merge" : deployed.has(row.sha) ? "deployed" : "missing";
    return {
      index,
      sha: row.sha,
      status,
      mergeWaitSeconds: ((merged ?? now) - created) / 1000,
      awaitingDeploymentSeconds: status === "missing" ? (now - merged!) / 1000 : null,
      mergedAt: merged === null ? null : new Date(merged).toISOString(),
    };
  });
  // Oldest pending means awaiting deployment; open PRs have their own merge wait.
  const pending = commits
    .filter((r) => r.status === "missing")
    .sort(
      (a, b) =>
        b.awaitingDeploymentSeconds! - a.awaitingDeploymentSeconds! || a.sha!.localeCompare(b.sha!),
    );
  return {
    ...unavailable,
    status: commits.some((r) => r.status === "malformed") ? "partial" : "ok",
    deployedVersion: deployment.version,
    missingCount: pending.length,
    oldestPendingCommit: pending[0]?.sha ?? null,
    commits,
  };
}

export const fleetDeliveryLagCommand = defineCommand({
  meta: {
    name: "fleet-delivery-lag",
    description: "Report undeployed merged commits and merge wait from a read-only JSON fixture.",
  },
  args: {
    fixture: {
      type: "string",
      required: true,
      description:
        "JSON snapshot: latestDeployed {version, commits: SHA[]}, commits {sha, createdAt, mergedAt: UTC ISO|null}[].",
    },
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON; unknown metrics are null." },
  },
  async run({ args }) {
    /* File errors and malformed JSON must not expose paths or content. */
    const fixture = await readFleetJson(args.fixture, { maxBytes: 4 * 1024 * 1024 });
    const report = reportFleetDeliveryLag(fixture.status === "ok" ? fixture.data : undefined);
    if (report.status !== "ok") process.exitCode = 1;
    if (args.json) console.log(JSON.stringify(report));
    else {
      console.log(
        `${report.status}: deployed=${report.deployedVersion ?? "unknown"}, missing=${report.missingCount ?? "unknown"}, oldest pending=${report.oldestPendingCommit ?? "none/unknown"}`,
      );
      for (const row of report.commits)
        console.log(
          `${row.sha ?? `record ${row.index}`}: ${row.status}, merge wait=${row.mergeWaitSeconds ?? "unknown"}s, awaiting deployment=${row.awaitingDeploymentSeconds ?? "unknown"}s`,
        );
    }
  },
});
