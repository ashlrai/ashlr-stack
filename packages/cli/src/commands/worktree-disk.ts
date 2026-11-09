import { defineCommand } from "citty";
import { collectWorktreeDisk } from "../lib/worktree-disk.ts";

export const worktreeDiskCommand = defineCommand({
  meta: {
    name: "worktree-disk",
    description: "Rank registered worktrees by disk usage (read-only).",
  },
  args: {
    repo: { type: "string", description: "Repository path (default: current directory)." },
    base: { type: "string", description: "Merge target (default: origin/HEAD, or main)." },
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON." },
  },
  async run({ args }) {
    const report = await collectWorktreeDisk(args.repo ?? process.cwd(), args.base);
    if (args.json) {
      console.log(JSON.stringify(report));
      return;
    }
    console.log(`Worktree disk usage (allocated bytes; merge target: ${report.base})`);
    for (const entry of report.entries) {
      const state = (value: boolean | null, yes: string, no: string) =>
        value === null ? "unknown" : value ? yes : no;
      console.log(
        `${entry.bytes}${entry.complete ? "" : "+"} bytes  ${state(entry.merged, "merged", "unmerged")}  ${state(entry.dirty, "dirty", "clean")}  ${entry.path}`,
      );
    }
    if (report.entries.some((entry) => !entry.complete))
      console.log("+ means the size is a lower bound: some paths could not be read.");
  },
});
