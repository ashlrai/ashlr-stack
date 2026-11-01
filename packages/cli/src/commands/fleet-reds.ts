import { stripVTControlCharacters } from "node:util";
import { defineCommand } from "citty";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { locusGh } from "./fleet-latency.ts";

/** First named failure in log order; raw logs and assertion bodies never enter the report. */
export function firstFailingTest(log: string): string | null {
  for (const raw of log.split(/\r?\n/)) {
    const line = stripVTControlCharacters(raw)
      .replace(/^.*?\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, "")
      .trim();
    if (/^(?:not ok\b|[✖✗]).*\s+#\s*(?:TODO|SKIP)\b/.test(line)) continue;
    const match =
      /^FAIL\s+\[[^\]]+\]\s+(.+)$/.exec(line) ?? // nextest: binary + test path
      /^FAIL\s+(.+ > .+)$/.exec(line) ?? // vitest failure summary
      /^not ok\s+\d+(?:\s+-)?\s+(.+)$/.exec(line) ?? // node:test TAP
      /^[×✕✖✗]\s+(.+)$/.exec(line); // vitest verbose / node:test spec
    if (match) return match[1]!.replace(/\s+(?:\([\d.]+m?s\)|[\d.]+m?s)$/, "").trim();
  }
  return null;
}

const failed = (conclusion: string) =>
  ["failure", "timed_out", "startup_failure", "action_required"].includes(conclusion);
const completed = (value: unknown): value is string =>
  typeof value === "string" &&
  (failed(value) || ["success", "neutral", "skipped", "cancelled", "stale"].includes(value));
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

async function collectEvent(repo: string, branch: string, event: string, runner: GhRunner) {
  const signal = AbortSignal.timeout(10000);
  const result = {
    event,
    status: "unavailable",
    runId: null as number | null,
    conclusion: null as string | null,
    jobs: null as { name: string; firstFailingTest: string | null; logStatus: string }[] | null,
  };
  try {
    // Select the latest completed CI run BEFORE checking its conclusion: recovered runs clear reds.
    const runs = JSON.parse(
      await runner(
        [
          "run",
          "list",
          "--repo",
          repo,
          "--workflow",
          "CI",
          "--all",
          "--branch",
          branch,
          "--event",
          event,
          "--status",
          "completed",
          "--limit",
          "1",
          "--json",
          "databaseId,conclusion",
        ],
        signal,
      ),
    );
    if (!Array.isArray(runs) || runs.length > 1) throw new Error();
    if (!runs.length) return { ...result, status: "no-runs", jobs: [] };
    const run = runs[0];
    if (!id(run?.databaseId) || !completed(run.conclusion)) throw new Error();
    result.runId = run.databaseId;
    result.conclusion = run.conclusion;
    if (!failed(run.conclusion)) return { ...result, status: "ok", jobs: [] };
    const pages = JSON.parse(
      await runner(
        [
          "api",
          `repos/${repo}/actions/runs/${run.databaseId}/jobs?filter=latest&per_page=100`,
          "--paginate",
          "--slurp",
        ],
        signal,
      ),
    );
    if (!Array.isArray(pages) || !pages.length) throw new Error();
    const jobs = pages.flatMap((page) => {
      if (!Array.isArray(page?.jobs)) throw new Error();
      return page.jobs;
    });
    if (
      !Number.isSafeInteger(pages[0]?.total_count) ||
      pages[0].total_count < 0 ||
      jobs.length !== pages[0].total_count ||
      new Set(jobs.map((job) => job?.id)).size !== jobs.length
    )
      throw new Error();
    result.jobs = [];
    for (const job of jobs) {
      if (!id(job?.id) || typeof job.name !== "string" || !job.name || !completed(job.conclusion))
        throw new Error();
      if (!failed(job.conclusion)) continue;
      let test: string | null = null;
      let logStatus = "unavailable";
      try {
        test = firstFailingTest(
          await runner(
            [
              "run",
              "view",
              String(run.databaseId),
              "--repo",
              repo,
              "--job",
              String(job.id),
              "--log",
            ],
            signal,
          ),
        );
        logStatus = test === null ? "unrecognized" : "parsed";
      } catch {
        /* Expired logs must not hide the failed job or echo private stderr. */
      }
      result.jobs.push({ name: job.name, firstFailingTest: test, logStatus });
    }
    result.status =
      !result.jobs.length || result.jobs.some((job) => job.logStatus === "unavailable")
        ? "partial"
        : "ok";
  } catch {
    /* Never expose subprocess stderr or API error bodies. */
  }
  return result;
}

export async function collectFleetReds(runner: GhRunner = locusGh, now = Date.now()) {
  const repos = await Promise.all(
    DOCTOR_REPOS.map(async (repo) => {
      try {
        const metadata = JSON.parse(
          await runner(["api", `repos/${repo}`], AbortSignal.timeout(10000)),
        );
        if (typeof metadata?.default_branch !== "string" || !metadata.default_branch)
          throw new Error();
        const runs = await Promise.all(
          ["schedule", "push"].map((event) =>
            collectEvent(repo, metadata.default_branch, event, runner),
          ),
        );
        return {
          repo,
          defaultBranch: metadata.default_branch as string,
          status: runs.some((run) => ["unavailable", "partial"].includes(run.status))
            ? "partial"
            : "ok",
          runs,
        };
      } catch {
        return { repo, defaultBranch: null, status: "unavailable", runs: null };
      }
    }),
  );
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), repos };
}

export const fleetRedsCommand = defineCommand({
  meta: {
    name: "fleet-reds",
    description:
      "List failed jobs and first failing tests in the latest completed schedule/push CI runs.",
  },
  args: { json: { type: "boolean", description: "Emit schemaVersion 1 JSON (also the default)." } },
  async run() {
    console.log(JSON.stringify(await collectFleetReds()));
  },
});
