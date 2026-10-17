#!/usr/bin/env node
// Release preflight: packs the three npm packages exactly as scripts/publish.sh
// would ship them, installs the tarballs together into an empty project under
// plain Node, and drives the installed bins through the surface Phantom relies
// on. Catches a release that would fail or ship broken before anything is
// tagged. Read-only for the registry: it never publishes and needs no token.
//
// Run after building the dist bundles:
//   bun run --cwd packages/cli build && bun run --cwd packages/mcp build
//   node scripts/release-preflight.mjs

import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// The MCP protocol versions Phantom's companion smoke negotiates.
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
// Tools Phantom requires from ashlr-stack-mcp.
const REQUIRED_TOOLS = ["stack_status", "stack_list"];
const STACK_TOML = `[stack]\nversion = "1"\n\n[[environments]]\nname = "dev"\ndefault = true\n\n[services.supabase]\nprovider = "supabase"\nsecrets = ["SUPABASE_URL", "SUPABASE_ANON_KEY"]\nmcp = "supabase"\n\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n`;

let failed = 0;
function ok(msg) {
  console.log(`ok: ${msg}`);
}
function bad(msg) {
  console.error(`FAIL: ${msg}`);
  failed++;
}
function must(cond, pass, failure) {
  if (cond) ok(pass);
  else bad(failure);
  return cond;
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) throw r.error;
  return r;
}

// The publish order is the one scripts/publish.sh uses, so the check cannot drift from it.
const publishSh = readFileSync(join(root, "scripts/publish.sh"), "utf8");
const order = [...(publishSh.match(/PKG_ORDER=\(\n([\s\S]*?)\n\)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
  (m) => m[1],
);
if (order.length === 0) throw new Error("could not read PKG_ORDER from scripts/publish.sh");
const manifests = order.map((dir) => ({
  dir,
  pkg: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")),
}));
const version = manifests[0].pkg.version;
const names = new Set(manifests.map((m) => m.pkg.name));

// 1. One version everywhere the release validator reads it.
must(
  manifests.every((m) => m.pkg.version === version),
  `${order.length} packages at ${version}`,
  `package versions differ: ${manifests.map((m) => `${m.pkg.name}@${m.pkg.version}`).join(", ")}`,
);
const descriptor = JSON.parse(readFileSync(join(root, "packages/mcp/server.json"), "utf8"));
must(
  descriptor.version === version && descriptor.packages?.every((p) => p.version === version),
  "packages/mcp/server.json matches",
  `packages/mcp/server.json is ${descriptor.version}, packages are ${version}`,
);
const cliVersion = readFileSync(join(root, "packages/cli/src/index.ts"), "utf8").match(
  /^const VERSION = ["']([^"']+)["'];$/m,
)?.[1];
must(cliVersion === version, "CLI VERSION constant matches", `CLI VERSION is ${cliVersion}, packages are ${version}`);

// 2. Every in-repo dependency is published before the package that needs it.
for (const [i, { pkg }] of manifests.entries()) {
  const earlier = new Set(manifests.slice(0, i).map((m) => m.pkg.name));
  for (const dep of Object.keys(pkg.dependencies ?? {}).filter((d) => names.has(d))) {
    must(
      earlier.has(dep),
      `${pkg.name} publishes after ${dep}`,
      `${pkg.name} depends on ${dep}, which publish.sh publishes later`,
    );
  }
}

// 3. Pack each package with workspace:* rewritten the way publish.sh does it.
const work = mkdtempSync(join(tmpdir(), "stack-release-preflight-"));
const tarballs = [];
try {
  for (const { dir, pkg } of manifests) {
    const manifestPath = join(root, dir, "package.json");
    const original = readFileSync(manifestPath, "utf8");
    const rewritten = JSON.parse(original);
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(rewritten[field] ?? {})) {
        if (typeof range === "string" && range.startsWith("workspace:")) rewritten[field][name] = `^${version}`;
      }
    }
    let packed;
    try {
      writeFileSync(manifestPath, `${JSON.stringify(rewritten, null, 2)}\n`);
      // Scripts off: the dist bundles are built beforehand, as release.yml does.
      packed = run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", work], {
        cwd: join(root, dir),
      });
    } finally {
      writeFileSync(manifestPath, original);
    }
    if (packed.status !== 0) {
      bad(`npm pack ${pkg.name}: ${packed.stderr.trim()}`);
      continue;
    }
    const [info] = JSON.parse(packed.stdout);
    const files = new Set(info.files.map((f) => f.path));
    const missing = ["package.json", "README.md", "LICENSE", ...Object.values(pkg.bin ?? {})]
      .map((f) => f.replace(/^\.\//, ""))
      .filter((f) => !files.has(f));
    must(
      missing.length === 0,
      `${info.id}: ${info.entryCount} files, ${(info.size / 1024).toFixed(0)} kB packed`,
      `${pkg.name} tarball is missing ${missing.join(", ")}`,
    );
    tarballs.push(join(work, info.filename));
  }
  if (failed) throw new Error("packing failed");

  // 4. Install the tarballs together, the way a user's `npm i -g` resolves them.
  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), '{"private":true}\n');
  const install = run(npm, ["install", "--no-audit", "--no-fund", "--ignore-scripts", ...tarballs], { cwd: app });
  if (!must(install.status === 0, "tarballs install together", `npm install: ${install.stderr.trim()}`))
    throw new Error("install failed");
  for (const { pkg } of manifests) {
    const installed = JSON.parse(readFileSync(join(app, "node_modules", pkg.name, "package.json"), "utf8"));
    const ranges = Object.entries(installed.dependencies ?? {}).filter(([, r]) => r.startsWith("workspace:"));
    must(
      installed.version === version && ranges.length === 0,
      `${pkg.name}@${installed.version} installed with registry ranges`,
      `${pkg.name} installed as ${installed.version} with ${ranges.map(([n]) => n).join(", ")} left as workspace:`,
    );
  }

  // 5. The installed bins, under Node, through the contract Phantom uses.
  const bin = (name) => join(app, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
  const home = join(work, "home");
  const project = join(work, "project");
  mkdirSync(home);
  mkdirSync(project);
  writeFileSync(join(project, ".stack.toml"), STACK_TOML);
  const env = { ...process.env, HOME: home, USERPROFILE: home, STACK_NO_TELEMETRY: "1" };
  delete env.STACK_BIN; // the MCP server must find the installed @ashlr/stack, not PATH
  const shell = process.platform === "win32";

  const ver = run(bin("stack"), ["--version"], { env, cwd: project, shell });
  must(ver.stdout.trim().endsWith(version), `stack --version prints ${version}`, `stack --version: ${ver.stdout}${ver.stderr}`);

  const status = run(bin("stack"), ["status", "--json"], { env, cwd: project, shell });
  let report = null;
  try {
    report = JSON.parse(status.stdout);
  } catch {}
  const services = Array.isArray(report?.services) ? report.services.map((s) => s?.name).sort() : [];
  must(
    status.status === 0 && report?.schema === "ashlr.stack.status/v1" && services.join(",") === "openai,supabase",
    `stack status --json: ${report?.schema} lists ${services.join(", ")}`,
    `stack status --json exit ${status.status}: ${(status.stdout || status.stderr).trim().slice(0, 300)}`,
  );

  for (const protocolVersion of PROTOCOL_VERSIONS) {
    const result = await handshake(bin("ashlr-stack-mcp"), { env, cwd: project, protocolVersion, shell });
    const missingTools = REQUIRED_TOOLS.filter((t) => !result.tools?.includes(t));
    must(
      !result.error && result.serverVersion === version && missingTools.length === 0,
      `ashlr-stack-mcp@${result.serverVersion} on ${protocolVersion}: ${result.tools?.length} tools`,
      `ashlr-stack-mcp on ${protocolVersion}: ${result.error ?? `version ${result.serverVersion}, missing ${missingTools.join(", ")}`}`,
    );
  }
} catch (err) {
  if (!failed) bad(String(err?.message ?? err));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed) {
  console.error(`release preflight: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("release preflight passed");

function handshake(path, { env, cwd, protocolVersion, shell }) {
  return new Promise((resolve) => {
    const child = spawn(path, [], { env, cwd, shell, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    let nextId = 0;
    const waiting = new Map();
    const done = (value) => {
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => done({ error: `timed out: ${stderr.trim().slice(-300)}` }), 20_000);
    child.on("error", (e) => done({ error: String(e) }));
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.stdout.on("data", (d) => {
      buf += d;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        waiting.get(msg.id)?.(msg);
      }
    });
    const request = (method, params = {}) =>
      new Promise((res) => {
        const id = ++nextId;
        waiting.set(id, res);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    (async () => {
      const init = await request("initialize", {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "stack-release-preflight", version: "1" },
      });
      if (init.error) return done({ error: JSON.stringify(init.error) });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      const list = await request("tools/list");
      done({
        serverVersion: init.result?.serverInfo?.version,
        tools: (list.result?.tools ?? []).map((t) => t.name),
      });
    })();
  });
}
