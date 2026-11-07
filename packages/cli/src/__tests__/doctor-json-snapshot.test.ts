import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HANDSHAKE_CONTRACT } from "../lib/ecosystem.ts";
import { checkDoctor } from "../lib/handshake-conformance.ts";

const entry = join(import.meta.dir, "..", "index.ts");
let home: string;
let bin: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "stack-doctor-snapshot-")));
  bin = join(home, "bin");
  mkdirSync(bin);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

// Absolute interpreter and an exclusive PATH keep real companions out of the run.
function companion(command: string, body: string) {
  writeFileSync(join(bin, command), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
}

function phantom() {
  companion(
    "phantom",
    `const args = process.argv.slice(2);
if (args[0] === "--version") console.log("phantom 0.7.9");
else if (args[0] === "list") console.log("[]");
else process.exit(1);`,
  );
}

function project(service = "") {
  writeFileSync(
    join(home, ".stack.toml"),
    `[stack]\nversion = "1"\n${service ? `\n[services.${service}]\nprovider = "${service}"\nsecrets = []\n` : ""}`,
  );
  writeFileSync(join(home, ".stack.local.toml"), '[stack]\nproject_id = "stk_snapshot"\n');
}

function doctor(args: string[], code: number, json = true) {
  const result = Bun.spawnSync([process.execPath, entry, "doctor", ...args], {
    cwd: home,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    env: {
      HOME: home,
      PATH: bin,
      STACK_REGISTRY_DIR: join(home, "registry"),
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
      NO_COLOR: "1",
      CI: "1",
    },
  });
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode, result.stderr.toString()).toBe(code);
  expect(result.stderr.toString()).toBe("");
  // Only the scratch project path varies. Preserve every output field and value.
  const output = result.stdout.toString().replaceAll(home, "<project>");
  if (!json) return output;
  const parsed: unknown = JSON.parse(output);
  expect(checkDoctor(parsed, HANDSHAKE_CONTRACT)).toEqual([]);
  return parsed;
}

function ecosystem() {
  const handshake = {
    kind: "ashlr.handshake",
    schema_version: 1,
    name: "locus",
    command: "locus",
    version: "0.5.2",
    protocols: { "ashlr.handshake": 1 },
    capabilities: ["doctor-json", "doctor-fix"],
    health: { status: "degraded", checks: [] },
    edits: ["~/.locus/"],
    receipts: [],
  };
  const answer = (value: unknown) =>
    `if (JSON.stringify(process.argv.slice(2)) !== '["--ashlr-handshake","--json"]') process.exit(2);
console.log(${JSON.stringify(JSON.stringify(value))});`;
  companion("locus", answer(handshake));
  companion(
    "phm",
    answer({
      ...handshake,
      name: "phantom",
      command: "phm",
      health: { status: "ok", checks: [] },
      edits: [],
    }),
  );
  companion("lexicon", answer({ kind: "ashlr.handshake", schema_version: 1, version: "0.1.0" }));
  companion("phantom", 'console.log("unknown option --ashlr-handshake"); process.exitCode = 1;');
}

describe("doctor CLI output snapshots", () => {
  test("--json without a project", () => {
    expect(doctor(["--json"], 1)).toMatchSnapshot();
  });

  test("--json without Phantom", () => {
    project();
    expect(doctor(["--json"], 1)).toMatchSnapshot();
  });

  test("--json with no services", () => {
    project();
    phantom();
    expect(doctor(["--json"], 0)).toMatchSnapshot();
  });

  test("--json with a failing service", () => {
    project("unregistered");
    phantom();
    expect(doctor(["--json"], 1)).toMatchSnapshot();
  });

  test("--ecosystem --json with healthy, degraded, drifting, old and missing companions", () => {
    ecosystem();
    expect(doctor(["--ecosystem", "--json"], 0)).toMatchSnapshot();
  });

  test("--ecosystem human output with the same fake companions", () => {
    ecosystem();
    expect(doctor(["--ecosystem"], 0, false)).toMatchSnapshot();
  });
});
