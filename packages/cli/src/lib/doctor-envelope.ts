/**
 * `ashlr.doctor` v1 wrapper for `stack doctor --json` (docs/ashlr-handshake.md,
 * "Doctor JSON"). Additive: the object Stack printed before keeps every field;
 * the wrapper adds kind, schema_version, tool, status (ok | warn | fail),
 * native_status (Stack's own label) and checks. Exit codes do not change.
 */
import type { EcosystemEntry } from "./ecosystem.ts";

export type DoctorStatus = "ok" | "warn" | "fail";
export interface DoctorCheck {
  id?: string;
  status: "ok" | "warn" | "fail" | "info";
  summary: string;
}

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "check";

/** Worst status among checks (info counts as ok). */
export function worst(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

export function envelope<T extends object>(
  native: T,
  status: DoctorStatus,
  nativeStatus: string,
  checks: DoctorCheck[],
): T & {
  kind: "ashlr.doctor";
  schema_version: 1;
  tool: "ashlr-stack";
  status: DoctorStatus;
  native_status: string;
  checks: DoctorCheck[];
} {
  return {
    ...native,
    kind: "ashlr.doctor",
    schema_version: 1,
    tool: "ashlr-stack",
    status,
    native_status: nativeStatus,
    checks,
  };
}

/** `{ error }` outputs: a refusal or a precondition that stopped the run. */
export function errorEnvelope(message: string) {
  return envelope({ error: message }, "fail", "error", [
    { id: "stack-doctor", status: "fail", summary: message },
  ]);
}

/** Service reachability reports. error -> fail; warn and unchecked -> warn. */
export function reportsEnvelope<
  T extends {
    reports: Array<{
      project: string;
      services: Array<{ name: string; status: string; detail?: string }>;
    }>;
  },
>(native: T, preflightRefused: boolean) {
  const checks: DoctorCheck[] = [];
  for (const r of native.reports) {
    for (const s of r.services) {
      const status = s.status === "error" ? "fail" : s.status === "ok" ? "ok" : "warn";
      checks.push({
        id: kebab(`${r.project}-${s.name}`),
        status,
        summary: `${s.name}: ${s.status}${s.detail ? ` (${s.detail})` : ""}`,
      });
    }
  }
  if (preflightRefused)
    checks.push({ id: "phantom-preflight", status: "fail", summary: "phantom preflight refused" });
  // Nothing was checked: not "healthy" (matches the human output).
  if (checks.length === 0)
    checks.push({ id: "no-services", status: "warn", summary: "no services to check" });
  const status = worst(checks);
  return envelope(native, status, status === "fail" ? "failed" : "passed", checks);
}

/** `--ecosystem`: informational; contract drift is a warning, never a failure. */
export function ecosystemEnvelope<T extends { ecosystem: EcosystemEntry[] }>(native: T) {
  const checks: DoctorCheck[] = native.ecosystem.map((e) => ({
    id: kebab(e.name),
    status: e.status === "ok" ? (e.contract === "drift" ? "warn" : "ok") : "info",
    summary:
      e.status === "ok"
        ? `${e.name} ${e.version ?? "?"}${e.contract === "drift" ? " (contract drift)" : ""}`
        : `${e.name}: ${e.detail ?? e.status}`,
  }));
  return envelope(native, worst(checks), "informational", checks);
}

/** `--ecosystem --fix`: a run that stopped at a tool is fail. */
export function fixEnvelope<
  T extends {
    mode: string;
    stopped_at: string | null;
    tools: Array<{ tool: string; outcome: string; detail?: string }>;
  },
>(native: T) {
  const checks: DoctorCheck[] = native.tools.map((t) => ({
    id: kebab(t.tool),
    status:
      native.stopped_at === t.tool ? "fail" : t.outcome === "preview_failed" ? "warn" : "info",
    summary: `${t.tool}: ${t.outcome}${t.detail ? ` (${t.detail})` : ""}`,
  }));
  return envelope(native, native.stopped_at ? "fail" : "ok", native.mode, checks);
}

/** `--ecosystem --install`: blocked or failed steps are fail; manual steps warn. */
export function installEnvelope<
  T extends {
    mode: string;
    plan: { steps: Array<{ tool: string; reason: string; outcome: string; detail?: string }> };
    outcome: { stopped_at: string | null } | null;
  },
>(native: T) {
  const checks: DoctorCheck[] = native.plan.steps.map((s) => ({
    id: kebab(`${s.reason === "verify" ? "verify" : "install"}-${s.tool}`),
    status:
      s.outcome === "failed" || s.outcome === "blocked"
        ? "fail"
        : s.outcome === "manual"
          ? "warn"
          : "info",
    summary: `${s.tool}: ${s.outcome}${s.detail ? ` (${s.detail})` : ""}`,
  }));
  return envelope(native, worst(checks), native.mode, checks);
}

/** `--reconcile`: drift between .stack.toml and source is a warning. */
export function reconcileEnvelope<T extends { orphans: string[]; untracked: string[] }>(native: T) {
  const checks: DoctorCheck[] = [
    ...native.orphans.map((n) => ({
      id: kebab(`orphan-${n}`),
      status: "warn" as const,
      summary: `${n} is configured but not found in source`,
    })),
    ...native.untracked.map((n) => ({
      id: kebab(`untracked-${n}`),
      status: "warn" as const,
      summary: `${n} is used in source but not in .stack.toml`,
    })),
  ];
  const status = worst(checks);
  return envelope(native, status, status === "ok" ? "in-sync" : "drift", checks);
}
