import { join } from "node:path";
import { isFleetRow, readFleetJson } from "./fleet-jsonl.ts";

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** A deliberately narrow aggregate: no source-controlled strings or environment values. */
export async function collectLeaderFleetContext(runsDir: string) {
  const source = await readFleetJson(join(runsDir, "queue", "status.json"), {
    object: true,
    maxBytes: 1024 * 1024,
    ioStatus: "unavailable",
  });
  const status = isFleetRow(source.data) ? source.data : {};
  const admission = isFleetRow(status.admission) ? status.admission : {};
  const lanes = isFleetRow(status.lanes) ? Object.values(status.lanes) : null;
  const queued = lanes?.map((lane) => count(isFleetRow(lane) ? lane.queued : null));
  const total = queued?.every((value) => value !== null)
    ? queued.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    statusSource: source.status,
    admission: { cap: count(admission.cap), running: count(admission.running) },
    queueDepth: count(total),
  };
}
