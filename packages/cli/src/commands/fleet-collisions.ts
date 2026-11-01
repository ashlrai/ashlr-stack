import { defineCommand } from "citty";
import { readFleetText } from "../lib/fleet-jsonl.ts";

/** One repository per snapshot; duplicate PR/file rows must not inflate heat. */
export function collectFleetCollisions(input: unknown) {
  if (!Array.isArray(input)) throw new Error("Expected a gh PR JSON array");
  const files = new Map<string, Set<number>>();
  for (const pr of input) {
    if (
      !pr ||
      !Number.isSafeInteger(pr.number) ||
      pr.number <= 0 ||
      !["OPEN", "CLOSED", "MERGED"].includes(pr.state) ||
      !["CONFLICTING", "MERGEABLE", "UNKNOWN"].includes(pr.mergeable) ||
      !Array.isArray(pr.files) ||
      !pr.files.every(
        (file: { path?: unknown } | null) =>
          file && typeof file.path === "string" && file.path.length > 0,
      )
    )
      throw new Error("Expected number, state, mergeable and files[].path for every PR");
    if (pr.state !== "OPEN" || pr.mergeable !== "CONFLICTING") continue;
    // GitHub reports touched files, not conflict hunks: these are coordination hotspots.
    for (const { path } of pr.files) {
      const prs = files.get(path) ?? new Set<number>();
      prs.add(pr.number);
      files.set(path, prs);
    }
  }
  return {
    schemaVersion: 1,
    files: [...files]
      .map(([path, prs]) => ({
        path,
        prCount: prs.size,
        prs: [...prs].sort((a, b) => a - b),
      }))
      .sort((a, b) => b.prCount - a.prCount || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

export const fleetCollisionsCommand = defineCommand({
  meta: {
    name: "fleet-collisions",
    description: "Rank touched files by open conflicting PR count from one repository's gh JSON.",
  },
  args: {
    file: { type: "string", description: "Input JSON file; omit or use - for stdin." },
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON (also the default)." },
  },
  async run({ args }) {
    try {
      let text: string;
      if (args.file && args.file !== "-") text = (await readFleetText(args.file)).text;
      else {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        text = Buffer.concat(chunks).toString("utf8");
      }
      console.log(JSON.stringify(collectFleetCollisions(JSON.parse(text))));
    } catch {
      console.error("fleet-collisions: cannot read PR JSON; require number,state,mergeable,files.");
      process.exitCode = 1;
    }
  },
});

/** Share validation and output with the top-level command, including its error path. */
export const fleetCollisionsSubcommand = defineCommand({
  ...fleetCollisionsCommand,
  meta: { ...fleetCollisionsCommand.meta, name: "collisions" },
});
