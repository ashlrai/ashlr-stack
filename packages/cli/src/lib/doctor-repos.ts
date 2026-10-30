import { execFile } from "node:child_process";
import { envelope, worst } from "./doctor-envelope.ts";

export const DOCTOR_REPOS = [
  "ashlr-stack",
  "phantom",
  "phantom-secrets",
  "locus",
  "lexicon",
  "ashlr-md",
  "ashlr-plugin",
].map((name) => `ashlrai/${name}`);
export const REPO_TIMEOUT_MS = 5000;
export type GhRunner = (args: string[], signal: AbortSignal) => Promise<string>;

export const runGh: GhRunner = (args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { signal, timeout: REPO_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });

/** One deadline per repo, shared by metadata and workflow queries. Never expose gh stderr. */
export async function checkRepos(runner: GhRunner = runGh, timeoutMs = REPO_TIMEOUT_MS) {
  const repos = await Promise.all(
    DOCTOR_REPOS.map(async (repo) => {
      const signal = AbortSignal.timeout(timeoutMs);
      const result = {
        repo,
        default_branch: null as string | null,
        open_pr_count: null as number | null,
        ci_conclusion: null as string | null,
        status: "warn" as "ok" | "warn" | "fail",
        detail: "",
      };
      try {
        const query = `query { repository(owner:"ashlrai",name:"${repo.split("/")[1]}") { defaultBranchRef { name } pullRequests(states:OPEN) { totalCount } } }`;
        const metadata = JSON.parse(
          await runner(["api", "graphql", "-f", `query=${query}`], signal),
        );
        const data = metadata.data?.repository;
        if (
          metadata.errors ||
          typeof data?.defaultBranchRef?.name !== "string" ||
          !Number.isSafeInteger(data?.pullRequests?.totalCount) ||
          data.pullRequests.totalCount < 0
        )
          throw new Error();
        result.default_branch = data.defaultBranchRef.name;
        result.open_pr_count = data.pullRequests.totalCount;
        const runs = JSON.parse(
          await runner(
            [
              "run",
              "list",
              "--repo",
              repo,
              "--branch",
              result.default_branch!,
              "--limit",
              "1",
              "--json",
              "status,conclusion",
            ],
            signal,
          ),
        );
        if (!Array.isArray(runs)) throw new Error();
        const run = runs[0];
        if (!run) result.detail = "no default-branch workflow runs";
        else if (run.status !== "completed")
          result.detail = "latest default-branch workflow is pending";
        else {
          if (typeof run.conclusion !== "string" || !run.conclusion) throw new Error();
          result.ci_conclusion = run.conclusion;
          result.status =
            run.conclusion === "success"
              ? "ok"
              : ["failure", "timed_out", "action_required", "startup_failure"].includes(
                    run.conclusion,
                  )
                ? "fail"
                : "warn";
          result.detail = `latest default-branch workflow: ${run.conclusion}`;
        }
      } catch {
        result.detail = signal.aborted
          ? "repository check timed out"
          : "GitHub unavailable (offline, unauthenticated, or invalid response)";
      }
      return result;
    }),
  );
  const checks = repos.map((r) => ({
    id: `repo-${r.repo.split("/")[1]}`,
    status: r.status,
    summary: `${r.repo}: ${r.detail}`,
  }));
  return envelope({ repos }, worst(checks), "repository-health", checks);
}
