import type { ServiceEntry } from "../config.ts";

export type ProviderCategory =
  | "database"
  | "deploy"
  | "cloud"
  | "analytics"
  | "observability"
  | "errors"
  | "ai"
  | "payments"
  | "code"
  | "tickets"
  | "email"
  | "auth"
  | "featureflags"
  | "comms";

export type AuthKind = "oauth_pkce" | "oauth_device" | "pat" | "api_key" | "cli_shell";

export interface ProviderContext {
  cwd: string;
  /** If non-interactive (CI, agent), providers should fail fast instead of prompting. */
  interactive: boolean;
  /** Structured logger — callers wire this to the CLI's @clack spinner. */
  log: (event: LogEvent) => void;
}

export interface LogEvent {
  level: "info" | "warn" | "error";
  msg: string;
  data?: Record<string, unknown>;
}

export interface AuthHandle {
  /** Opaque, provider-specific. Usually an access token or PAT. */
  token: string;
  /** Optional provider-side identity (user id, email, org id). */
  identity?: Record<string, string>;
  /** Epoch ms when token expires. Omit if non-expiring. */
  expiresAt?: number;
}

export interface ProvisionOpts {
  /** If the user already has a resource on the provider side, use this instead of creating. */
  existingResourceId?: string;
  /** Provider-specific provisioning hints (region, tier, org). */
  hints?: Record<string, unknown>;
}

export interface Resource {
  id: string;
  displayName: string;
  region?: string;
  /** Provider-specific fields persisted into .stack.toml meta. */
  meta?: Record<string, unknown>;
}

export interface Materialized {
  /** Secrets to store in Phantom vault. Key is the .env name, value is the real secret. */
  secrets: Record<string, string>;
  /** Optional MCP server entry to merge into .mcp.json. */
  mcp?: McpServerEntry;
  /** Environment URLs or hints to expose in `stack status`. */
  urls?: Record<string, string>;
}

export interface McpServerEntry {
  name: string;
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export type HealthStatus =
  | { kind: "ok"; latencyMs?: number; detail?: string }
  | { kind: "warn"; detail: string }
  | { kind: "error"; detail: string };

export interface Provider {
  name: string;
  displayName: string;
  category: ProviderCategory;
  authKind: AuthKind;
  /** Human-readable docs URL for when something goes wrong. */
  docs?: string;

  login(ctx: ProviderContext): Promise<AuthHandle>;
  provision(ctx: ProviderContext, auth: AuthHandle, opts: ProvisionOpts): Promise<Resource>;
  materialize(ctx: ProviderContext, resource: Resource, auth: AuthHandle): Promise<Materialized>;

  healthcheck?(ctx: ProviderContext, entry: ServiceEntry): Promise<HealthStatus>;
  dashboardUrl?(entry: ServiceEntry): string;

  /**
   * Tear down an upstream resource created by `provision`. Used by `addService`
   * to roll back on partial failure. Optional — if the provider doesn't
   * implement it, the dangling resource is logged and the user is directed to
   * `stack doctor --fix`.
   */
  deprovision?(ctx: ProviderContext, auth: AuthHandle, resourceId: string): Promise<void>;
}
