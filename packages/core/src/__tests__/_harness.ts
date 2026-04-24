import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetPhantomCache } from "../phantom.ts";

/**
 * Fake `phantom` binary for integration tests. Writes a bash script into a
 * tmpdir, prepends that tmpdir to PATH, and exposes helpers to inspect the
 * resulting "vault" (a JSON file) and the call log.
 *
 * Subset of the real Phantom CLI: add/remove/list/reveal/status/--version.
 * Enough for Stack's core paths; doesn't model cloud sync or the proxy.
 */

export interface Harness {
  dir: string;
  vaultPath: string;
  logPath: string;
  calls(): Array<{ cmd: string; args: string[] }>;
  callsTo(cmd: string): Array<{ cmd: string; args: string[] }>;
  cleanup(): void;
}

export function setupFakePhantom(initial: Record<string, string> = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "stack-phantom-"));
  const vaultPath = join(dir, "vault.json");
  const logPath = join(dir, "calls.log");

  // Also isolate the project registry so tests don't pollute ~/.stack/.
  const registryDir = mkdtempSync(join(tmpdir(), "stack-registry-"));
  const previousRegistryDir = process.env.STACK_REGISTRY_DIR;
  process.env.STACK_REGISTRY_DIR = registryDir;
  writeFileSync(vaultPath, JSON.stringify(initial));
  writeFileSync(logPath, "");

  // The vault/log paths are trusted (we created them), but ALL args ($1..$N)
  // come from tests that may contain user-shaped secret values with quotes,
  // newlines, backslashes, etc. Those must NEVER be interpolated into Python
  // source — instead we pass them via sys.argv so the shell + Python handle
  // quoting for us.
  const script = `#!/usr/bin/env bash
set -e
VAULT=${JSON.stringify(vaultPath)}
LOG=${JSON.stringify(logPath)}

# Log the invocation as a single JSON line (args passed via argv, never interpolated).
python3 -c 'import json,sys; open(sys.argv[1], "a").write(json.dumps({"cmd": sys.argv[2] if len(sys.argv) > 2 else "", "args": sys.argv[3:]}) + "\\n")' "$LOG" "$@" 2>/dev/null || true

case "\${1:-}" in
  --version)
    echo "phantom fake 0.0.1"
    ;;
  status)
    echo "ok"
    ;;
  add)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v = json.load(f)
v[sys.argv[2]] = sys.argv[3]
with open(sys.argv[1], "w") as f: json.dump(v, f)
' "$VAULT" "$2" "$3"
    ;;
  remove)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v = json.load(f)
v.pop(sys.argv[2], None)
with open(sys.argv[1], "w") as f: json.dump(v, f)
' "$VAULT" "$2"
    ;;
  list)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v = json.load(f)
for k in v: print(k)
' "$VAULT"
    ;;
  reveal)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v = json.load(f)
print(v.get(sys.argv[2], ""))
' "$VAULT" "$2"
    ;;
  init)
    # no-op for the fake — the vault file already exists
    echo "initialized"
    ;;
  *)
    echo "fake phantom: unknown command: \${1:-}" >&2
    exit 0
    ;;
esac
`;
  const binPath = join(dir, "phantom");
  writeFileSync(binPath, script);
  chmodSync(binPath, 0o755);

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}:${previousPath}`;
  __resetPhantomCache();

  return {
    dir,
    vaultPath,
    logPath,
    calls() {
      return readCalls(logPath);
    },
    callsTo(cmd: string) {
      return readCalls(logPath).filter((c) => c.cmd === cmd);
    },
    cleanup() {
      process.env.PATH = previousPath;
      if (previousRegistryDir === undefined) process.env.STACK_REGISTRY_DIR = undefined;
      else process.env.STACK_REGISTRY_DIR = previousRegistryDir;
      __resetPhantomCache();
      try {
        rmSync(dir, { recursive: true, force: true });
        rmSync(registryDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

export async function readVault(dir: string): Promise<Record<string, string>> {
  const content = readFileSync(join(dir, "vault.json"), "utf-8");
  return JSON.parse(content) as Record<string, string>;
}

function readCalls(logPath: string): Array<{ cmd: string; args: string[] }> {
  try {
    const text = readFileSync(logPath, "utf-8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as { cmd: string; args: string[] };
        } catch {
          return { cmd: "", args: [] };
        }
      });
  } catch {
    return [];
  }
}
