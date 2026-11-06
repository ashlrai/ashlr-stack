import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestFleetAction, validateFleetAction } from "../commands/fleet-act.ts";

const actions = [
  { verb: "pause", lane: "codex-personal" },
  { verb: "resume", lane: "codex-personal" },
  { verb: "kill", job: "RQ-123" },
  { verb: "reassign", job: "RQ-123", lane: "devin" },
  { verb: "slots", lane: "devin", slots: 0 },
  { verb: "steer", job: "RQ-123", message: "Run the focused tests." },
] as const;

test("each v1 verb previews without writes and appends an intact audit request on apply", async () => {
  const queue = await mkdtemp(join(tmpdir(), "fleet-act-"));
  try {
    const audit = join(queue, "fleet-act.audit.jsonl");
    for (const action of actions) {
      const preview = await requestFleetAction(action, { queue });
      expect(preview.status).toBe("dry-run");
      expect(preview.action).toEqual(action);
    }
    expect(await readdir(queue)).toEqual([]);
    const records = [];
    for (const action of actions) {
      const before = await readFile(audit, "utf8").catch(() => "");
      const record = await requestFleetAction(action, { queue, apply: true });
      records.push(record);
      expect(await readFile(audit, "utf8")).toBe(`${before}${JSON.stringify(record)}\n`);
      expect(record.status).toBe("requested");
      expect(record.schemaVersion).toBe(1);
      expect(Number.isNaN(Date.parse(record.requestedAt))).toBe(false);
    }
    expect(new Set(records.map((record) => record.requestId)).size).toBe(6);
    expect(
      (await readFile(audit, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(records);
    await expect(
      requestFleetAction(actions[0]!, { queue, apply: true, dryRun: true }),
    ).rejects.toThrow();
    await expect(requestFleetAction({ verb: "kill" }, { queue, apply: true })).rejects.toThrow();
    expect((await readFile(audit, "utf8")).trim().split("\n")).toHaveLength(6);
  } finally {
    await rm(queue, { recursive: true, force: true });
  }
});

for (const input of [
  { verb: "unknown" },
  { verb: "constructor" },
  { verb: "pause" },
  { verb: "resume", lane: "../escape" },
  { verb: "kill", job: "x\nforged" },
  { verb: "reassign", job: "RQ-123" },
  { verb: "slots", lane: "devin", slots: -1 },
  { verb: "slots", lane: "devin", slots: 1.5 },
  { verb: "slots", lane: "devin", slots: "2" },
  { verb: "slots", lane: "devin", slots: Number.POSITIVE_INFINITY },
  { verb: "slots", lane: "devin", slots: Number.MAX_SAFE_INTEGER + 1 },
  { verb: "steer", job: "RQ-123", message: " " },
  { verb: "steer", job: "RQ-123", message: "x".repeat(4097) },
  { verb: "steer", job: "RQ-123", message: "x\u0000" },
  { verb: "pause", lane: "devin", job: "RQ-123" },
])
  test(`reject invalid action ${JSON.stringify(input).slice(0, 140)}`, () => {
    expect(() => validateFleetAction(input)).toThrow();
  });

test("audit refuses symlinks without altering the target", async () => {
  const queue = await mkdtemp(join(tmpdir(), "fleet-act-link-"));
  try {
    const target = join(queue, "target");
    await symlink(target, join(queue, "fleet-act.audit.jsonl"));
    await expect(requestFleetAction(actions[0]!, { queue, apply: true })).rejects.toThrow();
    expect(await readdir(queue)).toEqual(["fleet-act.audit.jsonl"]);
  } finally {
    await rm(queue, { recursive: true, force: true });
  }
});

test("CLI exposes fleet-act and requires explicit apply", async () => {
  const queue = await mkdtemp(join(tmpdir(), "fleet-act-cli-"));
  try {
    for (const flags of [[], ["--apply"], ["--slots", "-1"], ["extra"]]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "run",
          "packages/cli/src/index.ts",
          "fleet-act",
          "pause",
          "--lane",
          "devin",
          "--queue",
          queue,
          "--json",
          ...flags,
        ],
        {
          env: { HOME: queue, PATH: process.env.PATH },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = await new Response(child.stdout).text();
      await new Response(child.stderr).text();
      expect(await child.exited).toBe(flags.length && flags[0] !== "--apply" ? 1 : 0);
      if (!flags.length || flags[0] === "--apply")
        expect(JSON.parse(output).status).toBe(flags.length ? "requested" : "dry-run");
    }
  } finally {
    await rm(queue, { recursive: true, force: true });
  }
});
