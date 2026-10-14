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
 *
 * Behaviour follows Phantom Secrets 0.7.9 (checked against the real binary by
 * `phantom-contract.test.ts`): `add` takes values only via `--stdin` and never
 * replaces a name; `reveal` and `remove` refuse without an attached terminal;
 * `list` prints a decorated table unless `--json` is passed.
 */

export interface Harness {
  dir: string;
  vaultPath: string;
  logPath: string;
  calls(): Array<{ cmd: string; args: string[] }>;
  callsTo(cmd: string): Array<{ cmd: string; args: string[] }>;
  cleanup(): void;
}

export interface HarnessOptions {
  /**
   * Let `reveal` print values to a pipe, as Phantom did before 0.7.3. Real
   * Phantom Secrets 0.7.9 refuses this, so production Stack can never read a
   * stored token back. Only provider tests that exercise HTTP logic *after* a
   * token is read should opt in.
   */
  legacyHeadlessReveal?: boolean;
}

export function setupFakePhantom(
  initial: Record<string, string> = {},
  options: HarnessOptions = {},
): Harness {
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
LEGACY_HEADLESS_REVEAL=${options.legacyHeadlessReveal ? 1 : 0}

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
    # Phantom Secrets >= 0.7.3: values only via --stdin, create-only names.
    if [ "\${3:-}" != "--stdin" ] || [ "$#" -ne 3 ]; then
      for a in "$@"; do
        if [ "$a" = "--rotate" ]; then
          echo "error: unexpected argument '--rotate' found" >&2
          exit 2
        fi
      done
      echo "Error: Positional secret values are disabled because command-line arguments can be exposed by process inspection. Omit the value for a hidden terminal prompt, or use --stdin." >&2
      exit 1
    fi
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v = json.load(f)
if sys.argv[2] in v:
    sys.stderr.write("Error: Secret %r is already protected. phantom add creates new names only and refuses replacement before reading a value.\\n" % sys.argv[2])
    sys.exit(1)
value = sys.stdin.read()
if not value:
    sys.stderr.write("Error: Received empty value on stdin\\n")
    sys.exit(1)
v[sys.argv[2]] = value
with open(sys.argv[1], "w") as f: json.dump(v, f)
' "$VAULT" "$2"
    ;;
  remove)
    # Phantom Secrets >= 0.7.3: typed confirmation in an attached terminal.
    if [ ! -t 0 ]; then
      echo "Error: phantom remove requires attached stdin, stdout, and stderr terminals and cannot run headlessly." >&2
      exit 1
    fi
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v = json.load(f)
v.pop(sys.argv[2], None)
with open(sys.argv[1], "w") as f: json.dump(v, f)
' "$VAULT" "$2"
    ;;
  list)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v = json.load(f)
if "--json" in sys.argv[2:]:
    print(json.dumps([{"name": k, "detected_service": None} for k in v], indent=2))
else:
    print("-> %d secret(s) in vault (encrypted-file):\\n" % len(v))
    for k in v: print("   - " + k)
    print("\\nnote Values are never displayed. Use phantom add/remove to manage.")
' "$VAULT" "\${@:2}"
    ;;
  reveal)
    # Phantom Secrets >= 0.7.3: plaintext only into an attached terminal.
    if [ ! -t 0 ] && [ "$LEGACY_HEADLESS_REVEAL" != 1 ]; then
      echo "Error: Refusing to reveal a secret without attached stdin and stderr terminals" >&2
      exit 1
    fi
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
