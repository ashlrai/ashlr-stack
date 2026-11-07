import { describe, expect, test } from "bun:test";
import {
  type CapabilityDeclaration,
  DEFAULT_RESOURCE_ROLES,
  FLEET_ROLES,
  type FleetResource,
  type FleetResourceQuota,
  type JobRequirement,
  buildFleetResource,
  capacityBound,
  effectiveRoles,
  isFleetRole,
  matchRequirement,
  modelFamily,
  parseCapabilityDocument,
  parseModelMap,
  resolveModel,
  resourceHeadroom,
} from "../fleet/capability-matrix.ts";

const quota = (over: Partial<FleetResourceQuota> = {}): FleetResourceQuota => ({
  target: null,
  ceiling: null,
  hardCap: null,
  held: false,
  running: null,
  queued: null,
  quotaRemaining: null,
  ...over,
});

const resource = (id: string, over: Partial<Omit<FleetResource, "id">> = {}): FleetResource => ({
  id,
  declared: false,
  roles: DEFAULT_RESOURCE_ROLES,
  capabilities: [],
  tiers: null,
  quota: null,
  ...over,
});

const requirement = (over: Partial<JobRequirement> = {}): JobRequirement => ({
  role: "implementer",
  capabilities: [],
  tier: null,
  ...over,
});

describe("parseCapabilityDocument", () => {
  test("parses a minimal valid document", () => {
    const result = parseCapabilityDocument(
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        resources: {
          "codex-cmp": { roles: ["implementer", "reviewer"], capabilities: ["ci-watch"] },
          local: { roles: [], tiers: ["mid", "fast"] },
        },
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.error).toBeNull();
    const doc = result.document!;
    expect(doc.schema).toBe("fleet.capabilities.v1");
    expect(doc.dropped).toBe(0);
    expect(doc.resources.get("codex-cmp")).toEqual({
      roles: ["implementer", "reviewer"],
      capabilities: ["ci-watch"],
      tiers: null,
    });
    expect(doc.resources.get("local")).toEqual({
      roles: [],
      capabilities: [],
      tiers: ["mid", "fast"],
    });
  });

  test("rejects malformed JSON, non-objects and wrong schema", () => {
    for (const [text, error] of [
      ["not json", "not valid JSON"],
      ["[1,2]", "not a JSON object"],
      ['{"resources":{}}', 'expected schema "fleet.capabilities.v1"'],
      ['{"schema":"fleet.capabilities.v1","resources":[]} ', '"resources" must be an object'],
    ] as const) {
      const result = parseCapabilityDocument(text);
      expect(result.status).toBe("invalid");
      expect(result.document).toBeNull();
      expect(result.error).toBe(error);
    }
  });

  test("missing resources means an empty document", () => {
    const result = parseCapabilityDocument('{"schema":"fleet.capabilities.v1"}');
    expect(result.status).toBe("ok");
    expect(result.document!.resources.size).toBe(0);
  });

  test("drops invalid resource entries whole and counts them", () => {
    const result = parseCapabilityDocument(
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        resources: {
          good: { capabilities: ["local-inference"] },
          "bad role": { roles: ["implementer"] }, // invalid resource id
          typo: { roles: ["reviewr"] }, // unknown role
          badcap: { capabilities: ["Local Inference"] }, // invalid tag
          badtier: { tiers: ["FRONTIER"] }, // invalid tier
          wrongtype: { roles: "implementer" }, // roles not an array
          "": {}, // empty id
          "has space": {}, // invalid id
        },
      }),
    );
    expect(result.status).toBe("ok");
    const doc = result.document!;
    expect([...doc.resources.keys()]).toEqual(["good"]);
    expect(doc.dropped).toBe(7);
  });

  test("ignores unknown keys for forward compatibility", () => {
    const result = parseCapabilityDocument(
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        comment: "operator notes",
        resources: { a: { roles: ["planner"], note: "free text" } },
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.document!.resources.get("a")).toEqual({
      roles: ["planner"],
      capabilities: [],
      tiers: null,
    });
  });

  test("dedupes repeated tags and roles", () => {
    const result = parseCapabilityDocument(
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        resources: { a: { roles: ["reviewer", "reviewer"], capabilities: ["publish", "publish"] } },
      }),
    );
    expect(result.document!.resources.get("a")).toEqual({
      roles: ["reviewer"],
      capabilities: ["publish"],
      tiers: null,
    });
  });
});

describe("effectiveRoles / buildFleetResource", () => {
  test("undeclared resources default to implementer on all tiers", () => {
    const resource = buildFleetResource("any-lane", undefined, null);
    expect(resource.declared).toBe(false);
    expect(resource.roles).toEqual(["implementer"]);
    expect(resource.capabilities).toEqual([]);
    expect(resource.tiers).toBeNull();
    expect(resource.quota).toBeNull();
  });

  test("explicit empty roles serve nothing; absent roles keep the default", () => {
    const none: CapabilityDeclaration = { roles: [], capabilities: [], tiers: null };
    const partial: CapabilityDeclaration = { roles: null, capabilities: ["publish"], tiers: null };
    expect(effectiveRoles(none)).toEqual([]);
    expect(effectiveRoles(partial)).toEqual(["implementer"]);
    expect(buildFleetResource("r", none, null).roles).toEqual([]);
    expect(buildFleetResource("r", partial, null).capabilities).toEqual(["publish"]);
  });
});

describe("headroom", () => {
  test("capacity is the smallest known bound; headroom subtracts running", () => {
    expect(capacityBound(quota({ target: 10, ceiling: 32, hardCap: 8 }))).toBe(8);
    expect(capacityBound(quota({ ceiling: 4 }))).toBe(4);
    expect(capacityBound(quota())).toBeNull();
    expect(resourceHeadroom(quota({ target: 6, running: 4 }))).toBe(2);
    expect(resourceHeadroom(quota({ target: 6, running: 9 }))).toBe(0);
    expect(resourceHeadroom(quota({ running: 4 }))).toBeNull();
    expect(resourceHeadroom(null)).toBeNull();
  });
});

describe("matchRequirement", () => {
  const reviewerOnly = resource("reviewer-box", {
    declared: true,
    roles: ["reviewer"],
    capabilities: ["ci-watch"],
    tiers: ["work", "mid"],
    quota: quota({ target: 2, running: 1 }),
  });
  const general = resource("general-lane", { quota: quota({ target: 4, running: 4 }) });
  const local = resource("local-lane", {
    declared: true,
    roles: ["implementer", "planner"],
    capabilities: ["local-inference"],
    tiers: ["mid", "fast"],
    quota: quota({ target: 6, running: 0 }),
  });
  const held = resource("held-lane", { quota: quota({ target: 4, running: 0, held: true }) });
  const unknownQuota = resource("mystery", { declared: true, roles: ["implementer"] });
  const resources = [reviewerOnly, general, local, held, unknownQuota];

  test("implementer matches every undeclared-default lane with headroom or unknown quota", () => {
    const result = matchRequirement(requirement(), resources);
    // general is at capacity (running 4 >= target 4); held is held; reviewer-box lacks the role.
    expect(result.eligible).toEqual(["local-lane", "mystery"]);
    const byId = new Map(result.matches.map((m) => [m.id, m]));
    expect(byId.get("general-lane")).toMatchObject({
      eligible: false,
      reasons: ["at-capacity"],
      headroom: 0,
    });
    expect(byId.get("held-lane")!.reasons).toContain("held");
    expect(byId.get("reviewer-box")!.reasons).toContain("missing-role:implementer");
    expect(byId.get("mystery")).toMatchObject({ eligible: true, headroom: null });
  });

  test("reviewer role binds only to the declared reviewer resource", () => {
    const result = matchRequirement(requirement({ role: "reviewer" }), resources);
    expect(result.eligible).toEqual(["reviewer-box"]);
    expect(result.matches.find((m) => m.id === "local-lane")!.reasons).toContain(
      "missing-role:reviewer",
    );
  });

  test("capability requirements narrow eligibility independently of tier", () => {
    const result = matchRequirement(
      requirement({ capabilities: ["local-inference"], tier: "mid" }),
      resources,
    );
    expect(result.eligible).toEqual(["local-lane"]);
    const byId = new Map(result.matches.map((m) => [m.id, m]));
    // reviewer-box serves mid but lacks local-inference and the implementer role.
    expect(byId.get("reviewer-box")!.reasons).toEqual(
      expect.arrayContaining(["missing-role:implementer", "missing-capability:local-inference"]),
    );
    // mystery has unrestricted tiers, so only the capability tag blocks it.
    expect(byId.get("mystery")!.reasons).toEqual(["missing-capability:local-inference"]);
    // general-lane is also at capacity; held-lane is held.
    expect(byId.get("general-lane")!.reasons).toContain("at-capacity");
    expect(byId.get("held-lane")!.reasons).toContain("held");
  });

  test("tier check only applies when the resource restricts tiers", () => {
    const open = resource("open-lane", { quota: quota({ target: 4, running: 1 }) });
    const result = matchRequirement(requirement({ tier: "frontier" }), [open, local]);
    const byId = new Map(result.matches.map((m) => [m.id, m]));
    expect(byId.get("open-lane")!.eligible).toBe(true); // tiers null = unrestricted
    expect(byId.get("local-lane")!.reasons).toContain("tier-unsupported:frontier");
  });

  test("fleet HOLD and fleet hard cap block every resource", () => {
    const held = matchRequirement(requirement(), [general, local], { fleetHold: true });
    expect(held.eligible).toEqual([]);
    expect(held.matches.every((m) => m.reasons.includes("fleet-hold"))).toBe(true);

    const full = matchRequirement(requirement(), [general, local], {
      fleet: { running: 18, hardCap: 18 },
    });
    expect(full.eligible).toEqual([]);
    expect(full.matches.every((m) => m.reasons.includes("fleet-at-capacity"))).toBe(true);

    // Below the cap, or unknown running/hardCap, nothing fleet-level blocks.
    const open = matchRequirement(requirement(), [general, local], {
      fleet: { running: 3, hardCap: 18 },
    });
    expect(open.matches.some((m) => m.reasons.includes("fleet-at-capacity"))).toBe(false);
    const unknown = matchRequirement(requirement(), [general, local], {
      fleet: { running: null, hardCap: 18 },
    });
    expect(unknown.matches.some((m) => m.reasons.includes("fleet-at-capacity"))).toBe(false);
  });

  test("eligible ordering: headroom desc, unknown last, id tie-break; limit truncates", () => {
    const a = resource("b-lane", { quota: quota({ target: 5, running: 1 }) }); // headroom 4
    const b = resource("a-lane", { quota: quota({ target: 9, running: 1 }) }); // headroom 8
    const c = resource("c-lane"); // headroom null
    const result = matchRequirement(requirement(), [a, b, c]);
    expect(result.eligible).toEqual(["a-lane", "b-lane", "c-lane"]);
    const limited = matchRequirement(requirement(), [a, b, c], { limit: 2 });
    expect(limited.matches.map((m) => m.id)).toEqual(["a-lane", "b-lane"]);
    expect(limited.eligible).toEqual(["a-lane", "b-lane"]);
  });

  test("is provider-name agnostic: identical declarations match identically", () => {
    const decl: CapabilityDeclaration = {
      roles: ["implementer", "reviewer"],
      capabilities: ["publish"],
      tiers: null,
    };
    const one = buildFleetResource("devin", decl, quota({ target: 2, running: 0 }));
    const two = buildFleetResource("acme-runner-7", decl, quota({ target: 2, running: 0 }));
    const result = matchRequirement(requirement({ capabilities: ["publish"] }), [one, two]);
    expect(result.eligible).toEqual(["acme-runner-7", "devin"]);
  });
});

describe("parseModelMap / resolveModel", () => {
  test("parses flat lane[.tier] model entries and drops invalid ones", () => {
    const { map, dropped } = parseModelMap(
      JSON.stringify({
        "codex.work": "gpt-5.3-codex",
        devin: "swe-2-flash-max",
        "codex-local.mid": "qwen3-coder-next",
        "": "bad",
        "bad key": "x",
        num: 3,
      }),
    );
    expect(dropped).toBe(3);
    expect(map.get("codex.work")).toBe("gpt-5.3-codex");
    expect(map.get("devin")).toBe("swe-2-flash-max");
  });

  test("invalid JSON yields an empty map", () => {
    expect(parseModelMap("nope").map.size).toBe(0);
    expect(parseModelMap("nope").dropped).toBe(1);
    expect(parseModelMap("nope").status).toBe("invalid");
    expect(parseModelMap("[]").status).toBe("invalid");
    expect(parseModelMap("{}").status).toBe("ok");
  });

  test("resolveModel mirrors dispatchd precedence: lane.tier, lane, family.tier, family", () => {
    const { map } = parseModelMap(
      JSON.stringify({
        "codex-cmp.work": "cmp-work-model",
        "codex.work": "family-work-model",
        codex: "family-model",
        "codex-local": "local-model",
        devin: "devin-model",
      }),
    );
    // codex-cmp is a codex family member but keeps its own lane keys first.
    expect(resolveModel(map, "codex-cmp", "work")).toEqual({
      model: "cmp-work-model",
      via: "codex-cmp.work",
    });
    expect(resolveModel(map, "codex-cmp", "fast")).toEqual({
      model: "family-model",
      via: "codex",
    });
    // codex-local is its own family (dispatchd excludes it from the codex fold).
    expect(modelFamily("codex-local")).toBe("codex-local");
    expect(modelFamily("codex-cmp")).toBe("codex");
    expect(resolveModel(map, "codex-local", "mid")).toEqual({
      model: "local-model",
      via: "codex-local",
    });
    expect(resolveModel(map, "devin", null)).toEqual({ model: "devin-model", via: "devin" });
    expect(resolveModel(map, "ghost", "work")).toBeNull();
  });
});

test("vocabulary sanity", () => {
  expect(FLEET_ROLES).toEqual(["planner", "implementer", "reviewer", "release-verifier"]);
  expect(isFleetRole("implementer")).toBe(true);
  expect(isFleetRole(" Implementer ")).toBe(false);
});
