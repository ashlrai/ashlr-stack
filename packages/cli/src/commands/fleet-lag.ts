import { defineCommand } from "citty";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { locusGh, percentile } from "./fleet-latency.ts";

function timestamp(value: unknown): number {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) throw new Error("Invalid timestamp");
  return time;
}

/** Latest tag uses GitHub's underlying commit order; age uses tagger date when annotated. */
export async function collectFleetLag(runner: GhRunner = locusGh, now = Date.now()) {
  const repos = await Promise.all(
    DOCTOR_REPOS.map(async (repo) => {
      const result = {
        repo,
        status: "unavailable",
        defaultBranch: null as string | null,
        latestTag: null as string | null,
        tagAgeDays: null as number | null,
        commitsSinceTag: null as number | null,
        mergedPrCount: null as number | null,
        medianSeconds: null as number | null,
      };
      const signal = AbortSignal.timeout(10000);
      const api = async (path: string) => JSON.parse(await runner(["api", path], signal));
      try {
        const query = `query { repository(owner:"ashlrai",name:"${repo.split("/")[1]}") {
          defaultBranchRef { name target { oid } }
          refs(refPrefix:"refs/tags/",first:1,orderBy:{field:TAG_COMMIT_DATE,direction:DESC}) {
            nodes { name target { oid ... on Commit { committedDate }
              ... on Tag { tagger { date } target { oid } } } }
          }
        } }`;
        const metadata = JSON.parse(
          await runner(["api", "graphql", "-f", `query=${query}`], signal),
        );
        const data = metadata.data?.repository;
        const branch = data?.defaultBranchRef;
        const tags = data?.refs?.nodes;
        if (metadata.errors || typeof branch?.name !== "string" || !Array.isArray(tags))
          throw new Error("Invalid metadata");
        result.defaultBranch = branch.name;
        if (tags.length) {
          const tag = tags[0];
          const age = now - timestamp(tag?.target?.tagger?.date ?? tag?.target?.committedDate);
          const base = tag?.target?.target?.oid ?? tag?.target?.oid;
          if (
            typeof tag?.name !== "string" ||
            age < 0 ||
            !/^[a-f0-9]{40,64}$/.test(base ?? "") ||
            !/^[a-f0-9]{40,64}$/.test(branch.target?.oid ?? "")
          )
            throw new Error("Invalid tag");
          result.latestTag = tag.name;
          result.tagAgeDays = age / 86400000;
          // Pin both ends to SHAs so branch/tag movement cannot change this comparison.
          const comparison = await api(
            `repos/${repo}/compare/${base}...${branch.target.oid}?per_page=1`,
          );
          if (!Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by < 0)
            throw new Error("Invalid comparison");
          result.commitsSinceTag = comparison.ahead_by;
        }
        const samples = new Map<number, { merged: number; seconds: number }>();
        for (let page = 1; ; page++) {
          signal.throwIfAborted();
          const rows = await api(
            `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
          );
          if (!Array.isArray(rows)) throw new Error("Invalid pull requests");
          let oldestUpdate = Number.POSITIVE_INFINITY;
          for (const row of rows) {
            const updated = timestamp(row?.updated_at);
            oldestUpdate = Math.min(oldestUpdate, updated);
            if (row.merged_at === null) continue;
            const merged = timestamp(row.merged_at);
            const opened = timestamp(row.created_at);
            if (
              opened > merged ||
              merged > updated ||
              !Number.isSafeInteger(row.number) ||
              row.number <= 0
            )
              throw new Error("Invalid pull request");
            if (merged <= now)
              samples.set(row.number, { merged, seconds: (merged - opened) / 1000 });
          }
          const latest = [...samples.entries()]
            .sort((a, b) => b[1].merged - a[1].merged || b[0] - a[0])
            .slice(0, 20);
          // Older updated pages cannot contain a merge newer than the twentieth sample.
          if (rows.length < 100 || (latest.length === 20 && oldestUpdate < latest[19]![1].merged)) {
            result.mergedPrCount = latest.length;
            result.medianSeconds = percentile(
              latest.map(([, sample]) => sample.seconds),
              0.5,
            );
            break;
          }
        }
        result.status = tags.length ? "ok" : "no-tags";
      } catch {
        // Never echo subprocess stderr or API error bodies (they may contain credentials).
      }
      return result;
    }),
  );
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), repos };
}

export const fleetLagCommand = defineCommand({
  meta: {
    name: "fleet-lag",
    description:
      "Report per-repo commits since latest tag, tag age and median time for the last 20 merged PRs.",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit schemaVersion 1 JSON; unavailable metrics are null.",
    },
  },
  async run({ args }) {
    const report = await collectFleetLag();
    if (args.json) console.log(JSON.stringify(report));
    else
      for (const r of report.repos)
        console.log(
          `${r.repo}: ${r.status}, branch=${r.defaultBranch ?? "unknown"}, tag=${r.latestTag ?? "none/unknown"}, commits=${r.commitsSinceTag ?? "unknown"}, tag age=${r.tagAgeDays?.toFixed(1) ?? "unknown"}d, median=${r.medianSeconds ?? "unknown"}s (n=${r.mergedPrCount ?? "unknown"})`,
        );
  },
});
