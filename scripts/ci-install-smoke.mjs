import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export function compileTarget(platform, arch) {
  const cpu = arch === "arm64" || arch === "aarch64" ? "arm64" : arch === "x64" || arch === "x86_64" ? "x64" : "";
  if (!cpu) return "";
  if (platform === "linux") return `bun-linux-${cpu}`;
  if (platform === "darwin") return `bun-darwin-${cpu}`;
  if (platform === "win32") return `bun-windows-${cpu}`;
  return "";
}

export function parseSha256Line(text) {
  const field = text.trim().split(/\s+/)[0] ?? "";
  return /^[a-fA-F0-9]{64}$/.test(field) ? field.toLowerCase() : "";
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function releaseAsset(platform, arch) {
  const target = compileTarget(platform, arch);
  return target ? target.replace(/^bun-/, "stack-") : "";
}

export function commitInstallPath(platform, home) {
  if (platform === "win32") return join(home, ".local", "bin", "stack.exe");
  return join(home, ".ashlr", "bin", "stack");
}

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function withPath(dirs) {
  const key = process.platform === "win32" ? "Path" : "PATH";
  const current = process.env[key] ?? process.env.PATH ?? "";
  const path = [...dirs, current].filter(Boolean).join(delimiter);
  return { ...process.env, PATH: path, Path: path };
}

function assertProviders(env) {
  run("stack", ["providers", "--json"], env);
}

function curlTo(url, dest) {
  return spawnSync(
    "curl",
    ["--proto", "=https", "--tlsv1.2", "--fail", "--location", "--silent", "--show-error", "--output", dest, url],
    { stdio: "inherit" },
  );
}

function installVerifiedRelease(home) {
  const asset = releaseAsset(process.platform, process.arch);
  if (!asset) {
    console.error(`::error::no release asset for ${process.platform}/${process.arch}`);
    process.exit(1);
  }
  const base = `https://github.com/ashlrai/ashlr-stack/releases/latest/download/${asset}`;
  const dir = mkdtempSync(join(tmpdir(), "stack-release-"));
  const shaPath = join(dir, "asset.sha256");
  const binPath = join(dir, "asset.bin");
  try {
    const sha = curlTo(`${base}.sha256`, shaPath);
    if (sha.status !== 0) {
      console.error("::error::release checksum is missing; refusing to download the binary");
      process.exit(1);
    }
    const expected = parseSha256Line(readFileSync(shaPath, "utf8"));
    if (!expected) {
      console.error("::error::release checksum is not a sha256; refusing to download the binary");
      process.exit(1);
    }
    const bin = curlTo(base, binPath);
    if (bin.status !== 0) {
      console.error("::error::release binary download failed");
      process.exit(1);
    }
    const actual = sha256Bytes(readFileSync(binPath));
    if (actual !== expected) {
      console.error("::error::release checksum mismatch; refusing to run the binary");
      process.exit(1);
    }
    const outfile = commitInstallPath(process.platform, home);
    mkdirSync(dirname(outfile), { recursive: true });
    copyFileSync(binPath, outfile);
    if (process.platform !== "win32") chmodSync(outfile, 0o755);
    assertProviders(withPath([dirname(outfile)]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
const mode = process.argv[2];
const home = homedir();
if (mode === "commit") {
  const target = compileTarget(process.platform, process.arch);
  if (!target) {
    console.error(`::error::no compile target for ${process.platform}/${process.arch}`);
    process.exit(1);
  }
  const outfile = commitInstallPath(process.platform, home);
  mkdirSync(dirname(outfile), { recursive: true });
  run("bun", ["build", "packages/cli/src/index.ts", "--compile", `--target=${target}`, `--outfile=${outfile}`]);
  if (process.platform !== "win32") chmodSync(outfile, 0o755);
  assertProviders(withPath([dirname(outfile)]));
} else if (mode === "release") {
  installVerifiedRelease(home);
} else {
  console.error("::error::usage: ci-install-smoke.mjs commit|release");
  process.exit(1);
}
}

if (process.argv[1]?.endsWith("ci-install-smoke.mjs")) main();
