import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");

// Pack with lifecycle scripts disabled in isolated copies: this qualifies the
// shipped README and manifest, not the executable or a registry publication.
test("current and simulated future npm archives carry neutral, runtime-consistent READMEs", () => {
  const dir = mkdtempSync(join(tmpdir(), "stack-readme-pack-"));
  try {
    const home = join(dir, "home");
    const cache = join(dir, "cache");
    mkdirSync(home);
    mkdirSync(cache);
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      npm_config_cache: cache,
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
    };
    for (const sourceVersion of ["current", "future"]) {
      for (const pkg of ["cli", "mcp"]) {
        const copy = join(dir, sourceVersion, pkg);
        const output = join(dir, sourceVersion, `${pkg}-pack`);
        mkdirSync(output, { recursive: true });
        cpSync(join(root, "packages", pkg), copy, {
          recursive: true,
          filter: (path) =>
            !path.split(sep).some((part) => part === "node_modules" || part === "dist"),
        });
        const manifestPath = join(copy, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (sourceVersion === "future") {
          const parts = String(manifest.version).match(/^(\d+)\.(\d+)\.(\d+)$/);
          if (!parts) throw new Error(`Expected a stable semver, got ${manifest.version}`);
          manifest.version = `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
          writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        }
        const packed = spawnSync(
          "npm",
          ["pack", "--ignore-scripts", "--pack-destination", output, "--json"],
          {
            cwd: copy,
            encoding: "utf8",
            env,
            timeout: 60000,
          },
        );
        expect(packed.status, packed.stderr).toBe(0);
        const [{ filename }] = JSON.parse(packed.stdout);
        const archive = join(output, filename);
        const extract = (path: string) => {
          const result = spawnSync("tar", ["-xOzf", archive, path], {
            encoding: "utf8",
            env,
            timeout: 10000,
          });
          expect(result.status, result.stderr).toBe(0);
          return result.stdout;
        };
        const readme = extract("package/README.md");
        const packaged = JSON.parse(extract("package/package.json"));
        expect(packaged.version).toBe(manifest.version);
        expect(packaged.engines.node).toBe(">=20");
        expect(packaged.scripts.build).toContain("--target node");
        expect(packaged.scripts.build).toContain("#!/usr/bin/env node");
        expect(readme).toContain("Node.js >= 20");
        expect(readme).toContain(
          pkg === "cli"
            ? "npm i -g @ashlr/stack ashlr-stack-mcp"
            : "npm i -g ashlr-stack-mcp @ashlr/stack",
        );
        expect(readme).not.toMatch(/(?:@ashlr\/stack|ashlr-stack-mcp)@\d+\.\d+\.\d+/);
        expect(readme).not.toMatch(/(?:published|public) 0\.(?:1\.1|3\.0)/i);
        expect(readme).not.toMatch(/(?:published|public).{0,60}(?:requires?|needs?).{0,30}Bun/i);
        expect(readme).not.toMatch(
          /\b(?:this source checkout|current source interface|release candidate|not yet published)\b/i,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
