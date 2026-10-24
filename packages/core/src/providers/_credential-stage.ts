import { resolve } from "node:path";
import { StackError } from "../errors.ts";
import { addSecret, revealSecret } from "../phantom.ts";
import type { ProviderContext, Resource } from "./_base.ts";

type Phase = "login" | "provision" | "critical" | "materialize" | "commit";
interface Scope {
  cwd: string;
  phase: Phase;
  inputs: Map<string, string>;
  candidates: Map<string, string>;
  existing: Map<string, string>;
  critical: Map<Resource, Map<string, string>>;
  createdCritical: Map<string, string>;
}
const scopes = new WeakMap<ProviderContext, Scope>();
// Keep only a no-values tombstone after disposal: a retained operation context
// must never fall through to standalone persistence after its operation ends.
const managed = new WeakSet<ProviderContext>();

function active(ctx: ProviderContext): Scope | undefined {
  const scope = scopes.get(ctx);
  if (!scope && managed.has(ctx)) {
    throw new StackError("CREDENTIAL_SCOPE_CLOSED", "Credential operation has already ended.");
  }
  return scope;
}
function required(ctx: ProviderContext): Scope {
  const scope = active(ctx);
  if (!scope) throw new StackError("CREDENTIAL_SCOPE_REQUIRED", "Credential operation is missing.");
  return scope;
}
function conflict(): never {
  throw new StackError(
    "CREDENTIAL_INPUT_CONFLICT",
    "Credential inputs disagree for one secret slot.",
  );
}
function validate(value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new StackError(
      "PHANTOM_SECRET_VALUE_UNSUPPORTED",
      "Phantom Secrets accepts one line per secret; CR/LF values cannot be stored unchanged.",
    );
  }
}
function merge(inputs: Map<string, string>, key: string, value: string): void {
  validate(value);
  if (inputs.has(key) && inputs.get(key) !== value) conflict();
  inputs.set(key, value);
}

/** Internal source coordination only; no public receipt or vault attestation. */
export function beginCredentialStage(ctx: ProviderContext): void {
  if (managed.has(ctx)) {
    throw new StackError("CREDENTIAL_SCOPE_CLOSED", "Credential context cannot be reused.");
  }
  managed.add(ctx);
  scopes.set(ctx, {
    cwd: resolve(ctx.cwd),
    phase: "login",
    inputs: new Map(),
    candidates: new Map(),
    existing: new Map(),
    critical: new Map(),
    createdCritical: new Map(),
  });
}
export function credentialPhase(ctx: ProviderContext, phase: Phase): void {
  const scope = required(ctx);
  scope.candidates.clear();
  scope.phase = phase;
}
export function closeCredentialStage(ctx: ProviderContext): void {
  const scope = scopes.get(ctx);
  if (!scope) return;
  scope.inputs.clear();
  scope.candidates.clear();
  scope.existing.clear();
  for (const values of scope.critical.values()) values.clear();
  scope.critical.clear();
  scope.createdCritical.clear();
  scopes.delete(ctx);
}

export async function readProviderSecret(ctx: ProviderContext, key: string): Promise<string> {
  const scope = active(ctx);
  const value = await revealSecret(key, scope?.cwd ?? ctx.cwd);
  if (scope) {
    if (active(ctx) !== scope) {
      throw new StackError("CREDENTIAL_SCOPE_CLOSED", "Credential operation has already ended.");
    }
    if (scope.phase === "login" && value) scope.candidates.set(key, value);
  }
  return value;
}
/** Called only by the original cached branch after its fresh verifier succeeds.
 * Exact input equality authorizes omitting this operation's duplicate create;
 * it does not attest a concurrently unchanged vault or authenticate arbitrary JS.
 */
export function acceptVerifiedExisting(ctx: ProviderContext, key: string, value: string): void {
  const scope = active(ctx);
  if (!scope) return;
  if (scope.phase !== "login" || scope.candidates.get(key) !== value) {
    throw new StackError(
      "CREDENTIAL_EXISTING_UNCONFIRMED",
      "Existing credential was not verified in this login.",
    );
  }
  if (scope.inputs.has(key) && scope.inputs.get(key) !== value) conflict();
  scope.existing.set(key, value);
  scope.candidates.delete(key);
}

async function createCredential(key: string, value: string, cwd: string): Promise<void> {
  try {
    await addSecret(key, value, cwd);
  } catch (err) {
    // Producer output can contain input values. Preserve a recognized refusal
    // code, never its raw message/cause or an upstream-derived secret name.
    const code = err instanceof StackError ? err.code : "PHANTOM_EXEC_FAILED";
    throw new StackError(
      code,
      code === "PHANTOM_SECRET_EXISTS"
        ? "Credential storage was refused; the secret name already exists."
        : "Credential storage could not be confirmed.",
    );
  }
}
export async function commitOrdinaryCredential(
  ctx: ProviderContext,
  key: string,
  value: string,
): Promise<void> {
  const scope = required(ctx);
  if (scope.phase !== "commit") {
    throw new StackError("CREDENTIAL_PHASE_CLOSED", "Credential commit is not active.");
  }
  await createCredential(key, value, scope.cwd);
}

export async function storeProviderSecret(
  ctx: ProviderContext,
  key: string,
  value: string,
): Promise<void> {
  const scope = active(ctx);
  if (!scope) return createCredential(key, value, ctx.cwd);
  if (scope.phase !== "login" && scope.phase !== "provision" && scope.phase !== "materialize") {
    throw new StackError("CREDENTIAL_PHASE_CLOSED", "Credential input collection has ended.");
  }
  if (scope.existing.has(key) && scope.existing.get(key) !== value) conflict();
  merge(scope.inputs, key, value);
}

/** The generated password is not recoverable from the API. Carry it privately
 * on the exact returned resource until the pipeline owns failure cleanup.
 * Standalone provision retains its immediate strict persistence contract.
 */
export async function carryResourceCredential(
  ctx: ProviderContext,
  resource: Resource,
  key: string,
  value: string,
): Promise<void> {
  const scope = active(ctx);
  if (!scope) return createCredential(key, value, ctx.cwd);
  if (scope.phase !== "provision") {
    throw new StackError("CREDENTIAL_PHASE_CLOSED", "Resource credential collection has ended.");
  }
  let values = scope.critical.get(resource);
  if (!values) {
    values = new Map();
    scope.critical.set(resource, values);
  }
  merge(values, key, value);
}
export async function commitResourceCredentials(
  ctx: ProviderContext,
  resource: Resource,
  created: (key: string) => void,
): Promise<void> {
  const scope = required(ctx);
  if (scope.phase !== "critical") {
    throw new StackError("CREDENTIAL_PHASE_CLOSED", "Resource credential commit is not active.");
  }
  const values = scope.critical.get(resource);
  if (!values) return;
  // Take once before the first await. Refusal or unknown completion is never
  // converted into a successful write or retried from this private carry.
  scope.critical.delete(resource);
  try {
    for (const [key, value] of values) {
      if (scope.inputs.has(key) && scope.inputs.get(key) !== value) conflict();
      if (scope.existing.has(key) || scope.createdCritical.has(key)) conflict();
      try {
        await addSecret(key, value, scope.cwd);
      } catch {
        // The generated name includes an upstream identifier. Do not reflect
        // that name, producer output or the password into a failure diagnostic.
        throw new StackError(
          "RESOURCE_CREDENTIAL_UNCONFIRMED",
          "Resource credential storage was refused or could not be confirmed.",
        );
      }
      scope.createdCritical.set(key, value);
      created(key);
    }
  } finally {
    values.clear();
  }
}

/** Validate the entire ordinary plan before its first create. Critical resource
 * writes necessarily precede materialize; a later conflict uses owned rollback.
 * Materialized slots stay first; auth-only slots follow, before MCP/config.
 */
export function ordinaryCredentialPlan(
  ctx: ProviderContext,
  materialized: Record<string, string>,
): Array<[string, string]> {
  const scope = required(ctx);
  const plan = new Map<string, string>();
  for (const [key, value] of Object.entries(materialized)) merge(plan, key, value);
  for (const [key, value] of scope.inputs) merge(plan, key, value);
  for (const [key, value] of plan) {
    if (scope.existing.has(key)) {
      if (scope.existing.get(key) !== value) conflict();
      plan.delete(key);
    }
    if (scope.createdCritical.has(key)) {
      if (scope.createdCritical.get(key) !== value) conflict();
      plan.delete(key);
    }
  }
  return [...plan];
}
