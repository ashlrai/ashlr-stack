import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type CapabilityDeclaration,
  type FleetResource,
  type FleetResourceQuota,
  type JobRequirement,
  buildFleetResource,
  isFleetCapability,
  isFleetRole,
  isFleetTier,
  isResourceId,
  matchRequirement,
  parseCapabilityDocument,
  parseModelMap,
  resolveModel,
  resourceHeadroom,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import {
  type FleetRow,
  isFleetRow,
  readFleetJson,
  readFleetJsonl,
  readFleetText,
} from "../lib/fleet-jsonl.ts";

const FLEET_ROLES_HINT = "planner, implementer, reviewer, release-verifier";

const nonNegInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Latest journal row per job id; jobs rows override queue rows on shared fields. */
function latestJobRows(rows: FleetRow[]): Map<string, FleetRow> {
  const latest = new Map<string, FleetRow>();
  for (const row of rows) {
    const id = row.id ?? row.job_id;
    if (typeof id === "string") latest.set(id, { ...latest.get(id), ...row });
  }
  return latest;
}

/**
 * Per-pool running/queued counts from each job's LATEST journal row — a job
 * that transitioned queued→running must not be counted in both buckets.
 */
function poolCounts(
  latest: Map<string, FleetRow>,
): Map<string, { running: number; queued: number }> {
  const counts = new Map<string, { running: number; queued: number }>();
  for (const row of latest.values()) {
    const pool = row.pool;
    const status = row.status;
    if (typeof pool !== "string" || !isResourceId(pool)) continue;
    if (status !== "running" && status !== "queued") continue;
    const entry = counts.get(pool) ?? { running: 0, queued: 0 };
    entry[status]++;
    counts.set(pool, entry);
  }
  return counts;
}

/** ready.tsv rows are `job<TAB>repo<TAB>lane<TAB>tier<TAB>prompt`; only the first four fields are read. */
function readyRow(text: string, job: string): { lane: string | null; tier: string | null } | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f[0] !== job) continue;
    return {
      lane: typeof f[2] === "string" && isResourceId(f[2]) ? f[2] : null,
      tier: typeof f[3] === "string" && isFleetTier(f[3]) ? f[3] : null,
    };
  }
  return null;
}

export interface FleetMatchFlags {
  role?: string;
  capabilities?: string[];
  tier?: string;
}

export interface FleetMatchJobInfo {
  id: string;
  found: boolean;
  /** The lane/pool the queue proposed for this job, when known. Informational
   * only — eligibility is decided by capabilities, never by this name. */
  proposedResource: string | null;
}

export interface FleetMatchDerivation {
  requirement: JobRequirement | null;
  error: string | null;
  job: FleetMatchJobInfo | null;
}

/**
 * Build the requirement from explicit flags plus whatever a `--job` lookup
 * found. Flags win per-field; job/journal fields fill the gaps; a job with no
 * role field is an implementer job (every queued job today is a coding job).
 * A job role outside the fleet vocabulary is reported, never coerced.
 */
export function deriveFleetRequirement(
  flags: FleetMatchFlags,
  jobId: string | undefined,
  jobRow: FleetRow | undefined,
  ready: { lane: string | null; tier: string | null } | null,
): FleetMatchDerivation {
  const found = jobRow !== undefined || ready !== null;
  const job: FleetMatchJobInfo | null = jobId
    ? {
        id: jobId,
        found,
        proposedResource:
          (typeof jobRow?.pool === "string" && isResourceId(jobRow.pool) ? jobRow.pool : null) ??
          ready?.lane ??
          null,
      }
    : null;

  const flagGiven =
    flags.role !== undefined || flags.capabilities !== undefined || flags.tier !== undefined;
  // No explicit requirement and nothing found for --job: matrix mode, no match.
  if (!flagGiven && (jobId === undefined || !found)) return { requirement: null, error: null, job };

  const rowRole = jobRow?.role;
  const rowCaps = Array.isArray(jobRow?.capabilities)
    ? jobRow.capabilities.filter((c): c is string => typeof c === "string" && isFleetCapability(c))
    : [];
  const rowTier =
    typeof jobRow?.tier === "string" && isFleetTier(jobRow.tier)
      ? jobRow.tier
      : (ready?.tier ?? null);

  const role = flags.role ?? (typeof rowRole === "string" ? rowRole : "implementer");
  if (!isFleetRole(role)) {
    return {
      requirement: null,
      error:
        rowRole !== undefined && typeof rowRole === "string"
          ? `job ${jobId} declares role "${rowRole.slice(0, 64)}", which is not a fleet role (${FLEET_ROLES_HINT})`
          : `role "${String(role).slice(0, 64)}" is not a fleet role (${FLEET_ROLES_HINT})`,
      job,
    };
  }
  return {
    requirement: {
      role,
      capabilities: [...new Set(flags.capabilities ?? rowCaps)],
      tier: flags.tier ?? rowTier,
    },
    error: null,
    job,
  };
}

export interface FleetMatchOptions extends FleetMatchFlags {
  job?: string;
  capabilitiesPath?: string;
  modelsPath?: string;
  now?: () => Date;
}

interface ResourceReport extends Omit<FleetResource, "quota"> {
  quota: (FleetResourceQuota & { headroom: number | null }) | null;
  model: string | null;
  modelVia: string | null;
  match: { eligible: boolean; reasons: string[]; headroom: number | null } | null;
}

/**
 * Assemble the capability matrix for a fleet state directory and optionally
 * match one job requirement against it. Read-only; every source reports its
 * own status and unknown inputs never become zero.
 */
export async function collectFleetMatch(queue: string, options: FleetMatchOptions = {}) {
  const runsDir = dirname(queue);
  const capabilitiesPath = options.capabilitiesPath ?? join(runsDir, "capabilities.json");
  const modelsPath = options.modelsPath ?? join(runsDir, "models.json");

  const [slots, queueJournal, jobsJournal, ready, hold, capsText, modelsText] = await Promise.all([
    readFleetJson(join(queue, "slots.json"), { object: true }),
    readFleetJsonl(join(queue, "queue.jsonl"), { allowArray: true }),
    readFleetJsonl(join(queue, "jobs.jsonl"), { allowArray: true }),
    readFleetText(join(queue, "ready.tsv"), { maxBytes: 4 * 1024 * 1024 }),
    lstat(join(queue, "HOLD")).then(
      () => "present" as const,
      (error: unknown) =>
        isFleetRow(error) && error.code === "ENOENT"
          ? ("absent" as const)
          : ("unavailable" as const),
    ),
    readFleetText(capabilitiesPath),
    readFleetText(modelsPath),
  ]);

  const journalsKnown = queueJournal.status === "ok" && jobsJournal.status === "ok";
  const latest = latestJobRows([...queueJournal.rows, ...jobsJournal.rows]);
  const counts = journalsKnown
    ? poolCounts(latest)
    : new Map<string, { running: number; queued: number }>();

  const declarations = new Map<string, CapabilityDeclaration>();
  let capsDropped = 0;
  let capsStatus: "ok" | "missing" | "invalid" | "unavailable" =
    capsText.status === "ok" ? "ok" : capsText.status;
  if (capsText.status === "ok") {
    const parsed = parseCapabilityDocument(capsText.text);
    if (parsed.status === "ok") {
      for (const [id, decl] of parsed.document.resources) declarations.set(id, decl);
      capsDropped = parsed.document.dropped;
    } else {
      capsStatus = "invalid";
    }
  }

  const modelsParsed =
    modelsText.status === "ok"
      ? parseModelMap(modelsText.text)
      : { map: new Map<string, string>(), dropped: 0, status: "ok" as const };

  const slotRows = isFleetRow(slots.data) ? slots.data : {};
  const fleetHardCap = nonNegInt(slotRows.hard_cap);
  const ids = new Set<string>();
  // Only object-valued slot entries are resources; top-level scalars like
  // `hard_cap` are fleet-wide settings, not lanes.
  for (const [key, value] of Object.entries(slotRows))
    if (isFleetRow(value) && isResourceId(key)) ids.add(key);
  for (const id of declarations.keys()) ids.add(id);
  if (journalsKnown) for (const id of counts.keys()) ids.add(id);

  const derived = deriveFleetRequirement(
    { role: options.role, capabilities: options.capabilities, tier: options.tier },
    options.job,
    options.job ? latest.get(options.job) : undefined,
    options.job && ready.status === "ok" ? readyRow(ready.text, options.job) : null,
  );
  const tierForModel = derived.requirement?.tier ?? null;

  const resources: (FleetResource & { model: string | null; modelVia: string | null })[] = [...ids]
    .sort()
    .map((id) => {
      const slot = isFleetRow(slotRows[id]) ? slotRows[id] : null;
      const quota: FleetResourceQuota | null =
        slots.status === "ok" && slot !== null
          ? {
              target: nonNegInt(slot.target),
              ceiling: nonNegInt(slot.ceiling),
              hardCap: nonNegInt(slot.hard_cap),
              held: slot.held === true,
              running: journalsKnown ? (counts.get(id)?.running ?? 0) : null,
              queued: journalsKnown ? (counts.get(id)?.queued ?? 0) : null,
              quotaRemaining: numOrNull(slot.quota),
            }
          : null;
      const resolved = resolveModel(modelsParsed.map, id, tierForModel);
      return {
        ...buildFleetResource(id, declarations.get(id), quota),
        model: resolved?.model ?? null,
        modelVia: resolved?.via ?? null,
      };
    });

  const fleetRunning = journalsKnown
    ? [...counts.values()].reduce((sum, c) => sum + c.running, 0)
    : null;

  const match =
    derived.requirement === null
      ? null
      : matchRequirement(derived.requirement, resources, {
          fleetHold: hold === "present",
          fleet: { running: fleetRunning, hardCap: fleetHardCap },
        });
  const matchById = new Map((match?.matches ?? []).map((m) => [m.id, m]));

  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sources: {
      slots: slots.status,
      queue: queueJournal.status,
      jobs: jobsJournal.status,
      capabilities: capsStatus,
      capabilitiesDropped: capsDropped,
      models:
        modelsText.status === "ok" && modelsParsed.status === "invalid"
          ? "invalid"
          : modelsText.status,
      modelsDropped: modelsParsed.dropped,
      ready: ready.status,
      hold,
    },
    fleet: { running: fleetRunning, hardCap: fleetHardCap, hold: hold === "present" },
    requirement: derived.requirement,
    requirementError: derived.error,
    job: derived.job,
    resources: resources.map((r): ResourceReport => {
      const { model, modelVia, ...rest } = r;
      const m = matchById.get(r.id);
      return {
        ...rest,
        quota: r.quota === null ? null : { ...r.quota, headroom: resourceHeadroom(r.quota) },
        model,
        modelVia,
        match: m ? { eligible: m.eligible, reasons: m.reasons, headroom: m.headroom } : null,
      };
    }),
    eligible: match?.eligible ?? null,
  };
}

export const fleetMatchCommand = defineCommand({
  meta: {
    name: "fleet-match",
    description:
      "Map a job requirement to eligible fleet resources by capability, quota and availability.",
  },
  args: {
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON." },
    queue: { type: "string", description: "Fleet queue directory (default: ~/.ashlr-runs/queue)." },
    role: { type: "string", description: `Required role: ${FLEET_ROLES_HINT}.` },
    capability: {
      type: "string",
      description: "Comma-separated capability tags the resource must declare.",
    },
    tier: { type: "string", description: "Required tier (e.g. frontier, work, mid, fast)." },
    job: {
      type: "string",
      description: "Derive the requirement from a queued job id (ready.tsv + journals).",
    },
    capabilitiesFile: {
      type: "string",
      description: "Capabilities file (default: capabilities.json beside the queue directory).",
    },
    modelsFile: {
      type: "string",
      description: "Models file (default: models.json beside the queue directory).",
    },
  },
  async run({ args }) {
    const capabilities = args.capability
      ?.split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (capabilities?.some((c) => !isFleetCapability(c)))
      throw new Error("Invalid capability tag; expected lowercase tags like local-inference.");
    if (args.role !== undefined && !isFleetRole(args.role))
      throw new Error(`Invalid role; expected one of: ${FLEET_ROLES_HINT}.`);
    if (args.tier !== undefined && !isFleetTier(args.tier))
      throw new Error("Invalid tier; expected a lowercase tier name.");
    if (args.job !== undefined && !isResourceId(args.job)) throw new Error("Invalid job id.");

    const report = await collectFleetMatch(args.queue ?? join(homedir(), ".ashlr-runs", "queue"), {
      role: args.role,
      capabilities,
      tier: args.tier,
      job: args.job,
      capabilitiesPath:
        typeof args.capabilitiesFile === "string" ? args.capabilitiesFile : undefined,
      modelsPath: typeof args.modelsFile === "string" ? args.modelsFile : undefined,
    });
    if (args.json) {
      console.log(JSON.stringify(report));
      return;
    }
    const req = report.requirement;
    console.log(
      req
        ? `Requirement: role=${req.role} capabilities=[${req.capabilities.join(", ")}] tier=${req.tier ?? "any"}${report.job?.proposedResource ? ` (job ${report.job.id} proposed ${report.job.proposedResource})` : ""}`
        : report.requirementError
          ? `Requirement: invalid — ${report.requirementError}`
          : "Capability matrix (no requirement given; pass --role/--job to match)",
    );
    console.log(
      `Sources: slots=${report.sources.slots} queue=${report.sources.queue} jobs=${report.sources.jobs} capabilities=${report.sources.capabilities} models=${report.sources.models} hold=${report.sources.hold} ready=${report.sources.ready}`,
    );
    console.log(
      `Fleet: running=${report.fleet.running ?? "unknown"} hardCap=${report.fleet.hardCap ?? "unknown"} hold=${report.fleet.hold}`,
    );
    for (const r of report.resources) {
      const q = r.quota;
      const quotaText = q
        ? `target=${q.target ?? "?"} running=${q.running ?? "?"} headroom=${q.headroom ?? "?"}${q.held ? " held" : ""}`
        : "quota=unknown";
      const matchText = r.match
        ? r.match.eligible
          ? "ELIGIBLE"
          : `ineligible: ${r.match.reasons.join(", ")}`
        : "";
      console.log(
        `${r.id}: roles=[${r.roles.join(", ")}] caps=[${r.capabilities.join(", ")}]${r.tiers ? ` tiers=[${r.tiers.join(", ")}]` : ""} ${quotaText}${r.model ? ` model=${r.model}` : ""} ${matchText}`.trimEnd(),
      );
    }
    if (report.eligible) console.log(`Eligible: ${report.eligible.join(", ") || "none"}`);
  },
});
