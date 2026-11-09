#!/usr/bin/env bun
/**
 * Fleet repo hygiene audit — read-only collector.
 *
 * Scans every git checkout under a fleet root (default: the parent of the
 * directory that owns this repo's common git dir, i.e. ~/Projects/ashlrai when
 * run from a worktree) and emits a schemaVersion 1 JSON report plus an
 * optional Markdown rendering for the hygiene dashboard.
 *
 * Everything here is read-only: git plumbing, file reads, `bun outdated`,
 * `npm outdated --json` and `cargo update --dry-run`. No installs, no writes
 * inside the audited repos.
 *
 * Usage:
 *   bun scripts/repo-hygiene.ts [--root DIR] [--repos a,b] [--json] [--md FILE]
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCTOR_REPOS } from "../packages/cli/src/lib/doctor-repos.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 96 * 1024 * 1024;
const EXAMPLE_CAP = 10;

// ---------------------------------------------------------------------------
// Process / git helpers
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, NO_COLOR: "1", CI: "1" },
      },
      (err, stdout, stderr) => {
        if (err) {
          // Preserve stdout: tools like `npm outdated` exit 1 while still
          // printing their JSON payload there.
          const failure = new Error(
            `${cmd} ${args.slice(0, 2).join(" ")} failed: ${err.message}`,
          ) as Error & { stdout?: string; stderr?: string };
          failure.stdout = stdout;
          failure.stderr = stderr;
          reject(failure);
        } else resolvePromise(stdout);
      },
    );
  });
}

function git(repo: string, args: string[], timeoutMs?: number): Promise<string> {
  return run("git", ["-C", repo, ...args], { timeoutMs });
}

/** git helper that returns null instead of throwing — metadata must not fail the audit. */
async function gitTry(repo: string, args: string[]): Promise<string | null> {
  try {
    return await git(repo, args, 20_000);
  } catch {
    return null;
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Pure parsers (exported for tests)
// ---------------------------------------------------------------------------

export type WorktreeSummary = { total: number; detached: number; prunable: number };

/** Parse `git worktree list --porcelain` output. */
export function parseWorktreesPorcelain(porcelain: string): WorktreeSummary {
  const summary: WorktreeSummary = { total: 0, detached: 0, prunable: 0 };
  let sawWorktree = false;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      summary.total++;
      sawWorktree = true;
    } else if (line === "detached") {
      summary.detached++;
    } else if (line.startsWith("prunable")) {
      summary.prunable++;
    }
  }
  return sawWorktree ? summary : { total: 0, detached: 0, prunable: 0 };
}

export type OutdatedDep = {
  name: string;
  current: string;
  wanted: string | null;
  latest: string | null;
  dev: boolean;
};

/** Parse `bun outdated` table output into dep rows. */
export function parseBunOutdated(text: string): OutdatedDep[] {
  const rows: OutdatedDep[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.includes("---") || trimmed.startsWith("| Package"))
      continue;
    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 4) continue;
    const nameCell = cells[0]!;
    const dev = /\(dev\)\s*$/.test(nameCell);
    const name = nameCell.replace(/\s*\((dev|peer|optional)\)\s*$/i, "").trim();
    if (!name || name === "Package") continue;
    rows.push({
      name,
      current: cells[1] ?? "",
      wanted: cells[2] ?? null,
      latest: cells[3] ?? null,
      dev,
    });
  }
  return rows;
}

/** Parse `npm outdated --json` output (flat map of name -> version info). */
export function parseNpmOutdated(text: string): OutdatedDep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const rows: OutdatedDep[] = [];
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" ? x : null);
    rows.push({
      name,
      current: str(v.current) ?? "",
      wanted: str(v.wanted),
      latest: str(v.latest),
      dev: false,
    });
  }
  return rows;
}

/** Count lockfile drift lines from `cargo update --dry-run` output. */
export function parseCargoDryRun(text: string): { updating: number; adding: number; removing: number } {
  let updating = 0;
  let adding = 0;
  let removing = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    // Package updates carry a version ("Updating foo v1.2.3 -> v1.2.4");
    // "Updating crates.io index" / git-repo lines do not.
    if (/^Updating\s+\S+\s+v[\d.]/.test(t)) updating++;
    else if (t.startsWith("Adding ")) adding++;
    else if (t.startsWith("Removing ")) removing++;
  }
  return { updating, adding, removing };
}

export type ExportedSymbol = { name: string; kind: string };

const EXPORT_DECL_RE =
  /\bexport\s+(?:declare\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const EXPORT_LIST_RE = /\bexport\s*\{([^}]*)\}/g;
const EXPORT_TYPE_LIST_RE = /\bexport\s+type\s*\{([^}]*)\}/g;
const EXPORT_STAR_AS_RE = /\bexport\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const IDENT_RE = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;

function specifierLocalName(part: string): string | null {
  const cleaned = part.trim().replace(/^type\s+/, "");
  if (!cleaned) return null;
  const asMatch = cleaned.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
  if (asMatch) return asMatch[1]!;
  const first = cleaned.split(/\s+/)[0];
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(first ?? "") ? first! : null;
}

/** Extract names a module exports (importer-visible names). Default exports are skipped. */
export function extractExports(source: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  for (const m of source.matchAll(EXPORT_DECL_RE)) {
    out.push({ name: m[2]!, kind: m[1]!.replace(/\*$/, "") });
  }
  for (const m of source.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1]!.split(",")) {
      const name = specifierLocalName(part);
      if (name) out.push({ name, kind: "named" });
    }
  }
  for (const m of source.matchAll(EXPORT_TYPE_LIST_RE)) {
    for (const part of m[1]!.split(",")) {
      const name = specifierLocalName(part);
      if (name) out.push({ name, kind: "type" });
    }
  }
  for (const m of source.matchAll(EXPORT_STAR_AS_RE)) {
    out.push({ name: m[1]!, kind: "namespace" });
  }
  return out;
}

export type UnusedImport = { line: number; clause: string };

const IMPORT_RE =
  /import\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

const SPECIFIER_RE =
  /(?:import|export)\s[^'"]*?\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

/** Bare package name for an import specifier, or null for relative/builtin. */
export function packageNameOf(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:") ||
    specifier === "bun" ||
    specifier.startsWith("#")
  )
    return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

/** Package names referenced by import/export/require/dynamic-import specifiers. */
export function extractPackageSpecifiers(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(SPECIFIER_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!spec) continue;
    const name = packageNameOf(spec);
    if (name) names.add(name);
  }
  return names;
}

function countIdentifier(haystack: string, name: string): number {
  let count = 0;
  for (const m of haystack.matchAll(IDENT_RE)) if (m[0] === name) count++;
  return count;
}

/**
 * Heuristic unused-import detector. Returns import statements whose every local
 * binding never appears as an identifier elsewhere in the file. Side-effect
 * imports (`import "x"`) are never flagged. This is a candidate finder, not a
 * proof — callers must verify before editing.
 */
export function findUnusedImports(source: string): UnusedImport[] {
  const statements = [...source.matchAll(IMPORT_RE)];
  if (statements.length === 0) return [];
  const withoutImports = source.replace(IMPORT_RE, (m) => " ".repeat(m.length));
  const hits: UnusedImport[] = [];
  for (const m of statements) {
    const clause = (m[2] ?? "").trim();
    const sideEffectOnly = m[4] !== undefined && clause === "";
    if (sideEffectOnly) continue;
    const bindings: string[] = [];
    if (clause.startsWith("*")) {
      const ns = clause.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (ns) bindings.push(ns[1]!);
    } else {
      const brace = clause.match(/\{([\s\S]*)\}/);
      const beforeBrace = brace ? clause.slice(0, clause.indexOf("{")) : clause;
      const defaultName = beforeBrace
        .replace(/,$/, "")
        .trim()
        .split(/\s+/)[0];
      if (defaultName && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(defaultName))
        bindings.push(defaultName);
      const starNs = beforeBrace.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (starNs) bindings.push(starNs[1]!);
      if (brace) {
        for (const part of brace[1]!.split(",")) {
          const name = specifierLocalName(part);
          if (name) bindings.push(name);
        }
      }
    }
    if (bindings.length === 0) continue;
    const unused = bindings.filter((b) => countIdentifier(withoutImports, b) === 0);
    if (unused.length === bindings.length) {
      hits.push({ line: source.slice(0, m.index).split("\n").length, clause: clause.slice(0, 80) });
    }
  }
  return hits;
}

export type BrokenLink = { doc: string; target: string };

/** Remove fenced code blocks and inline code spans so examples aren't link-checked. */
export function stripMarkdownCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/** Extract local link targets from markdown `[text](target)` syntax. */
export function extractMarkdownLinks(markdown: string): string[] {
  const targets: string[] = [];
  const re = /\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+"[^"]*")?\s*\)/g;
  for (const m of markdown.matchAll(re)) {
    const raw = m[1]!;
    if (/^(https?:|mailto:|tel:|data:|ftp:)/i.test(raw)) continue;
    targets.push(raw);
  }
  return targets;
}

/** Resolve a markdown link target to a repo-relative path, or null when not local. */
export function resolveDocLink(docPath: string, target: string): string | null {
  const noAnchor = target.split("#")[0]!;
  if (!noAnchor) return null;
  const cleaned = noAnchor.replace(/^<|>$/g, "").replace(/%20/g, " ");
  // Site-absolute paths (`/docs/x`) belong to the published docs domain, not
  // the checkout — unverifiable here, so skip them.
  if (cleaned.startsWith("/")) return null;
  return normalize(join(dirname(docPath), cleaned));
}

// ---------------------------------------------------------------------------
// Per-repo collection
// ---------------------------------------------------------------------------

type Manifest = {
  dir: string;
  name: string | null;
  dependencies: number;
  devDependencies: number;
  optionalDependencies: number;
  peerDependencies: number;
  depNames: string[];
  scripts: string[];
  entryPoints: string[];
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", "build", ".next", "coverage"]);

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function countKeys(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

/** Collect package.json manifests (tracked files only), with entry-point guesses. */
async function collectManifests(repo: string, files: string[]): Promise<Manifest[]> {
  const manifests: Manifest[] = [];
  for (const file of files) {
    if (basename(file) !== "package.json" || file.split("/").some((p) => SKIP_DIRS.has(p)))
      continue;
    const abs = join(repo, file);
    const json = await readJson(abs);
    if (!json) continue;
    const dir = dirname(file) === "." ? "" : dirname(file);
    const entryPoints: string[] = [];
    const push = (v: unknown) => {
      if (typeof v === "string" && v.length > 0) entryPoints.push(v);
    };
    push(json.main);
    push(json.module);
    const bin = json.bin;
    if (typeof bin === "string") push(bin);
    else if (bin && typeof bin === "object")
      for (const v of Object.values(bin)) push(v);
    const exportsField = json.exports;
    if (typeof exportsField === "string") push(exportsField);
    else if (exportsField && typeof exportsField === "object") {
      for (const [key, value] of Object.entries(exportsField as Record<string, unknown>)) {
        if (key === "." || key.startsWith("./")) {
          if (typeof value === "string") push(value);
          else if (value && typeof value === "object") {
            const v = value as Record<string, unknown>;
            push(v.import);
            push(v.default);
            push(v.types);
          }
        }
      }
    }
    const scripts = json.scripts && typeof json.scripts === "object"
      ? Object.keys(json.scripts as Record<string, unknown>)
      : [];
    const depNames = new Set<string>();
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      const deps = json[field];
      if (deps && typeof deps === "object" && !Array.isArray(deps))
        for (const key of Object.keys(deps)) depNames.add(key);
    }
    manifests.push({
      dir,
      name: typeof json.name === "string" ? json.name : null,
      dependencies: countKeys(json.dependencies),
      devDependencies: countKeys(json.devDependencies),
      optionalDependencies: countKeys(json.optionalDependencies),
      peerDependencies: countKeys(json.peerDependencies),
      depNames: [...depNames],
      scripts,
      entryPoints,
    });
  }
  return manifests;
}

const CODE_EXTS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]);
const JS_ANALYSIS_EXTS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);
const REF_SCAN_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts",
  "json", "jsonc", "toml", "yaml", "yml", "sh", "bash", "zsh",
  "rs", "py", "html", "vue", "svelte", "css",
]);
const LOCKFILES = /(?:^|\/)(?:bun\.lock|bun\.lockb|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock)$/;
const TEST_FILE_RE = /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[tj]sx?$/i;

function extOf(path: string): string {
  const base = basename(path);
  if (base.endsWith(".d.ts")) return "d.ts";
  const idx = base.lastIndexOf(".");
  return idx < 0 ? "" : base.slice(idx + 1).toLowerCase();
}

async function readIfSmall(path: string, maxBytes = 2 * 1024 * 1024): Promise<string | null> {
  try {
    const content = await readFile(path, "utf8");
    return content.length > maxBytes ? null : content;
  } catch {
    return null;
  }
}

/** Resolve a manifest entry point (often dist/*.js) to plausible source files. */
function entrySourceCandidates(entry: string): string[] {
  const out = new Set<string>();
  const stripped = entry.replace(/^\.\//, "");
  const variants = [stripped];
  // dist/build outputs usually mirror a src/ tree.
  for (const buildDir of ["dist", "build", "out", ".next"]) {
    if (stripped.startsWith(`${buildDir}/`)) variants.push(`src/${stripped.slice(buildDir.length + 1)}`);
  }
  for (const v of variants) {
    out.add(v);
    if (/\.(m?js|cjs)$/.test(v)) out.add(v.replace(/\.(m?js|cjs)$/, ".ts"));
    if (/\.ts$/.test(v)) out.add(v.replace(/\.ts$/, ".js"));
  }
  return [...out];
}

type JsFileScan = {
  file: string;
  /** Exports, only populated for non-test source files. */
  exports: ExportedSymbol[];
  unusedImportCount: number;
  packageNames: string[];
};

function isJsSourceFile(file: string): boolean {
  return (
    JS_ANALYSIS_EXTS.has(extOf(file)) &&
    extOf(file) !== "d.ts" &&
    !LOCKFILES.test(file)
  );
}

function isExportScannable(file: string): boolean {
  return isJsSourceFile(file) && !TEST_FILE_RE.test(file) && !file.includes("/fixtures/") && !file.includes("/examples/");
}

/** Single read pass over every JS/TS file: exports, unused imports, package specifiers. */
async function scanJsFiles(repo: string, files: string[]): Promise<JsFileScan[]> {
  const jsFiles = files.filter(isJsSourceFile);
  return pool(jsFiles, 24, async (file) => {
    const content = await readIfSmall(join(repo, file));
    if (content === null) return { file, exports: [], unusedImportCount: 0, packageNames: [] };
    return {
      file,
      exports: isExportScannable(file) ? extractExports(content) : [],
      unusedImportCount: findUnusedImports(content).length,
      packageNames: [...extractPackageSpecifiers(content)],
    };
  });
}

/** Deps invoked only as tool binaries or ambient type packages — never import-scanned. */
const UNUSED_DEP_EXEMPT = new Set([
  "typescript",
  "@biomejs/biome",
  "eslint",
  "prettier",
  "vitest",
  "jest",
  "tsx",
  "ts-node",
  "bun-types",
  "@types/bun",
]);

/** Deps never referenced by an import specifier or a manifest script — heuristic. */
function summarizeUnusedDeps(
  scans: JsFileScan[],
  manifests: Manifest[],
): { name: string; manifest: string }[] {
  if (manifests.length === 0) return [];
  // Deepest manifest dir wins; "" (root) is the fallback owner.
  const sortedDirs = manifests.map((m) => m.dir).sort((a, b) => b.length - a.length);
  const manifestByDir = new Map(manifests.map((m) => [m.dir, m]));
  const ownerOf = (file: string): Manifest => {
    for (const dir of sortedDirs) {
      if (dir !== "" && file.startsWith(`${dir}/`)) return manifestByDir.get(dir)!;
    }
    return manifestByDir.get("") ?? manifests[0]!;
  };
  const usedByManifest = new Map<Manifest, Set<string>>();
  for (const scan of scans) {
    const owner = ownerOf(scan.file);
    const used = usedByManifest.get(owner) ?? new Set<string>();
    for (const name of scan.packageNames) used.add(name);
    usedByManifest.set(owner, used);
  }
  const unused: { name: string; manifest: string }[] = [];
  for (const m of manifests) {
    if (m.depNames.length === 0) continue;
    const used = usedByManifest.get(m) ?? new Set<string>();
    const scriptText = JSON.stringify(m.scripts).toLowerCase();
    for (const dep of m.depNames) {
      if (dep.startsWith("@types/") || UNUSED_DEP_EXEMPT.has(dep)) continue;
      if (used.has(dep)) continue;
      // Tool invoked by name inside scripts (e.g. "biome check", "tsc --noEmit").
      const lastSegment = dep.split("/").pop()!.toLowerCase();
      if (lastSegment.length > 2 && scriptText.includes(lastSegment)) continue;
      unused.push({ name: dep, manifest: m.dir || m.name || "(root)" });
    }
  }
  return unused;
}

/**
 * Second-chance check for unused-dep candidates: a dep named in a config file
 * (postcss/tailwind plugin tables, renovate rules excluded) or non-import code
 * still counts as referenced. package.json, lockfiles, markdown and .github
 * never count — they name deps without using them.
 */
async function verifyUnusedDeps(
  repo: string,
  candidates: { name: string; manifest: string }[],
): Promise<{ name: string; manifest: string }[]> {
  const kept = await pool(candidates, 8, async (candidate) => {
    const args = candidate.name.startsWith("@")
      ? ["grep", "-l", "-F", "-e", candidate.name, "--", "."]
      : ["grep", "-l", "-w", "-F", "-e", candidate.name, "--", "."];
    try {
      const out = await git(repo, args, 30_000);
      const referenced = out
        .split("\n")
        .filter(Boolean)
        .some(
          (f) =>
            !f.endsWith("package.json") &&
            !f.endsWith(".md") &&
            !f.startsWith(".github/") &&
            !LOCKFILES.test(f),
        );
      return referenced ? null : candidate;
    } catch {
      return candidate; // grep found nothing (exit 1) or failed — keep as candidate
    }
  });
  return kept.filter((c): c is { name: string; manifest: string } => c !== null);
}

/**
 * Dead-export candidates: names exported by exactly one non-entry file whose
 * identifier never appears in any other tracked file. Conservative by design —
 * same-named exports and barrel re-exports resolve toward "used".
 */
async function analyzeDeadExports(
  repo: string,
  files: string[],
  manifests: Manifest[],
  scans: JsFileScan[],
): Promise<{
  exportCandidates: { file: string; name: string; kind: string }[];
  exportCandidateCount: number;
  unusedImportFiles: number;
  unusedImports: number;
}> {
  // Entry points are public surface — never flag their exports.
  const entryFiles = new Set<string>();
  for (const m of manifests) {
    for (const entry of m.entryPoints) {
      for (const cand of entrySourceCandidates(entry)) {
        const withDir = m.dir ? join(m.dir, cand) : cand;
        if (files.includes(withDir)) entryFiles.add(withDir);
        if (files.includes(cand)) entryFiles.add(cand);
      }
    }
  }
  const exporters = new Map<string, { file: string; kind: string }[]>();
  for (const scan of scans) {
    if (scan.exports.length === 0) continue;
    for (const ex of scan.exports) {
      const list = exporters.get(ex.name) ?? [];
      list.push({ file: scan.file, kind: ex.kind });
      exporters.set(ex.name, list);
    }
  }
  const candidates = new Map<string, { file: string; kind: string }>();
  for (const [name, list] of exporters) {
    if (name.length < 3 || list.length !== 1) continue;
    const only = list[0]!;
    if (entryFiles.has(only.file)) continue;
    candidates.set(name, { file: only.file, kind: only.kind });
  }
  // Pass B: scan every plausible reference file for identifier hits.
  const refFiles = files.filter(
    (f) =>
      REF_SCAN_EXTS.has(extOf(f)) &&
      !LOCKFILES.test(f) &&
      !f.endsWith(".min.js") &&
      !f.includes("/dist/") &&
      !f.includes("/node_modules/"),
  );
  const hits = new Map<string, Set<string>>();
  await pool(refFiles, 24, async (file) => {
    const content = await readIfSmall(join(repo, file));
    if (content === null) return;
    const local = new Set<string>();
    for (const m of content.matchAll(IDENT_RE)) {
      if (candidates.has(m[0]!)) local.add(m[0]!);
    }
    for (const name of local) {
      if (candidates.get(name)!.file === file) continue; // self-references don't count
      const set = hits.get(name) ?? new Set<string>();
      set.add(file);
      hits.set(name, set);
    }
  });
  const dead: { file: string; name: string; kind: string }[] = [];
  for (const [name, info] of candidates) {
    if (!hits.has(name)) dead.push({ file: info.file, name, kind: info.kind });
  }
  dead.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  let unusedImportFiles = 0;
  let unusedImports = 0;
  for (const scan of scans) {
    if (scan.unusedImportCount > 0) {
      unusedImportFiles++;
      unusedImports += scan.unusedImportCount;
    }
  }
  return {
    exportCandidates: dead.slice(0, EXAMPLE_CAP),
    exportCandidateCount: dead.length,
    unusedImportFiles,
    unusedImports,
  };
}

async function countLines(repo: string, patterns: string[]): Promise<number> {
  if (patterns.length === 0) return 0;
  try {
    const out = await run(
      "sh",
      [
        "-c",
        `cd "$1" && git ls-files -z -- "${patterns.join('" "')}" | xargs -0 wc -l`,
        "sh",
        repo,
      ],
      { timeoutMs: 60_000 },
    );
    // Sum per-file counts; skip the aggregate "N total" trailer lines.
    let total = 0;
    for (const line of out.split("\n")) {
      if (/\btotal\s*$/.test(line)) continue;
      const m = line.match(/^\s*(\d+)\s/);
      if (m) total += Number(m[1]);
    }
    return total;
  } catch {
    return 0;
  }
}

async function gitGrepCount(repo: string, pattern: string, pathspecs: string[]): Promise<number> {
  if (pathspecs.length === 0) return 0;
  try {
    const out = await git(repo, ["grep", "-c", "-E", pattern, "--", ...pathspecs], 60_000);
    let total = 0;
    for (const line of out.split("\n")) {
      const m = line.match(/:(\d+)$/);
      if (m) total += Number(m[1]);
    }
    return total;
  } catch {
    return 0;
  }
}

async function gitGrepFiles(repo: string, pattern: string, pathspecs: string[]): Promise<string[]> {
  if (pathspecs.length === 0) return [];
  try {
    const out = await git(repo, ["grep", "-l", "-E", pattern, "--", ...pathspecs], 60_000);
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function gitGrepLines(
  repo: string,
  pattern: string,
  pathspecs: string[],
  cap = 20_000,
): Promise<string[]> {
  if (pathspecs.length === 0) return [];
  try {
    const out = await git(repo, ["grep", "-n", "-E", pattern, "--", ...pathspecs], 60_000);
    return out
      .split("\n")
      .filter(Boolean)
      .slice(0, cap)
      .map((l) => l.slice(0, 160));
  } catch {
    return [];
  }
}

async function collectStaleDeps(
  repo: string,
  files: string[],
  manifests: Manifest[],
): Promise<{
  checkedWith: string | null;
  outdatedCount: number;
  majorsBehind: number;
  examples: OutdatedDep[];
  lockfileDrift: { updating: number; adding: number; removing: number } | null;
}> {
  const hasBunLock = files.includes("bun.lock") || files.includes("bun.lockb");
  const hasPackageLock = files.includes("package-lock.json");
  const hasCargo = files.some((f) => f.endsWith("Cargo.toml"));
  let checkedWith: string | null = null;
  let outdated: OutdatedDep[] = [];
  let lockfileDrift: { updating: number; adding: number; removing: number } | null = null;

  if (hasBunLock) {
    checkedWith = "bun outdated";
    const dirs = manifests
      .filter((m) => m.dependencies + m.devDependencies + m.optionalDependencies + m.peerDependencies > 0)
      .map((m) => (m.dir ? join(repo, m.dir) : repo));
    const seen = new Set<string>();
    const rows = await pool([...new Set(dirs)], 4, async (dir) => {
      try {
        const out = await run("bun", ["outdated"], { cwd: dir, timeoutMs: 90_000 });
        return parseBunOutdated(out);
      } catch {
        return [] as OutdatedDep[];
      }
    });
    for (const row of rows.flat()) {
      const key = `${row.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        outdated.push(row);
      }
    }
  } else if (hasPackageLock) {
    checkedWith = "npm outdated";
    try {
      const out = await run("npm", ["outdated", "--json"], { cwd: repo, timeoutMs: 120_000 });
      outdated = parseNpmOutdated(out);
    } catch (err) {
      // npm outdated exits 1 when anything is outdated; stdout still carries the JSON.
      const stdout = (err as { stdout?: string }).stdout;
      if (stdout) outdated = parseNpmOutdated(stdout);
    }
  }

  if (hasCargo && files.includes("Cargo.lock")) {
    try {
      const out = await run("cargo", ["update", "--dry-run"], { cwd: repo, timeoutMs: 180_000 });
      lockfileDrift = parseCargoDryRun(out);
      if (!checkedWith) checkedWith = "cargo update --dry-run";
    } catch {
      lockfileDrift = null;
    }
  }

  const majorsBehind = outdated.filter((d) => {
    if (!d.current || !d.latest) return false; // e.g. npm without node_modules
    const cur = Number(d.current.split(".")[0]);
    const lat = Number(d.latest.split(".")[0]);
    return Number.isFinite(cur) && Number.isFinite(lat) && lat > cur;
  }).length;

  return {
    checkedWith,
    outdatedCount: outdated.length,
    majorsBehind,
    examples: outdated.slice(0, EXAMPLE_CAP),
    lockfileDrift,
  };
}

async function analyzeDocs(
  repo: string,
  files: string[],
  manifests: Manifest[],
): Promise<{
  markdownFiles: number;
  brokenLinks: number;
  linkExamples: BrokenLink[];
  missingScriptRefs: number;
  scriptExamples: { doc: string; ref: string }[];
}> {
  const mdFiles = files.filter((f) => f.endsWith(".md") && !f.includes("/node_modules/"));
  const scriptNames = new Set(manifests.flatMap((m) => m.scripts));
  const broken: BrokenLink[] = [];
  const missingScripts: { doc: string; ref: string }[] = [];
  const docs = await pool(mdFiles, 16, async (file) => {
    const content = await readIfSmall(join(repo, file), 1024 * 1024);
    return content === null ? null : { file, content };
  });
  for (const doc of docs) {
    if (!doc) continue;
    const prose = stripMarkdownCode(doc.content);
    for (const target of extractMarkdownLinks(prose)) {
      const resolved = resolveDocLink(doc.file, target);
      if (resolved === null) continue;
      if (!existsSync(join(repo, resolved)) && broken.length < 200)
        broken.push({ doc: doc.file, target });
    }
    // Only bare script names are checked — path-like refs (`bun run scripts/x.ts`)
    // routinely point into a different repo the doc tells you to clone first.
    for (const m of doc.content.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9:._/-]+)/g)) {
      const ref = m[1]!.replace(/[.,;:!?)\]]+$/, "");
      if (ref.includes("/") || /\.(ts|tsx|js|mjs|cjs)$/.test(ref)) continue;
      if (!scriptNames.has(ref) && missingScripts.length < 200)
        missingScripts.push({ doc: doc.file, ref });
    }
  }
  return {
    markdownFiles: mdFiles.length,
    brokenLinks: broken.length,
    linkExamples: broken.slice(0, EXAMPLE_CAP),
    missingScriptRefs: missingScripts.length,
    scriptExamples: missingScripts.slice(0, EXAMPLE_CAP),
  };
}

async function collectRepo(repoPath: string): Promise<Record<string, unknown>> {
  const name = basename(repoPath);
  const files = ((await gitTry(repoPath, ["ls-files"])) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const isGit = files.length > 0;

  const headBranch = (await gitTry(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() ?? null;
  const headSha = (await gitTry(repoPath, ["rev-parse", "--short", "HEAD"]))?.trim() ?? null;
  const lastCommit = (await gitTry(repoPath, ["log", "-1", "--format=%cI"]))?.trim() ?? null;
  const porcelain = (await gitTry(repoPath, ["status", "--porcelain"])) ?? "";
  const dirtyFiles = porcelain.split("\n").filter((l) => l.trim().length > 0).length;
  const worktrees = parseWorktreesPorcelain((await gitTry(repoPath, ["worktree", "list", "--porcelain"])) ?? "");

  let defaultBranch: string | null = null;
  const originHead = await gitTry(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (originHead) defaultBranch = originHead.trim().replace(/^origin\//, "");
  else {
    for (const candidate of ["main", "master"]) {
      const ok = await gitTry(repoPath, ["rev-parse", "--verify", "--quiet", `origin/${candidate}`]);
      if (ok !== null) {
        defaultBranch = candidate;
        break;
      }
    }
  }

  // LOC per language via wc -l (works for every repo, no file reads needed).
  const extGroups = new Map<string, string[]>();
  for (const file of files) {
    const ext = extOf(file);
    if (!CODE_EXTS.has(ext) && ext !== "rs" && ext !== "py" && ext !== "sh") continue;
    const list = extGroups.get(ext) ?? [];
    list.push(`*.${ext}`);
    extGroups.set(ext, list);
  }
  const byLanguage: Record<string, { files: number; loc: number }> = {};
  const fileCounts = new Map<string, number>();
  for (const file of files) {
    const ext = extOf(file);
    if (CODE_EXTS.has(ext) || ext === "rs" || ext === "py" || ext === "sh")
      fileCounts.set(ext, (fileCounts.get(ext) ?? 0) + 1);
  }
  await pool([...extGroups.entries()], 8, async ([ext, patterns]) => {
    const loc = await countLines(repoPath, [...new Set(patterns)]);
    byLanguage[ext] = { files: fileCounts.get(ext) ?? 0, loc };
  });
  const codeFiles = [...fileCounts.values()].reduce((a, b) => a + b, 0);
  const codeLoc = Object.values(byLanguage).reduce((a, b) => a + b.loc, 0);

  const manifests = await collectManifests(repoPath, files);
  const depTotals = manifests.reduce(
    (acc, m) => ({
      dependencies: acc.dependencies + m.dependencies,
      devDependencies: acc.devDependencies + m.devDependencies,
      optionalDependencies: acc.optionalDependencies + m.optionalDependencies,
      peerDependencies: acc.peerDependencies + m.peerDependencies,
    }),
    { dependencies: 0, devDependencies: 0, optionalDependencies: 0, peerDependencies: 0 },
  );

  const hasJs = files.some((f) => isJsSourceFile(f) && !f.endsWith(".d.ts"));
  const jsScans = hasJs ? await scanJsFiles(repoPath, files) : [];
  const deadCode = hasJs
    ? await analyzeDeadExports(repoPath, files, manifests, jsScans)
    : { exportCandidates: [], exportCandidateCount: 0, unusedImportFiles: 0, unusedImports: 0 };

  const testFiles = files.filter((f) => TEST_FILE_RE.test(f) && CODE_EXTS.has(extOf(f)));
  const rustFiles = files.filter((f) => f.endsWith(".rs"));
  // Rust tests live inside src files — restrict signal greps to files that
  // actually contain test attributes, or src code inflates every count.
  const rustTestFiles = await gitGrepFiles(
    repoPath,
    String.raw`#\[(tokio::|async_std::)?test|#\[cfg\(test\)\]`,
    rustFiles,
  );
  const testPathspecs = [...testFiles, ...rustTestFiles];
  const [skipped, sleepSignals, networkCalls, rustTests, rustIgnored] = await Promise.all([
    gitGrepCount(repoPath, String.raw`(\.skip\s*\(|xit\s*\(|xdescribe\s*\(|\.todo\s*\(|#\[ignore)`, testPathspecs),
    gitGrepCount(repoPath, String.raw`(setTimeout|setInterval|Bun\.sleep|tokio::time::sleep|std::thread::sleep|sleep\s*\()`, testPathspecs),
    gitGrepCount(repoPath, String.raw`(fetch|axios|got|request|https?\.get|net\.connect|curl|wget)\s*\(`, testPathspecs),
    gitGrepCount(repoPath, String.raw`#\[(tokio::|async_std::)?test`, rustFiles),
    gitGrepCount(repoPath, String.raw`#\[ignore`, rustFiles),
  ]);
  const networkCallSample = await gitGrepLines(
    repoPath,
    String.raw`(fetch|axios|got|request|https?\.get|net\.connect|curl|wget)\s*\(`,
    testPathspecs,
    EXAMPLE_CAP,
  ).catch(() => [] as string[]);

  const docs = await analyzeDocs(repoPath, files, manifests);
  const stale = await collectStaleDeps(repoPath, files, manifests);
  const unusedDeps = hasJs
    ? await verifyUnusedDeps(repoPath, summarizeUnusedDeps(jsScans, manifests))
    : [];

  const depUpdateAutomation = files.some(
    (f) => /(^|\/)(renovate\.json5?|\.github\/dependabot\.ya?ml|\.github\/renovate\.json5?)$/.test(f),
  )
    ? files.some((f) => /dependabot/.test(f))
      ? "dependabot"
      : "renovate"
    : null;

  // POSIX classes, not \b: macOS's regex engine rejects \b in git grep -E and silently counts 0.
  const todoCount = await gitGrepCount(repoPath, String.raw`(^|[^[:alnum:]_])(TODO|FIXME|XXX|HACK)([^[:alnum:]_]|$)`, files.filter((f) => CODE_EXTS.has(extOf(f)) || extOf(f) === "rs"));
  const allowDeadCode = await gitGrepCount(repoPath, String.raw`#\[allow\(dead_code\)\]`, rustFiles);
  const pullRequestTarget = await gitGrepCount(
    repoPath,
    String.raw`pull_request_target`,
    files.filter((f) => f.startsWith(".github/")),
  );
  const workflowCount = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).length;

  return {
    name,
    path: repoPath,
    canonicalFleet: DOCTOR_REPOS.some((r) => r.endsWith(`/${name}`)),
    isGitRepo: isGit,
    defaultBranch,
    headBranch,
    headSha,
    lastCommitAt: lastCommit,
    dirtyFiles,
    worktrees,
    code: { files: codeFiles, loc: codeLoc, byLanguage },
    manifests: manifests.length,
    deps: {
      ...depTotals,
      total: Object.values(depTotals).reduce((a, b) => a + b, 0),
      updateAutomation: depUpdateAutomation,
      ...stale,
      possiblyUnusedDeps: unusedDeps.length,
      possiblyUnusedDepExamples: unusedDeps.length ? unusedDeps.slice(0, EXAMPLE_CAP) : undefined,
    },
    deadCode: {
      exportCandidateCount: deadCode.exportCandidateCount,
      exportCandidates: deadCode.exportCandidates,
      unusedImportFiles: deadCode.unusedImportFiles,
      unusedImports: deadCode.unusedImports,
      todoFixmeCount: todoCount,
      rustAllowDeadCode: allowDeadCode || undefined,
    },
    tests: {
      files: testFiles.length,
      rustTestFns: rustTests || undefined,
      skipped: skipped + (rustIgnored || 0) || undefined,
      sleepSignals: sleepSignals || undefined,
      networkCallRefs: networkCalls || undefined,
      networkCallSample: networkCallSample.length ? networkCallSample : undefined,
    },
    docs: { ...docs },
    ci: { workflows: workflowCount, pullRequestTargetRefs: pullRequestTarget || undefined },
  };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function fmt(n: unknown): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

export function renderMarkdown(data: {
  generatedAt: string;
  root: string;
  repos: Record<string, unknown>[];
}): string {
  const lines: string[] = [];
  lines.push("# Fleet repo hygiene report");
  lines.push("");
  lines.push(`Generated ${data.generatedAt} by \`scripts/repo-hygiene.ts\` against \`${data.root}\`.`);
  lines.push("Read-only audit: worktrees, code size, dependency freshness, dead-code");
  lines.push("candidates, test-hygiene signals, doc drift and CI flags. Candidate counts");
  lines.push("are heuristics — verify before deleting anything.");
  lines.push("");
  lines.push("| Repo | Fleet | Worktrees (prunable/detached) | Code LOC | Deps | Outdated | Dead exports | Tests | Broken links | Dirty |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  const fleetTotals = { worktrees: 0, prunable: 0, detached: 0, loc: 0, outdated: 0, deadExports: 0, tests: 0 };
  for (const repo of data.repos as any[]) {
    const wt = repo.worktrees ?? {};
    fleetTotals.worktrees += wt.total ?? 0;
    fleetTotals.prunable += wt.prunable ?? 0;
    fleetTotals.detached += wt.detached ?? 0;
    fleetTotals.loc += repo.code?.loc ?? 0;
    fleetTotals.outdated += repo.deps?.outdatedCount ?? 0;
    fleetTotals.deadExports += repo.deadCode?.exportCandidateCount ?? 0;
    fleetTotals.tests += repo.tests?.files ?? 0;
    lines.push(
      `| ${repo.name}${repo.canonicalFleet ? "" : " †"} | ${repo.canonicalFleet ? "yes" : "local"} | ${fmt(wt.total)} (${fmt(wt.prunable)}/${fmt(wt.detached)}) | ${fmt(repo.code?.loc)} | ${fmt(repo.deps?.total)} | ${fmt(repo.deps?.outdatedCount)} | ${fmt(repo.deadCode?.exportCandidateCount)} | ${fmt(repo.tests?.files)} | ${fmt(repo.docs?.brokenLinks)} | ${fmt(repo.dirtyFiles)} |`,
    );
  }
  lines.push("");
  lines.push(
    `Fleet totals: ${fleetTotals.worktrees} worktrees (${fleetTotals.prunable} prunable, ${fleetTotals.detached} detached), ${fleetTotals.loc.toLocaleString("en-US")} code LOC, ${fleetTotals.outdated} outdated deps, ${fleetTotals.deadExports} dead-export candidates, ${fleetTotals.tests} test files. † = local checkout not in DOCTOR_REPOS.`,
  );
  lines.push("");
  for (const repo of data.repos as any[]) {
    lines.push(`## ${repo.name}`);
    lines.push("");
    lines.push(
      `- HEAD \`${repo.headBranch ?? "?"}\` @ \`${repo.headSha ?? "?"}\` (${repo.lastCommitAt ?? "?"}), default \`${repo.defaultBranch ?? "?"}\`, ${repo.dirtyFiles} dirty files`,
    );
    const deps = repo.deps ?? {};
    lines.push(
      `- Deps: ${deps.total ?? 0} declared across ${repo.manifests} manifests; stale check: ${deps.checkedWith ?? "none"} → ${deps.outdatedCount ?? 0} outdated (${deps.majorsBehind ?? 0} majors behind); lockfile drift: ${deps.lockfileDrift ? `${deps.lockfileDrift.updating} updates / ${deps.lockfileDrift.adding} adds / ${deps.lockfileDrift.removing} removals` : "n/a"}; ${deps.possiblyUnusedDeps ?? 0} possibly-unused; update automation: ${deps.updateAutomation ?? "none found"}`,
    );
    for (const u of (deps.possiblyUnusedDepExamples ?? []).slice(0, 5)) {
      lines.push(`  - possibly unused dep: \`${u.name}\` (${u.manifest})`);
    }
    if ((deps.examples ?? []).length) {
      lines.push(`  - e.g. ${deps.examples.slice(0, 5).map((d: any) => `${d.name} ${d.current}→${d.latest}`).join(", ")}`);
    }
    const dc = repo.deadCode ?? {};
    lines.push(
      `- Dead code: ${dc.exportCandidateCount ?? 0} unique-name exports with no external identifier reference; ${dc.unusedImportFiles ?? 0} files with fully-unused imports (${dc.unusedImports ?? 0} statements); TODO/FIXME: ${dc.todoFixmeCount ?? 0}${dc.rustAllowDeadCode ? `; #[allow(dead_code)]: ${dc.rustAllowDeadCode}` : ""}`,
    );
    for (const ex of (dc.exportCandidates ?? []).slice(0, 5)) {
      lines.push(`  - \`${ex.file}\` exports \`${ex.name}\` (${ex.kind})`);
    }
    const tests = repo.tests ?? {};
    lines.push(
      `- Tests: ${tests.files ?? 0} files${tests.rustTestFns ? `, ~${tests.rustTestFns} #[test] fns` : ""}; skipped ${tests.skipped ?? 0}; sleep/timeout signals ${tests.sleepSignals ?? 0}; network-call refs ${tests.networkCallRefs ?? 0}`,
    );
    const docs = repo.docs ?? {};
    lines.push(
      `- Docs: ${docs.markdownFiles ?? 0} markdown files; ${docs.brokenLinks ?? 0} broken relative links; ${docs.missingScriptRefs ?? 0} doc-referenced scripts missing from package.json`,
    );
    for (const link of (docs.linkExamples ?? []).slice(0, 3)) {
      lines.push(`  - broken link: \`${link.doc}\` → \`${link.target}\``);
    }
    for (const ref of (docs.scriptExamples ?? []).slice(0, 3)) {
      lines.push(`  - missing script: \`${ref.doc}\` → \`${ref.ref}\``);
    }
    const ci = repo.ci ?? {};
    if ((ci.pullRequestTargetRefs ?? 0) > 0 || (ci.workflows ?? 0) > 0) {
      lines.push(`- CI: ${ci.workflows} workflows; pull_request_target refs: ${ci.pullRequestTargetRefs ?? 0}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function defaultRoot(): string {
  // From a linked worktree, .git is a file pointing at <main>/.git/worktrees/<id>.
  // The fleet root is the parent of the main checkout directory.
  try {
    const dotgit = join(REPO_ROOT, ".git");
    if (existsSync(dotgit) && !existsSync(join(dotgit, "HEAD"))) {
      const pointer = readFileSync(dotgit, "utf8");
      const m = pointer.match(/gitdir:\s*(.+)/);
      if (m) {
        // <main>/.git/worktrees/<id> -> <main>/.git -> <main> -> fleet root
        const mainCheckout = dirname(resolve(m[1]!.trim(), "..", ".."));
        return dirname(mainCheckout);
      }
    }
    if (existsSync(join(dotgit, "HEAD"))) return dirname(REPO_ROOT);
  } catch {
    /* fall through */
  }
  return dirname(REPO_ROOT);
}

async function main() {
  const args = process.argv.slice(2);
  let root: string | null = null;
  let mdOut: string | null = null;
  let reposFilter: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i]!;
    else if (args[i] === "--md") mdOut = args[++i]!;
    else if (args[i] === "--repos") reposFilter = args[++i]!.split(",");
    else if (args[i] === "--json" || args[i] === "--help" || args[i] === "-h") {
      if (args[i] !== "--json") {
        console.log("Usage: bun scripts/repo-hygiene.ts [--root DIR] [--repos a,b] [--md FILE] [--json]");
        process.exit(0);
      }
    }
  }
  root = resolve(root ?? defaultRoot());

  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isDirectory())
    .map((e) => join(root, e.name))
    .filter((p) => existsSync(join(p, ".git")));
  const selected = reposFilter
    ? candidates.filter((p) => reposFilter!.some((f) => basename(p).includes(f)))
    : candidates;

  // Never inspect a checkout unless GitHub confirms its organization repo is public.
  const visibility = await pool(selected, 3, async (path) => {
    try {
      return (await run("gh", ["api", `repos/ashlrai/${basename(path)}`, "--jq", ".visibility"])).trim() === "public";
    } catch {
      return false;
    }
  });
  const publicRepos = selected.filter((_, index) => visibility[index]);
  const repos = await pool(publicRepos, 3, collectRepo);
  const data = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root,
    repos,
  };
  if (mdOut) {
    await writeFile(mdOut, renderMarkdown(data), "utf8");
  }
  console.log(JSON.stringify(data, null, 2));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`repo-hygiene failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
