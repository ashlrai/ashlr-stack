/**
 * capability-matrix.ts — resource-agnostic job→resource matching for the fleet.
 *
 * Today dispatch lanes are provider-named (codex-cmp, claude, devin, codex-local,
 * …) and the dispatcher picks a lane per queued job. The end-state binds fleet
 * roles to whatever resource has the capability, quota and availability — this
 * module is that matching layer. It is pure: callers assemble `FleetResource`
 * rows from fleet state (slots.json, journals, capabilities.json, models.json)
 * and this file answers "which resources can serve this requirement" without
 * ever branching on a provider or lane name.
 *
 * Vocabulary:
 * - Roles (closed set): the four fleet roles a job can require.
 * - Capabilities (open, validated): orthogonal execution properties a job may
 *   additionally require; FLEET_CAPABILITIES seeds the known tags.
 * - Tiers: open, validated strings (the dispatcher uses frontier/work/mid/fast).
 *
 * Default capability profile: a resource with no capabilities.json declaration
 * serves the `implementer` role on every tier — the same contract dispatchd
 * applies today, where any lane can launch a coding job. A declaration can
 * narrow roles (`roles: []` serves nothing) or widen them (planner, reviewer,
 * release-verifier need explicit declaration).
 */

export const FLEET_ROLES = ["planner", "implementer", "reviewer", "release-verifier"] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];

/** Seed capability tags; the vocabulary is open — any well-formed tag is valid. */
export const FLEET_CAPABILITIES = [
  /** Model inference runs on this host; loopback-only serving, no provider quota. */
  "local-inference",
  /** May run the publish path (fork-only pushes through publish.sh). */
  "publish",
  /** Can observe CI and repository state (gh or Locus-scoped reads). */
  "ci-watch",
] as const;

const ROLE_SET: ReadonlySet<string> = new Set(FLEET_ROLES);
const RESOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TIER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const isFleetRole = (value: unknown): value is FleetRole =>
  typeof value === "string" && ROLE_SET.has(value);

export const isResourceId = (value: unknown): value is string =>
  typeof value === "string" && RESOURCE_ID_RE.test(value);

const isTag = (value: unknown): value is string => typeof value === "string" && TAG_RE.test(value);
const isTier = (value: unknown): value is string =>
  typeof value === "string" && TIER_RE.test(value);

/** Well-formed capability tag (`local-inference`, `publish`, …); vocabulary is open. */
export const isFleetCapability = isTag;
/** Well-formed tier name (`frontier`, `work`, `mid`, `fast`, …); vocabulary is open. */
export const isFleetTier = isTier;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Roles a resource serves when nothing narrows them: implementer only. */
export const DEFAULT_RESOURCE_ROLES: readonly FleetRole[] = ["implementer"];

/** Per-resource quota/availability projection (slots.json + journal counts). */
export interface FleetResourceQuota {
  /** Operating launch bound (slots.json target); null when unknown. */
  target: number | null;
  ceiling: number | null;
  hardCap: number | null;
  /** Operator or autobackoff hold. */
  held: boolean;
  /** Observed running jobs for this resource; null when journals are unreadable. */
  running: number | null;
  /** Observed queued jobs for this resource; null when journals are unreadable. */
  queued: number | null;
  /** Provider quota reading from slots.json when present; informational only —
   * the dispatcher does not launch-block on it, so neither does matching. */
  quotaRemaining: number | null;
}

/** What capabilities.json may declare for one resource. */
export interface CapabilityDeclaration {
  /** null = default (implementer); [] = serves no role. */
  roles: readonly FleetRole[] | null;
  capabilities: readonly string[];
  /** null = every tier; otherwise the tiers this resource serves. */
  tiers: readonly string[] | null;
}

/** A schedulable resource after declarations and live quota are merged. */
export interface FleetResource {
  id: string;
  /** True when capabilities.json declared this resource. */
  declared: boolean;
  /** Effective roles (declaration or the implementer default). */
  roles: readonly FleetRole[];
  capabilities: readonly string[];
  tiers: readonly string[] | null;
  /** null = no slot data; capacity checks then report headroom null, never block. */
  quota: FleetResourceQuota | null;
}

/** What a job needs: a role, optional extra capability tags, optional tier. */
export interface JobRequirement {
  role: FleetRole;
  capabilities: readonly string[];
  tier: string | null;
}

export interface ResourceMatch {
  id: string;
  eligible: boolean;
  /** Blocking reason codes; empty iff eligible. Codes: `missing-role:<role>`,
   * `missing-capability:<tag>`, `tier-unsupported:<tier>`, `held`,
   * `fleet-hold`, `fleet-at-capacity`, `at-capacity`. */
  reasons: string[];
  /** Spare launch slots (capacity bound minus running); null when either side
   * is unknown — unknown quota never blocks on capacity, it reports null. */
  headroom: number | null;
}

export interface MatchResult {
  requirement: JobRequirement;
  /** Eligible resources first (headroom desc, id asc), then ineligible by id. */
  matches: ResourceMatch[];
  /** Ids of eligible resources in match order. */
  eligible: string[];
}

export interface MatchOptions {
  /** HOLD file present at the queue dir — blocks every resource. */
  fleetHold?: boolean;
  /** Fleet-wide running total and hard cap; blocks all only when certainly full. */
  fleet?: { running: number | null; hardCap: number | null };
  /** Cap on returned matches (eligible ordering preserved). Default unlimited. */
  limit?: number;
}

export interface CapabilityDocument {
  schema: "fleet.capabilities.v1";
  resources: ReadonlyMap<string, CapabilityDeclaration>;
  /** Resource entries skipped for invalid shape (they fall back to defaults). */
  dropped: number;
}

export type CapabilityDocumentResult =
  | { status: "ok"; document: CapabilityDocument; error: null }
  | { status: "invalid"; document: null; error: string };

function parseStringList(value: unknown, valid: (v: unknown) => boolean): string[] | null {
  if (!Array.isArray(value) || value.some((v) => !valid(v))) return null;
  return [...new Set(value as string[])];
}

/**
 * Parse a capabilities.json document. Strict about shape, lenient about scope:
 * unknown keys are ignored, but a resource entry with an invalid roles /
 * capabilities / tiers field is dropped whole and counted in `dropped` — an
 * invalid declaration must never silently narrow or widen a resource.
 */
export function parseCapabilityDocument(text: string): CapabilityDocumentResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { status: "invalid", document: null, error: "not valid JSON" };
  }
  if (!isRecord(root)) return { status: "invalid", document: null, error: "not a JSON object" };
  if (root.schema !== "fleet.capabilities.v1")
    return { status: "invalid", document: null, error: 'expected schema "fleet.capabilities.v1"' };
  if (root.resources !== undefined && !isRecord(root.resources))
    return { status: "invalid", document: null, error: '"resources" must be an object' };

  const resources = new Map<string, CapabilityDeclaration>();
  let dropped = 0;
  for (const [id, value] of Object.entries(isRecord(root.resources) ? root.resources : {})) {
    if (!isResourceId(id) || !isRecord(value)) {
      dropped++;
      continue;
    }
    let roles: FleetRole[] | null = null;
    if (value.roles !== undefined) {
      const parsed = parseStringList(value.roles, isFleetRole);
      if (parsed === null) {
        dropped++;
        continue;
      }
      roles = parsed as FleetRole[];
    }
    let capabilities: string[] = [];
    if (value.capabilities !== undefined) {
      const parsed = parseStringList(value.capabilities, isTag);
      if (parsed === null) {
        dropped++;
        continue;
      }
      capabilities = parsed;
    }
    let tiers: string[] | null = null;
    if (value.tiers !== undefined) {
      const parsed = parseStringList(value.tiers, isTier);
      if (parsed === null) {
        dropped++;
        continue;
      }
      tiers = parsed;
    }
    resources.set(id, { roles, capabilities, tiers });
  }
  return {
    status: "ok",
    document: { schema: "fleet.capabilities.v1", resources, dropped },
    error: null,
  };
}

/** Effective roles for a declaration; absent declaration or absent `roles` → implementer. */
export function effectiveRoles(
  declaration: CapabilityDeclaration | undefined,
): readonly FleetRole[] {
  return declaration?.roles ?? DEFAULT_RESOURCE_ROLES;
}

/** Merge a declaration with observed quota into a matchable resource. */
export function buildFleetResource(
  id: string,
  declaration: CapabilityDeclaration | undefined,
  quota: FleetResourceQuota | null,
): FleetResource {
  return {
    id,
    declared: declaration !== undefined,
    roles: effectiveRoles(declaration),
    capabilities: declaration?.capabilities ?? [],
    tiers: declaration?.tiers ?? null,
    quota,
  };
}

/** Smallest known launch bound; null when no quota field is usable. */
export function capacityBound(quota: FleetResourceQuota): number | null {
  const bounds = [quota.target, quota.ceiling, quota.hardCap].filter(
    (v): v is number => v !== null,
  );
  return bounds.length ? Math.min(...bounds) : null;
}

/** capacityBound - running; null when either side is unknown. */
export function resourceHeadroom(quota: FleetResourceQuota | null): number | null {
  if (quota === null || quota.running === null) return null;
  const bound = capacityBound(quota);
  return bound === null ? null : Math.max(0, bound - quota.running);
}

/**
 * Match one job requirement against resources. Provider- and lane-name
 * agnostic: only declared roles, capability tags, tier coverage, holds and
 * observed quota decide eligibility.
 */
export function matchRequirement(
  requirement: JobRequirement,
  resources: readonly FleetResource[],
  options: MatchOptions = {},
): MatchResult {
  const fleetFull =
    options.fleet?.hardCap != null &&
    options.fleet.running != null &&
    options.fleet.running >= options.fleet.hardCap;
  const matches: ResourceMatch[] = resources.map((resource) => {
    const reasons: string[] = [];
    if (!resource.roles.includes(requirement.role))
      reasons.push(`missing-role:${requirement.role}`);
    for (const tag of requirement.capabilities)
      if (!resource.capabilities.includes(tag)) reasons.push(`missing-capability:${tag}`);
    if (
      requirement.tier !== null &&
      resource.tiers !== null &&
      !resource.tiers.includes(requirement.tier)
    )
      reasons.push(`tier-unsupported:${requirement.tier}`);
    if (options.fleetHold === true) reasons.push("fleet-hold");
    if (fleetFull) reasons.push("fleet-at-capacity");
    if (resource.quota?.held === true) reasons.push("held");
    const headroom = resourceHeadroom(resource.quota);
    if (headroom === 0) reasons.push("at-capacity");
    return { id: resource.id, eligible: reasons.length === 0, reasons, headroom };
  });
  matches.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible) {
      // Eligible: most headroom first; unknown headroom sorts last; id breaks ties.
      if (a.headroom !== b.headroom) {
        if (a.headroom === null) return 1;
        if (b.headroom === null) return -1;
        return b.headroom - a.headroom;
      }
    }
    return a.id.localeCompare(b.id);
  });
  const limited = options.limit === undefined ? matches : matches.slice(0, options.limit);
  return {
    requirement,
    matches: limited,
    eligible: limited.filter((m) => m.eligible).map((m) => m.id),
  };
}

// ---------------------------------------------------------------------------
// models.json — flat `lane[.tier]` → model map; resolution mirrors dispatchd.
// ---------------------------------------------------------------------------

const MODEL_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;

export interface ModelMap {
  map: ReadonlyMap<string, string>;
  dropped: number;
  /** "invalid" when the text is not a JSON object; entries may still be dropped from a valid doc. */
  status: "ok" | "invalid";
}

/** Parse ~/.ashlr-runs/models.json: `{ "<resource>[.<tier>]": "<model>" }`. */
export function parseModelMap(text: string): ModelMap {
  const map = new Map<string, string>();
  let dropped = 0;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { map, dropped: 1, status: "invalid" };
  }
  if (!isRecord(root)) return { map, dropped: 1, status: "invalid" };
  for (const [key, value] of Object.entries(root)) {
    const dot = key.indexOf(".");
    const lane = dot < 0 ? key : key.slice(0, dot);
    const tier = dot < 0 ? null : key.slice(dot + 1);
    if (
      !MODEL_KEY_RE.test(lane) ||
      (tier !== null && !isTier(tier)) ||
      typeof value !== "string" ||
      !MODEL_RE.test(value.trim())
    ) {
      dropped++;
      continue;
    }
    map.set(key, value.trim());
  }
  return { map, dropped, status: "ok" };
}

/** The map family dispatchd uses: `codex` for codex-* lanes except codex-local. */
export const modelFamily = (resourceId: string): string =>
  resourceId.startsWith("codex") && resourceId !== "codex-local" ? "codex" : resourceId;

/** First non-empty of `<id>.<tier>`, `<id>`, `<family>.<tier>`, `<family>`. */
export function resolveModel(
  map: ReadonlyMap<string, string>,
  resourceId: string,
  tier: string | null,
): { model: string; via: string } | null {
  const family = modelFamily(resourceId);
  const keys =
    family === resourceId
      ? tier === null
        ? [resourceId]
        : [`${resourceId}.${tier}`, resourceId]
      : tier === null
        ? [resourceId, family]
        : [`${resourceId}.${tier}`, resourceId, `${family}.${tier}`, family];
  for (const key of keys) {
    const model = map.get(key);
    if (model) return { model, via: key };
  }
  return null;
}
