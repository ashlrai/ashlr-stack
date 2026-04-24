import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";

const REGISTRY_URL = "https://registry.npmjs.org/@ashlr/stack/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 1500;

interface CacheEntry {
  lastChecked: string;
  latest: string;
}

export function shouldCheck(): boolean {
  if (process.env.STACK_NO_UPDATE_CHECK === "1") return false;
  if (process.env.CI === "1" || process.env.CI === "true") return false;
  if (!process.stderr.isTTY) return false;
  return true;
}

/** Split semver string into numeric segments. Non-numeric segments become 0. */
function parseVersion(v: string): number[] {
  return v
    .replace(/^[^0-9]*/, "") // strip leading 'v' or similar
    .split(".")
    .map((s) => Number.parseInt(s, 10) || 0);
}

/** Returns true if `remote` is strictly greater than `current`. */
export function isNewer(current: string, remote: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(remote);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (bi > ai) return true;
    if (bi < ai) return false;
  }
  return false;
}

async function readCache(file: string): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

async function writeCache(file: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, JSON.stringify(entry), "utf8");
  } catch {
    // non-fatal
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string };
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Public API. Pass `_cacheFile` only in tests to override the default path. */
export async function checkForUpdate(currentVersion: string, _cacheFile?: string): Promise<void> {
  if (!shouldCheck()) return;

  const file = _cacheFile ?? join(homedir(), ".ashlr", "stack", "update-check.json");

  try {
    let latest: string | null = null;

    const cache = await readCache(file);
    const now = Date.now();

    if (cache && now - new Date(cache.lastChecked).getTime() < CACHE_TTL_MS) {
      latest = cache.latest;
    } else {
      latest = await fetchLatestVersion();
      if (latest !== null) {
        await writeCache(file, { lastChecked: new Date().toISOString(), latest });
      }
    }

    if (latest !== null && isNewer(currentVersion, latest)) {
      process.stderr.write(
        pc.dim(
          pc.yellow(`  stack ${currentVersion} → ${latest} available · npm i -g @ashlr/stack\n`),
        ),
      );
    }
  } catch {
    // never throw
  }
}
