import { defineCommand } from "citty";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { locusGh } from "./fleet-latency.ts";

interface StuckPr {
  number: number;
  mergeable: string;
  mergeStateStatus: string;
  ageDays: number;
  autoMergeEnabled: boolean;
  pathReasons: string[];
}

/** Read-only snapshot. Path reasons are hints, not GitHub's explanation for disabling auto-merge. */
export async function collectFleetStuck(runner: GhRunner = locusGh, now = Date.now()) {
  const repos = await Promise.all(
    DOCTOR_REPOS.map(async (repo) => {
      const signal = AbortSignal.timeout(10000);
      const prs: StuckPr[] = [];
      try {
        const query = `query($endCursor: String) {
          repository(owner:"ashlrai",name:"${repo.split("/")[1]}") {
            pullRequests(states:OPEN,first:100,after:$endCursor) {
              totalCount pageInfo { hasNextPage endCursor }
              nodes { number createdAt mergeable mergeStateStatus changedFiles autoMergeRequest { enabledAt } }
            }
          }
        }`;
        const pages = JSON.parse(
          await runner(["api", "graphql", "--paginate", "--slurp", "-f", `query=${query}`], signal),
        );
        if (!Array.isArray(pages) || !pages.length) throw new Error("Invalid pages");
        for (const [index, page] of pages.entries()) {
          const pulls = page?.data?.repository?.pullRequests;
          if (
            page?.errors ||
            !Array.isArray(pulls?.nodes) ||
            !Number.isSafeInteger(pulls.totalCount) ||
            pulls.totalCount < 0 ||
            pulls.pageInfo?.hasNextPage !== index < pages.length - 1
          )
            throw new Error("Invalid PR page");
          for (const pr of pulls.nodes) {
            signal.throwIfAborted();
            const opened =
              typeof pr?.createdAt === "string" ? Date.parse(pr.createdAt) : Number.NaN;
            if (
              !Number.isSafeInteger(pr?.number) ||
              pr.number <= 0 ||
              !Number.isFinite(opened) ||
              opened > now ||
              !["MERGEABLE", "CONFLICTING", "UNKNOWN"].includes(pr.mergeable) ||
              ![
                "BEHIND",
                "BLOCKED",
                "CLEAN",
                "DIRTY",
                "DRAFT",
                "HAS_HOOKS",
                "UNKNOWN",
                "UNSTABLE",
              ].includes(pr.mergeStateStatus) ||
              !(
                pr.autoMergeRequest === null ||
                pr.autoMergeRequest?.enabledAt === null ||
                typeof pr.autoMergeRequest?.enabledAt === "string"
              )
            )
              throw new Error("Invalid PR");
            const pathReasons = new Set<string>();
            if (pr.autoMergeRequest === null) {
              const filePages = JSON.parse(
                await runner(
                  [
                    "api",
                    `repos/${repo}/pulls/${pr.number}/files?per_page=100`,
                    "--paginate",
                    "--slurp",
                  ],
                  signal,
                ),
              );
              if (!Array.isArray(filePages) || !filePages.length || !filePages.every(Array.isArray))
                throw new Error("Invalid file pages");
              const files = filePages.flat();
              // GitHub caps REST file lists at 3,000; never present a truncated scan as complete.
              if (!Number.isSafeInteger(pr.changedFiles) || files.length !== pr.changedFiles)
                throw new Error("Incomplete file list");
              for (const file of files) {
                if (typeof file?.filename !== "string") throw new Error("Invalid path");
                for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
                  if (typeof path !== "string") throw new Error("Invalid previous path");
                  if (/(^|\/)server\//.test(path)) pathReasons.add("server/");
                  if (
                    /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|uv\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock)$/.test(
                      path,
                    )
                  )
                    pathReasons.add("lockfile");
                }
              }
            }
            prs.push({
              number: pr.number,
              mergeable: pr.mergeable,
              mergeStateStatus: pr.mergeStateStatus,
              ageDays: (now - opened) / 86400000,
              autoMergeEnabled: pr.autoMergeRequest !== null,
              pathReasons: [...pathReasons].sort(),
            });
          }
          if (
            index === pages.length - 1 &&
            (prs.length !== pulls.totalCount ||
              new Set(prs.map((pr) => pr.number)).size !== prs.length)
          )
            throw new Error("Incomplete PR list");
        }
        prs.sort(
          (a, b) =>
            a.mergeStateStatus.localeCompare(b.mergeStateStatus) ||
            b.ageDays - a.ageDays ||
            a.number - b.number,
        );
        return { repo, status: "ok", prs };
      } catch {
        // Never echo subprocess stderr or API error bodies (they may contain credentials).
        return { repo, status: "unavailable", prs: null };
      }
    }),
  );
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), repos };
}

export const fleetStuckCommand = defineCommand({
  meta: {
    name: "fleet-stuck",
    description:
      "List open PRs by merge state, age and auto-merge status with server/ and lockfile path hints.",
  },
  args: { json: { type: "boolean", description: "Emit schemaVersion 1 JSON (also the default)." } },
  async run() {
    console.log(JSON.stringify(await collectFleetStuck()));
  },
});
