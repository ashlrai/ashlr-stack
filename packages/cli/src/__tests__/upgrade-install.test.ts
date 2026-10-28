import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type UpgradeRunner, installUpgrade } from "../lib/upgrade-install.ts";

let prefix: string;
let target: string;
let calls: string[][];
let failure: "none" | "install" | "stage" | "version" | "help" | "recovery";

async function packageAt(path: string, version: string) {
  await mkdir(join(path, "dist"), { recursive: true });
  await writeFile(join(path, "package.json"), JSON.stringify({ name: "@ashlr/stack", version }));
  await writeFile(join(path, "dist/index.js"), version);
}

const runner: UpgradeRunner = async (command, args) => {
  calls.push([command, ...args]);
  if (command === "npm") {
    if (args[0] === "root") return join(prefix, "lib/node_modules");
    if (args[0] === "prefix") return prefix;
    if (failure === "install") throw new Error("Installation failed");
    const stage = args[args.indexOf("--prefix") + 1];
    expect(args).toContain("--ignore-scripts");
    expect(args).toContain("@ashlr/stack@0.3.0");
    await packageAt(join(stage!, "lib/node_modules/@ashlr/stack"), "0.3.0");
    return "";
  }
  const entry = args[0]!;
  const version = await readFile(entry, "utf8");
  const active = entry === join(target, "dist/index.js");
  if (failure === "stage" && !active) throw new Error("Stage health failed");
  if (failure === "recovery" && calls.filter((c) => c[1] === "install").length > 0 && active) {
    throw new Error("Recovery check failed");
  }
  if (active && version === "0.3.0") {
    if (failure === "version") return JSON.stringify({ version: "0.2.0" });
    if (failure === "help" && args[1] === "--help") return "broken";
  }
  return args[1] === "--version" ? JSON.stringify({ version }) : "Commands: upgrade";
};

beforeEach(async () => {
  prefix = await mkdtemp(join(tmpdir(), "stack-upgrade-test-"));
  target = join(prefix, "lib/node_modules/@ashlr/stack");
  await packageAt(target, "0.2.0");
  await mkdir(join(prefix, "bin"));
  await symlink(join(target, "dist/index.js"), join(prefix, "bin/stack"));
  calls = [];
  failure = "none";
});
afterEach(async () => {
  await rm(prefix, { recursive: true, force: true });
});

async function expectClean(version: string) {
  expect(await readFile(join(prefix, "bin/stack"), "utf8")).toBe(version);
  expect(await readdir(join(prefix, "lib/node_modules/@ashlr"))).toEqual(["stack"]);
}

describe("npm global upgrade transaction", () => {
  test("installs, verifies the active release, and cleans backup and lock", async () => {
    expect(await installUpgrade("0.2.0", "0.3.0", runner)).toEqual({
      status: "upgraded",
      current: "0.2.0",
      latest: "0.3.0",
    });
    await expectClean("0.3.0");
    expect(calls.filter((c) => c[0] === "node")).toHaveLength(6);
  });
  for (const mode of ["version", "help"] as const) {
    test(`failed active ${mode} health check restores original files and launcher`, async () => {
      failure = mode;
      await expect(installUpgrade("0.2.0", "0.3.0", runner)).rejects.toThrow(
        "restored and verified",
      );
      await expectClean("0.2.0");
      expect(calls.filter((c) => c[1] === "install")).toHaveLength(1);
      expect(calls.at(-1)).toEqual(["node", join(target, "dist/index.js"), "--help"]);
    });
  }
  for (const mode of ["install", "stage"] as const) {
    test(`${mode} failure leaves the installed version untouched`, async () => {
      failure = mode;
      await expect(installUpgrade("0.2.0", "0.3.0", runner)).rejects.toThrow();
      await expectClean("0.2.0");
    });
  }
  test("a mismatched current install is rejected before installation", async () => {
    await expect(installUpgrade("0.1.0", "0.3.0", runner)).rejects.toThrow("identity");
    expect(calls.some((c) => c[1] === "install")).toBe(false);
    await expectClean("0.2.0");
  });
  test("an existing lock blocks concurrent upgrades without removing that lock", async () => {
    await mkdir(join(prefix, "lib/node_modules/@ashlr/.stack-upgrade-lock"));
    await expect(installUpgrade("0.2.0", "0.3.0", runner)).rejects.toThrow("lock");
    expect(await readdir(join(prefix, "lib/node_modules/@ashlr"))).toContain(".stack-upgrade-lock");
    expect(calls.some((c) => c[1] === "install")).toBe(false);
  });
  test("failed recovery verification retains recovery files and reports intervention", async () => {
    failure = "recovery";
    await expect(installUpgrade("0.2.0", "0.3.0", runner)).rejects.toThrow(
      "recovery needs attention",
    );
    expect(
      (await readdir(join(prefix, "lib/node_modules/@ashlr"))).some((p) =>
        p.startsWith(".stack-upgrade-"),
      ),
    ).toBe(true);
    expect(await readFile(join(target, "dist/index.js"), "utf8")).toBe("0.2.0");
  });
  test("invalid release inputs never run a subprocess", async () => {
    await expect(installUpgrade("0.2.0", "latest; echo unsafe", runner)).rejects.toThrow("stable");
    expect(calls).toEqual([]);
  });
});

for (const rollback of [false, true]) {
  test(`real subprocess health checks ${rollback ? "roll back" : "accept"} a staged fixture`, async () => {
    // Only npm is replaced. The production runner executes real CLI processes and
    // the real filesystem transaction, without network access or global writes.
    const cli = (version: string) => `
const active = process.argv[1] === ${JSON.stringify(join(target, "dist/index.js"))};
if (${rollback} && active && ${JSON.stringify(version)} === "0.3.0") process.exit(1);
console.log(process.argv.includes("--version")
  ? JSON.stringify({ version: ${JSON.stringify(version)} }) : "Commands: upgrade");
`;
    await writeFile(join(target, "dist/index.js"), cli("0.2.0"));
    const npm = join(prefix, "bin/npm");
    await writeFile(
      npm,
      `#!${Bun.which("node")}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "root") console.log(${JSON.stringify(join(prefix, "lib/node_modules"))});
else if (args[0] === "prefix") console.log(${JSON.stringify(prefix)});
else {
  const directory = path.join(args[args.indexOf("--prefix") + 1], "lib/node_modules/@ashlr/stack");
  fs.mkdirSync(path.join(directory, "dist"), { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "@ashlr/stack", version: "0.3.0" }));
  fs.writeFileSync(path.join(directory, "dist/index.js"), ${JSON.stringify(cli("0.3.0"))});
}
`,
      { mode: 0o755 },
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${join(prefix, "bin")}:${originalPath}`;
    try {
      if (rollback) {
        await expect(installUpgrade("0.2.0", "0.3.0")).rejects.toThrow("restored and verified");
      } else {
        expect((await installUpgrade("0.2.0", "0.3.0")).status).toBe("upgraded");
      }
      const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
      expect(manifest.version).toBe(rollback ? "0.2.0" : "0.3.0");
      expect(await readdir(join(prefix, "lib/node_modules/@ashlr"))).toEqual(["stack"]);
    } finally {
      process.env.PATH = originalPath;
    }
  });
}
