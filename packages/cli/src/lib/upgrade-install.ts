import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PACKAGE = "@ashlr/stack";
export type UpgradeRunner = (command: string, args: string[]) => Promise<string>;

// Never forward subprocess output: npm diagnostics can contain credentials.
const run: UpgradeRunner = async (command, args) => {
  try {
    const result = await exec(command, args, {
      timeout: command === "npm" ? 120_000 : 15_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, STACK_NO_UPDATE_CHECK: "1" },
    });
    return result.stdout.trim();
  } catch {
    throw new Error(`${command === "npm" ? "npm" : "CLI health check"} failed or timed out.`);
  }
};

export function isReleaseVersion(version: unknown): version is string {
  return typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

async function health(directory: string, version: string, runner: UpgradeRunner): Promise<void> {
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (manifest.name !== PACKAGE || manifest.version !== version) {
    throw new Error("Installed package identity does not match the requested release.");
  }
  const entry = join(directory, "dist/index.js");
  const output = JSON.parse(await runner("node", [entry, "--version", "--json"]));
  if (output.version !== version) throw new Error("CLI version health check failed.");
  const help = await runner("node", [entry, "--help"]);
  if (!help.includes("upgrade")) throw new Error("CLI help health check failed.");
}

/** Stage in the same filesystem and retain the original directory until health passes. */
export async function installUpgrade(
  current: string,
  latest: string,
  runner: UpgradeRunner = run,
): Promise<{ status: "upgraded"; current: string; latest: string }> {
  if (!isReleaseVersion(current) || !isReleaseVersion(latest)) {
    throw new Error("Upgrade requires stable release versions.");
  }
  if (process.platform === "win32")
    throw new Error("Applying upgrades requires a Unix npm install.");
  const root = await runner("npm", ["root", "--global"]);
  if (!root.startsWith("/")) throw new Error("npm did not return an absolute global root.");
  const target = join(root, PACKAGE);
  if (!(await lstat(target)).isDirectory()) {
    throw new Error("Applying upgrades requires an npm global install, not a linked package.");
  }
  const prefix = await runner("npm", ["prefix", "--global"]);
  if (!prefix.startsWith("/")) throw new Error("npm did not return an absolute global prefix.");
  if (
    (await realpath(join(prefix, "bin/stack"))) !== join(await realpath(target), "dist/index.js")
  ) {
    throw new Error("The npm stack launcher does not point to this installation.");
  }
  const lock = join(dirname(target), ".stack-upgrade-lock");
  try {
    await mkdir(lock);
  } catch {
    throw new Error(
      `Cannot acquire upgrade lock at ${lock}. Check permissions or an active upgrade.`,
    );
  }
  let workspace: string | undefined;
  let retainBackup = false;
  try {
    await health(target, current, runner);
    workspace = await mkdtemp(join(dirname(target), ".stack-upgrade-"));
    await runner("npm", [
      "install",
      "--global",
      "--prefix",
      workspace,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${PACKAGE}@${latest}`,
    ]);
    const candidate = join(workspace, "lib/node_modules", PACKAGE);
    await health(candidate, latest, runner);
    const backup = join(workspace, "previous");
    await rename(target, backup);
    try {
      await rename(candidate, target);
      await health(target, latest, runner);
    } catch {
      try {
        await rm(target, { recursive: true, force: true });
        await rename(backup, target);
        await health(target, current, runner);
      } catch {
        retainBackup = true;
        throw new Error(
          `Upgrade failed and recovery needs attention. Retained recovery files at ${workspace}.`,
        );
      }
      throw new Error(
        "Upgrade failed its health check; the previous version was restored and verified.",
      );
    }
    return { status: "upgraded", current, latest };
  } finally {
    if (workspace && !retainBackup) await rm(workspace, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
