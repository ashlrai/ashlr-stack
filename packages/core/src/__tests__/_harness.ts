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
  /** Synthetic config observation; never claims vault readiness or authority. */
  initialized?: boolean;
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

  // Each fake-phantom call used to spawn python3 twice; interpreter startup
  // dominated the suite. One tiny Bun helper (same runtime as the tests) does
  // the JSON work instead. ALL args ($1..$N) may contain user-shaped values
  // with quotes, newlines or backslashes, so they reach the helper only through
  // argv and are never interpolated into source.
  const helperPath = join(dir, "helper.mjs");
  writeFileSync(
    helperPath,
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [op, vault, ...rest] = process.argv.slice(2);
const load = () => JSON.parse(readFileSync(vault, "utf8"));
if (op === "log") {
  appendFileSync(vault, JSON.stringify({ cmd: rest[0] ?? "", args: rest.slice(1) }) + "\\n");
} else if (op === "add") {
  const v = load();
  if (rest[0] in v) {
    process.stderr.write("Error: Secret '" + rest[0] + "' is already protected. phantom add creates new names only and refuses replacement before reading a value.\\n");
    process.exit(1);
  }
  const value = readFileSync(0, "utf8").split("\\n")[0].replace(/\\r+$/, "");
  if (!value) {
    process.stderr.write("Error: Received empty value on stdin\\n");
    process.exit(1);
  }
  v[rest[0]] = value;
  writeFileSync(vault, JSON.stringify(v));
} else if (op === "remove") {
  const v = load();
  delete v[rest[0]];
  writeFileSync(vault, JSON.stringify(v));
} else if (op === "list") {
  const v = load();
  const names = Object.keys(v);
  if (rest.includes("--json")) {
    console.log(JSON.stringify(names.map((name) => ({ name, detected_service: null })), null, 2));
  } else {
    console.log("-> " + names.length + " secret(s) in vault (encrypted-file):\\n");
    for (const k of names) console.log("   - " + k);
    console.log("\\nnote Values are never displayed. Use phantom add/remove to manage.");
  }
} else if (op === "reveal") {
  console.log(load()[rest[0]] ?? "");
}
`,
  );
  const script = `#!/usr/bin/env bash
set -e
VAULT=${JSON.stringify(vaultPath)}
LOG=${JSON.stringify(logPath)}
H() { ${JSON.stringify(process.execPath)} ${JSON.stringify(helperPath)} "$@"; }
LEGACY_HEADLESS_REVEAL=${options.legacyHeadlessReveal ? 1 : 0}

# Log the invocation as a single JSON line (args passed via argv, never interpolated).
H log "$LOG" "$@" 2>/dev/null || true

case "\${1:-}" in
  --version)
    echo "phantom fake 0.0.1"
    ;;
  status)
    if [ "\${2:-}" = "--json" ]; then
      echo '{"schema_version":1,"initialized":${options.initialized !== false},"inspection":"metadata-only","managed_dotenv":{"inspected":false},"vault":{"inspected":false},"proxy":{"lifecycle_lock":"not-inspected","listener_authenticated":false},"issues":[]}'
    else
      echo "ok"
    fi
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
    H add "$VAULT" "$2"
    ;;
  remove)
    # Phantom Secrets >= 0.7.3: typed confirmation in an attached terminal.
    if [ ! -t 0 ] || [ ! -t 1 ] || [ ! -t 2 ]; then
      echo "Error: phantom remove requires attached stdin, stdout, and stderr terminals and cannot run headlessly." >&2
      exit 1
    fi
    H remove "$VAULT" "$2"
    ;;
  list)
    # Real Phantom: \`list --json\` prints [{"name": ...}, ...] (names only).
    H list "$VAULT" "\${@:2}"
    ;;
  reveal)
    # Phantom Secrets >= 0.7.3: plaintext only into an attached terminal.
    if { [ ! -t 0 ] || [ ! -t 2 ]; } && [ "$LEGACY_HEADLESS_REVEAL" != 1 ]; then
      echo "Error: Refusing to reveal a secret without attached stdin and stderr terminals" >&2
      exit 1
    fi
    H reveal "$VAULT" "$2"
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
      if (previousRegistryDir === undefined)
        Reflect.deleteProperty(process.env, "STACK_REGISTRY_DIR");
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
