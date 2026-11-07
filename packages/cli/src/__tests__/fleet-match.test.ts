import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetMatch, deriveFleetRequirement } from "../commands/fleet-match.ts";

/** Fixture layout mirrors the live runs dir: <root>/queue/* state, <root>/{capabilities,models}.json. */
async function fixture(run: (root: string, queue: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "fleet-match-"));
  const queue = join(root, "queue");
  try {
    await mkdir(queue, { recursive: true });
    await writeFile(join(queue, "queue.jsonl"), "[]");
    await writeFile(join(queue, "jobs.jsonl"), "[]");
    await run(root, queue);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const slots = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    hard_cap: 18,
    "codex-cmp": { target: 4, ceiling: 8, hard_cap: 8 },
    devin: { target: 2, ceiling: 4, hard_cap: 4, held: false },
    "codex-local": { target: 1, ceiling: 2, hard_cap: 2 },
    ...over,
  });

test("matrix mode lists every resource with quota, declarations and resolved model", () =>
  fixture(async (root, queue) => {
    await writeFile(join(queue, "slots.json"), slots());
    await writeFile(
      join(root, "capabilities.json"),
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        resources: {
          devin: { roles: ["implementer", "reviewer"], capabilities: ["publish"] },
          "codex-local": { capabilities: ["local-inference"], tiers: ["mid", "fast"] },
        },
      }),
    );
    await writeFile(
      join(root, "models.json"),
      JSON.stringify({
        "codex.work": "codex-work-model",
        codex: "codex-base-model",
        devin: "devin-model",
      }),
    );
    await writeFile(
      join(queue, "jobs.jsonl"),
      [
        { id: "j1", pool: "devin", status: "running" },
        { id: "j2", pool: "devin", status: "queued" },
        { id: "j3", pool: "devin", status: "done" },
        { id: "j4", pool: "ghost-pool", status: "running" },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );

    const report = await collectFleetMatch(queue);
    expect(report.schemaVersion).toBe(1);
    expect(report.requirement).toBeNull();
    expect(report.eligible).toBeNull();
    expect(report.sources).toMatchObject({
      slots: "ok",
      queue: "ok",
      jobs: "ok",
      capabilities: "ok",
      capabilitiesDropped: 0,
      models: "ok",
      hold: "absent",
      ready: "missing",
    });
    expect(report.fleet).toEqual({ running: 2, hardCap: 18, hold: false });

    const byId = new Map(report.resources.map((r) => [r.id, r]));
    // Journal-only pools join the matrix with unknown quota.
    expect([...byId.keys()]).toEqual(["codex-cmp", "codex-local", "devin", "ghost-pool"]);
    expect(byId.get("devin")).toMatchObject({
      declared: true,
      roles: ["implementer", "reviewer"],
      capabilities: ["publish"],
      quota: { target: 2, ceiling: 4, hardCap: 4, held: false, running: 1, queued: 1, headroom: 1 },
      model: "devin-model",
      modelVia: "devin",
      match: null,
    });
    expect(byId.get("codex-local")).toMatchObject({
      declared: true,
      capabilities: ["local-inference"],
      tiers: ["mid", "fast"],
      quota: { target: 1, running: 0, headroom: 1 },
    });
    expect(byId.get("codex-cmp")).toMatchObject({
      declared: false,
      roles: ["implementer"],
      quota: { target: 4, running: 0, headroom: 4 },
      model: "codex-base-model",
      modelVia: "codex",
    });
    expect(byId.get("ghost-pool")).toMatchObject({ declared: false, quota: null, model: null });

    // A tier requirement resolves tier-specific model entries (codex.work).
    const tiered = await collectFleetMatch(queue, { tier: "work" });
    expect(tiered.requirement).toEqual({ role: "implementer", capabilities: [], tier: "work" });
    expect(tiered.resources.find((r) => r.id === "codex-cmp")).toMatchObject({
      model: "codex-work-model",
      modelVia: "codex.work",
    });
  }));

test("role matching binds by capability, never by lane name", () =>
  fixture(async (root, queue) => {
    await writeFile(join(queue, "slots.json"), slots());
    await writeFile(
      join(root, "capabilities.json"),
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        resources: {
          devin: { roles: ["implementer", "reviewer"] },
          "codex-local": { roles: ["reviewer"], tiers: ["mid"] },
        },
      }),
    );
    await writeFile(join(queue, "jobs.jsonl"), "[]");

    const reviewer = await collectFleetMatch(queue, { role: "reviewer" });
    // devin (headroom 2) and codex-local (headroom 1) both declare reviewer.
    expect(reviewer.eligible).toEqual(["devin", "codex-local"]);
    const byId = new Map(reviewer.resources.map((r) => [r.id, r]));
    expect(byId.get("codex-cmp")!.match).toMatchObject({
      eligible: false,
      reasons: ["missing-role:reviewer"],
    });

    const implementer = await collectFleetMatch(queue, { role: "implementer", tier: "mid" });
    // codex-local lost implementer (roles: [reviewer]) and codex-cmp/devin are unrestricted on tier.
    expect(implementer.eligible).toEqual(["codex-cmp", "devin"]);
    expect(implementer.resources.find((r) => r.id === "codex-local")!.match!.reasons).toContain(
      "missing-role:implementer",
    );
  }));

test("--job derives role/tier/capabilities from journals and ready.tsv", () =>
  fixture(async (root, queue) => {
    await writeFile(join(queue, "slots.json"), slots());
    await writeFile(
      join(root, "capabilities.json"),
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        resources: {
          "codex-local": { roles: ["planner"], capabilities: ["local-inference"], tiers: ["mid"] },
        },
      }),
    );
    await writeFile(
      join(queue, "jobs.jsonl"),
      JSON.stringify({
        id: "RQ-PLAN-1",
        pool: "codex-local",
        status: "queued",
        role: "planner",
        capabilities: ["local-inference"],
      }),
    );
    await writeFile(
      join(queue, "ready.tsv"),
      "RQ-PLAN-1\tashlr-stack\tcodex-local\tmid\tqueue/prompts/x.md\n",
    );

    const report = await collectFleetMatch(queue, { job: "RQ-PLAN-1" });
    expect(report.job).toMatchObject({
      id: "RQ-PLAN-1",
      found: true,
      proposedResource: "codex-local",
    });
    expect(report.requirement).toEqual({
      role: "planner",
      capabilities: ["local-inference"],
      tier: "mid",
    });
    expect(report.eligible).toEqual(["codex-local"]);
    // Model resolution used the derived tier.
    const local = report.resources.find((r) => r.id === "codex-local")!;
    expect(local.match).toMatchObject({ eligible: true });

    // Explicit flags override the derived fields.
    const overridden = await collectFleetMatch(queue, { job: "RQ-PLAN-1", role: "implementer" });
    expect(overridden.requirement).toMatchObject({ role: "implementer", tier: "mid" });
  }));

test("a job with an unknown role reports an error instead of coercing", () =>
  fixture(async (root, queue) => {
    await writeFile(join(queue, "slots.json"), slots());
    await writeFile(
      join(queue, "jobs.jsonl"),
      JSON.stringify({ id: "RQ-X", pool: "devin", status: "queued", role: "janitor" }),
    );
    const report = await collectFleetMatch(queue, { job: "RQ-X" });
    expect(report.requirement).toBeNull();
    expect(report.requirementError).toContain("janitor");
    expect(report.eligible).toBeNull();
    expect(report.job).toMatchObject({ id: "RQ-X", found: true, proposedResource: "devin" });
  }));

test("unknown job id yields no requirement but still reports the matrix", () =>
  fixture(async (_root, queue) => {
    await writeFile(join(queue, "slots.json"), slots());
    const report = await collectFleetMatch(queue, { job: "RQ-MISSING" });
    expect(report.job).toMatchObject({ id: "RQ-MISSING", found: false, proposedResource: null });
    expect(report.requirement).toBeNull();
    expect(report.requirementError).toBeNull();
    expect(report.resources.length).toBeGreaterThan(0);
  }));

test("HOLD file and fleet hard cap block every resource", () =>
  fixture(async (root, queue) => {
    await writeFile(join(queue, "slots.json"), slots({ hard_cap: 1 }));
    await writeFile(
      join(queue, "jobs.jsonl"),
      JSON.stringify({ id: "a", pool: "devin", status: "running" }),
    );
    const full = await collectFleetMatch(queue, { role: "implementer" });
    expect(full.fleet).toMatchObject({ running: 1, hardCap: 1 });
    expect(full.eligible).toEqual([]);
    expect(full.resources.every((r) => r.match!.reasons.includes("fleet-at-capacity"))).toBe(true);

    await writeFile(join(queue, "HOLD"), "devin\n");
    const held = await collectFleetMatch(queue, { role: "implementer" });
    expect(held.fleet.hold).toBe(true);
    expect(held.eligible).toEqual([]);
    expect(held.resources.every((r) => r.match!.reasons.includes("fleet-hold"))).toBe(true);
    expect(held.sources.hold).toBe("present");
  }));

test("missing and invalid sources stay unknown; invalid capabilities fall back to defaults", () =>
  fixture(async (root, queue) => {
    // No slots.json, no journals content beyond empty arrays, no capabilities/models.
    const empty = await collectFleetMatch(queue);
    expect(empty.sources).toMatchObject({
      slots: "missing",
      capabilities: "missing",
      models: "missing",
      hold: "absent",
    });
    expect(empty.resources).toEqual([]);
    expect(empty.fleet).toEqual({ running: 0, hardCap: null, hold: false });

    await writeFile(join(queue, "slots.json"), '{"devin":{"target":2}}');
    await writeFile(join(root, "capabilities.json"), "{not json");
    await writeFile(join(root, "models.json"), "{also not json");
    await writeFile(
      join(queue, "jobs.jsonl"),
      `broken line\n${JSON.stringify({ id: "j", pool: "devin", status: "running" })}`,
    );
    const degraded = await collectFleetMatch(queue, { role: "implementer" });
    expect(degraded.sources.capabilities).toBe("invalid");
    expect(degraded.sources.models).toBe("invalid");
    expect(degraded.sources.jobs).toBe("invalid");
    // Journals unreadable → running/queued unknown → headroom null, still eligible on capability.
    const devin = degraded.resources.find((r) => r.id === "devin")!;
    expect(devin.quota).toMatchObject({ target: 2, running: null, headroom: null });
    expect(devin.match).toMatchObject({ eligible: true, headroom: null });
    expect(degraded.eligible).toEqual(["devin"]);
  }));

test("deriveFleetRequirement: flags win, job fills gaps, implementer is the default", () => {
  const jobRow = { id: "J", pool: "p", role: "reviewer", tier: "work", capabilities: ["publish"] };
  expect(
    deriveFleetRequirement({ role: "planner" }, "J", jobRow, { lane: "p", tier: "mid" }),
  ).toMatchObject({
    requirement: { role: "planner", capabilities: ["publish"], tier: "work" },
    error: null,
  });
  expect(
    deriveFleetRequirement({}, "J", undefined, { lane: "lane-x", tier: "fast" }),
  ).toMatchObject({
    requirement: { role: "implementer", capabilities: [], tier: "fast" },
    job: { found: true, proposedResource: "lane-x" },
  });
  expect(deriveFleetRequirement({}, undefined, undefined, null)).toMatchObject({
    requirement: null,
    job: null,
  });
  expect(deriveFleetRequirement({}, "J", undefined, null)).toMatchObject({
    requirement: null,
    job: { found: false },
  });
});

test("CLI --json emits the collect report and rejects invalid flags", () =>
  fixture(async (root, queue) => {
    await writeFile(join(queue, "slots.json"), slots());
    const spawn = (args: string[]) =>
      Bun.spawn([process.execPath, "run", "packages/cli/src/index.ts", "fleet-match", ...args], {
        env: {
          HOME: root,
          PATH: process.env.PATH ?? "",
          STACK_NO_UPDATE_CHECK: "1",
          STACK_TELEMETRY: "0",
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

    const ok = spawn(["--queue", queue, "--role", "reviewer", "--json"]);
    const out = await new Response(ok.stdout).text();
    expect(await ok.exited).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.requirement).toEqual({ role: "reviewer", capabilities: [], tier: null });
    expect(parsed.resources.length).toBeGreaterThan(0);

    // Dashed file flags resolve through citty's camelCased arg names.
    const capsFile = join(root, "elsewhere-caps.json");
    await writeFile(
      capsFile,
      JSON.stringify({
        schema: "fleet.capabilities.v1",
        resources: { devin: { roles: ["reviewer"] } },
      }),
    );
    const overridden = spawn([
      "--queue",
      queue,
      "--role",
      "reviewer",
      "--capabilities-file",
      capsFile,
      "--json",
    ]);
    const overOut = JSON.parse(await new Response(overridden.stdout).text());
    expect(await overridden.exited).toBe(0);
    expect(overOut.sources.capabilities).toBe("ok");
    expect(overOut.eligible).toEqual(["devin"]);

    const bad = spawn(["--queue", queue, "--role", "janitor", "--json"]);
    expect(await bad.exited).not.toBe(0);
    await new Response(bad.stderr).text();
  }));
