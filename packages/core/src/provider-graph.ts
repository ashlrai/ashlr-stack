/**
 * Cross-Provider Dependency Graph Visualization & Validation Engine
 *
 * Builds a sophisticated provider dependency graph that goes beyond explicit
 * `dependsOn` declarations to infer *implicit* coupling from:
 *   - materialize() output patterns (env vars, MCP entries)
 *   - Known integration contracts (e.g. Clerk ↔ Supabase JWT, Stripe ↔ Supabase webhooks)
 *   - Provider category constraints (e.g. two auth systems cannot coexist)
 *
 * Key entry points:
 *   - `ProviderDependencyGraph`   — core class: build, validate, visualize
 *   - `buildProviderGraph()`      — convenience factory
 *
 * Visualization formats:
 *   - `toDot()`      — Graphviz DOT format  (`stack graph --format dot`)
 *   - `toMermaid()`  — Mermaid flowchart     (`stack graph --format mermaid`)
 *
 * Dry-run integration:
 *   - `toDependencyOrderReport()` — human-readable provision/teardown order for
 *     display inside `stack apply --dry-run`
 */

import type { OrchestrationEntry } from "./orchestration.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Edge kinds that can appear in the dependency graph. */
export type DependencyKind =
  /** Explicit `dependsOn` declaration in orchestration entry. */
  | "explicit"
  /** Inferred from env-var cross-references in materialize() outputs. */
  | "env-ref"
  /** Inferred from known integration contract (e.g. Clerk JWT → Supabase). */
  | "integration"
  /** Inferred from shared MCP server wiring. */
  | "mcp-wiring";

/** A directed edge from one provider to another. */
export interface DependencyEdge {
  /** Provider that must be provisioned first (the dependency). */
  from: string;
  /** Provider that depends on `from`. */
  to: string;
  /** How this dependency was inferred. */
  kind: DependencyKind;
  /** Human-readable explanation. */
  reason: string;
}

/** Severity of a validation finding. */
export type ValidationSeverity = "error" | "warning";

/** A cross-provider validation finding. */
export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  message: string;
  /** Providers involved in this finding (1–2 entries). */
  providers: string[];
}

/**
 * Result of graph validation.
 * `valid` is false if any `error`-severity findings are present.
 */
export interface GraphValidationResult {
  valid: boolean;
  findings: ValidationFinding[];
  /** Whether a circular dependency was detected. */
  hasCircularDependency: boolean;
  /** Providers involved in a cycle (empty when no cycle). */
  cycleMembers: string[];
}

/** A single wave of providers in the provisioning plan. */
export interface ProvisionWave {
  index: number;
  providers: string[];
}

/** Full provision/teardown order report produced for dry-run display. */
export interface DependencyOrderReport {
  provisionWaves: ProvisionWave[];
  /** Reverse of provisionWaves — safe teardown order. */
  teardownWaves: ProvisionWave[];
  /** Ordered provider names for provision (flat). */
  provisionOrder: string[];
  /** Ordered provider names for teardown (flat). */
  teardownOrder: string[];
  /** Edges in the graph (both explicit and inferred). */
  edges: DependencyEdge[];
  /** Total number of providers. */
  providerCount: number;
}

// ---------------------------------------------------------------------------
// Known integration contracts
// ---------------------------------------------------------------------------

/**
 * Describes a known cross-provider integration pattern. When both `source`
 * and `target` are present in the graph, `edge` is automatically inferred.
 */
interface KnownIntegration {
  source: string;
  target: string;
  reason: string;
}

/**
 * Static registry of well-known cross-provider integration contracts.
 *
 * These represent implicit coupling that users might not think to declare
 * explicitly — e.g., Clerk using Supabase as its user database, or Stripe
 * sending webhooks to a Supabase edge function.
 */
const KNOWN_INTEGRATIONS: KnownIntegration[] = [
  // Auth ↔ Database coupling
  {
    source: "supabase",
    target: "clerk",
    reason: "Clerk commonly uses Supabase as its user database via JWT integration",
  },
  {
    source: "supabase",
    target: "auth0",
    reason: "Auth0 rule/action pipelines commonly write to Supabase user tables",
  },
  {
    source: "supabase",
    target: "workos",
    reason: "WorkOS directory sync commonly writes to Supabase organization tables",
  },
  // Payments ↔ Database coupling
  {
    source: "supabase",
    target: "stripe",
    reason: "Stripe webhooks commonly update Supabase subscription/entitlement tables",
  },
  {
    source: "neon",
    target: "stripe",
    reason: "Stripe webhooks commonly update Neon subscription tables",
  },
  {
    source: "turso",
    target: "stripe",
    reason: "Stripe webhooks commonly update Turso subscription tables",
  },
  // Email ↔ Auth coupling
  {
    source: "clerk",
    target: "resend",
    reason: "Clerk custom email delivery is often delegated to Resend",
  },
  {
    source: "clerk",
    target: "sendgrid",
    reason: "Clerk custom email delivery is often delegated to SendGrid",
  },
  {
    source: "clerk",
    target: "mailgun",
    reason: "Clerk custom email delivery is often delegated to Mailgun",
  },
  // Observability ↔ Deploy coupling
  {
    source: "vercel",
    target: "sentry",
    reason: "Sentry source maps are uploaded during Vercel deploys",
  },
  {
    source: "vercel",
    target: "posthog",
    reason: "PostHog is injected via Vercel middleware/edge config",
  },
  {
    source: "vercel",
    target: "datadog",
    reason: "Datadog APM agent is configured via Vercel integration",
  },
  // Feature flags ↔ Deploy
  {
    source: "vercel",
    target: "launchdarkly",
    reason: "LaunchDarkly edge flags commonly run in Vercel Edge Config",
  },
  // AI ↔ Storage coupling
  {
    source: "supabase",
    target: "openai",
    reason: "OpenAI embeddings are commonly stored in Supabase pgvector",
  },
  {
    source: "supabase",
    target: "anthropic",
    reason: "Anthropic tool results are commonly persisted to Supabase",
  },
  // Cache ↔ App server
  {
    source: "upstash",
    target: "vercel",
    reason: "Upstash Redis is commonly used as Vercel Edge cache / rate-limit store",
  },
  {
    source: "upstash",
    target: "railway",
    reason: "Upstash Redis is commonly used as Railway app cache / session store",
  },
  // Monitoring ↔ Database
  {
    source: "grafana",
    target: "supabase",
    reason: "Grafana Loki/Prometheus is often pointed at Supabase metrics endpoints",
  },
  // CI/CD coupling
  {
    source: "github",
    target: "vercel",
    reason: "Vercel GitHub integration triggers deploys on git push",
  },
  {
    source: "github",
    target: "railway",
    reason: "Railway GitHub integration triggers deploys on git push",
  },
  {
    source: "github",
    target: "fly",
    reason: "Fly.io GitHub Actions deploy workflow requires GitHub integration",
  },
];

// ---------------------------------------------------------------------------
// Conflict rules — providers that cannot coexist
// ---------------------------------------------------------------------------

interface ConflictRule {
  /** Providers within this set are mutually exclusive. */
  providers: string[];
  code: string;
  message: (a: string, b: string) => string;
}

/**
 * Cross-provider conflict rules.
 * Two providers in the same `providers` set trigger an error-severity finding.
 */
const CONFLICT_RULES: ConflictRule[] = [
  {
    providers: ["clerk", "auth0", "workos", "firebase"],
    code: "DUAL_AUTH_SYSTEM",
    message: (a, b) =>
      `Providers "${a}" and "${b}" are both authentication systems. ` +
      `Running two auth systems simultaneously creates conflicting user sessions and JWT issuers. ` +
      `Remove one or split them across separate applications.`,
  },
  {
    providers: ["supabase", "neon", "turso", "firebase", "convex"],
    code: "DUAL_DATABASE",
    message: (a, b) =>
      `Providers "${a}" and "${b}" are both primary database providers. ` +
      `Using two database systems in the same stack adds unnecessary complexity. ` +
      `Consider consolidating to one or explicitly partitioning your data model.`,
  },
  {
    providers: ["resend", "sendgrid", "mailgun", "postmark"],
    code: "DUAL_EMAIL_PROVIDER",
    message: (a, b) =>
      `Providers "${a}" and "${b}" are both transactional email providers. ` +
      `Routing emails through two services causes split delivery tracking and duplicate costs.`,
  },
];

// ---------------------------------------------------------------------------
// Env-var coupling inference
// ---------------------------------------------------------------------------

/**
 * Maps provider names to the env-var prefixes their materialize() outputs
 * typically expose. Used to infer implicit coupling when another provider's
 * hints or known patterns reference these vars.
 */
const PROVIDER_ENV_PREFIXES: Record<string, string[]> = {
  supabase: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  neon: ["DATABASE_URL", "NEON_"],
  turso: ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"],
  clerk: ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"],
  upstash: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  resend: ["RESEND_API_KEY"],
  sendgrid: ["SENDGRID_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  github: ["GITHUB_TOKEN"],
  sentry: ["SENTRY_DSN", "SENTRY_AUTH_TOKEN"],
  posthog: ["POSTHOG_KEY", "POSTHOG_HOST"],
  vercel: ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"],
};

/**
 * Check whether `providerB` likely references env vars produced by `providerA`
 * via explicit hints in the entry.
 */
function inferEnvRefDependency(
  entryA: OrchestrationEntry,
  entryB: OrchestrationEntry,
): string | null {
  const prefixes = PROVIDER_ENV_PREFIXES[entryA.providerName];
  if (!prefixes || !entryB.opts?.hints) return null;

  const hintsJson = JSON.stringify(entryB.opts.hints);
  for (const prefix of prefixes) {
    if (hintsJson.includes(prefix)) {
      return `Entry "${entryB.providerName}" hints reference env vars from "${entryA.providerName}" (${prefix}...)`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ProviderDependencyGraph
// ---------------------------------------------------------------------------

/**
 * Options for constructing a ProviderDependencyGraph.
 */
export interface ProviderDependencyGraphOptions {
  /**
   * When true, infer implicit integration edges from the known-integration
   * registry. Defaults to true.
   */
  inferIntegrations?: boolean;
  /**
   * When true, infer env-var coupling from entry hints. Defaults to true.
   */
  inferEnvRefs?: boolean;
  /**
   * Provider names to treat as the "root" of the graph (no dependencies).
   * Defaults to providers with no explicit dependsOn.
   */
  roots?: string[];
}

/**
 * Core provider dependency graph.
 *
 * Reads an orchestration config (array of OrchestrationEntry), infers implicit
 * coupling, and exposes validation, visualization, and ordering APIs.
 *
 * Usage:
 *   const graph = new ProviderDependencyGraph(entries);
 *   const { valid, findings } = graph.validate();
 *   console.log(graph.toMermaid());
 *   const report = graph.toDependencyOrderReport();
 */
export class ProviderDependencyGraph {
  private readonly _entries: OrchestrationEntry[];
  private readonly _edges: DependencyEdge[];
  private readonly _opts: Required<ProviderDependencyGraphOptions>;

  constructor(
    entries: OrchestrationEntry[],
    opts: ProviderDependencyGraphOptions = {},
  ) {
    this._entries = entries;
    this._opts = {
      inferIntegrations: opts.inferIntegrations ?? true,
      inferEnvRefs: opts.inferEnvRefs ?? true,
      roots: opts.roots ?? [],
    };
    this._edges = this._buildEdges();
  }

  // -------------------------------------------------------------------------
  // Edge construction
  // -------------------------------------------------------------------------

  /** Build all edges: explicit + inferred. */
  private _buildEdges(): DependencyEdge[] {
    const edges: DependencyEdge[] = [];
    const names = new Set(this._entries.map((e) => e.providerName));

    // 1. Explicit edges from dependsOn declarations
    for (const entry of this._entries) {
      for (const dep of entry.dependsOn ?? []) {
        edges.push({
          from: dep,
          to: entry.providerName,
          kind: "explicit",
          reason: `"${entry.providerName}" explicitly declares dependsOn: ["${dep}"]`,
        });
      }
    }

    // 2. Known integration edges
    if (this._opts.inferIntegrations) {
      for (const integration of KNOWN_INTEGRATIONS) {
        if (names.has(integration.source) && names.has(integration.target)) {
          // Only add if not already covered by an explicit edge
          const alreadyExplicit = edges.some(
            (e) =>
              e.from === integration.source &&
              e.to === integration.target &&
              e.kind === "explicit",
          );
          if (!alreadyExplicit) {
            edges.push({
              from: integration.source,
              to: integration.target,
              kind: "integration",
              reason: integration.reason,
            });
          }
        }
      }
    }

    // 3. Env-var reference edges
    if (this._opts.inferEnvRefs) {
      for (const entryA of this._entries) {
        for (const entryB of this._entries) {
          if (entryA.providerName === entryB.providerName) continue;
          const reason = inferEnvRefDependency(entryA, entryB);
          if (reason) {
            const alreadyPresent = edges.some(
              (e) => e.from === entryA.providerName && e.to === entryB.providerName,
            );
            if (!alreadyPresent) {
              edges.push({
                from: entryA.providerName,
                to: entryB.providerName,
                kind: "env-ref",
                reason,
              });
            }
          }
        }
      }
    }

    return edges;
  }

  // -------------------------------------------------------------------------
  // Graph accessors
  // -------------------------------------------------------------------------

  /** All edges in the graph (explicit + inferred). */
  get edges(): DependencyEdge[] {
    return [...this._edges];
  }

  /** All provider names in the graph. */
  get providers(): string[] {
    return this._entries.map((e) => e.providerName);
  }

  /** Direct dependencies of a provider (what it depends ON). */
  dependenciesOf(provider: string): string[] {
    return this._edges.filter((e) => e.to === provider).map((e) => e.from);
  }

  /** Direct dependents of a provider (providers that depend ON it). */
  dependentsOf(provider: string): string[] {
    return this._edges.filter((e) => e.from === provider).map((e) => e.to);
  }

  // -------------------------------------------------------------------------
  // Cycle detection (DFS)
  // -------------------------------------------------------------------------

  /**
   * Detect circular dependencies using DFS with coloring.
   * Returns the cycle members (in visit order) or an empty array if no cycle.
   */
  detectCycles(): string[] {
    const WHITE = 0; // unvisited
    const GRAY = 1;  // in current DFS stack
    const BLACK = 2; // fully processed

    const color = new Map<string, number>();
    const providers = this.providers;

    for (const p of providers) color.set(p, WHITE);

    const cycleMembers: string[] = [];

    const dfs = (node: string, path: string[]): boolean => {
      color.set(node, GRAY);
      for (const dep of this.dependentsOf(node)) {
        if (!color.has(dep)) continue;
        if (color.get(dep) === GRAY) {
          // Found a cycle — collect path from where we see the repeated node.
          // path.slice(cycleStart) already includes `dep` at path[cycleStart],
          // so do NOT append it again or the report duplicates the start node.
          const cycleStart = path.indexOf(dep);
          cycleMembers.push(...path.slice(cycleStart));
          return true;
        }
        if (color.get(dep) === WHITE) {
          if (dfs(dep, [...path, dep])) return true;
        }
      }
      color.set(node, BLACK);
      return false;
    };

    for (const p of providers) {
      if (color.get(p) === WHITE) {
        if (dfs(p, [p])) break;
      }
    }

    return cycleMembers;
  }

  // -------------------------------------------------------------------------
  // Topological ordering (Kahn's algorithm on the full edge set)
  // -------------------------------------------------------------------------

  /**
   * Compute a topological provision order using all edges (explicit + inferred).
   * Returns null if a cycle is detected.
   */
  topologicalOrder(): string[] | null {
    const providers = this.providers;
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>(); // from → [to]

    for (const p of providers) {
      inDegree.set(p, 0);
      adj.set(p, []);
    }

    for (const edge of this._edges) {
      adj.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    const queue = providers.filter((p) => (inDegree.get(p) ?? 0) === 0).sort();
    const order: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const neighbor of (adj.get(node) ?? []).sort()) {
        const deg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) {
          queue.push(neighbor);
          queue.sort();
        }
      }
    }

    return order.length === providers.length ? order : null;
  }

  /**
   * Compute wave-based provision schedule (Kahn's with wave tracking).
   * Returns null if a cycle prevents scheduling.
   */
  provisionWaves(): ProvisionWave[] | null {
    const providers = this.providers;
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const p of providers) {
      inDegree.set(p, 0);
      adj.set(p, []);
    }

    for (const edge of this._edges) {
      adj.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    const waves: ProvisionWave[] = [];
    const processed = new Set<string>();

    let waveIndex = 0;
    while (processed.size < providers.length) {
      const wave = providers
        .filter((p) => !processed.has(p) && (inDegree.get(p) ?? 0) === 0)
        .sort();

      if (wave.length === 0) return null; // cycle

      waves.push({ index: waveIndex, providers: wave });
      for (const name of wave) {
        processed.add(name);
        for (const neighbor of adj.get(name) ?? []) {
          inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) - 1);
        }
      }
      waveIndex++;
    }

    return waves;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate the dependency graph for:
   *   1. Circular dependencies
   *   2. Conflicting provider pairs (two auth systems, two databases, etc.)
   *   3. Unsafe teardown order (cyclic teardown path)
   */
  validate(): GraphValidationResult {
    const findings: ValidationFinding[] = [];

    // 1. Cycle detection
    const cycleMembers = this.detectCycles();
    const hasCircularDependency = cycleMembers.length > 0;

    if (hasCircularDependency) {
      findings.push({
        severity: "error",
        code: "CIRCULAR_DEPENDENCY",
        message:
          `Circular dependency detected among providers: ${cycleMembers.join(" → ")}. ` +
          `Circular dependencies prevent safe provision and teardown ordering. ` +
          `Review your dependsOn declarations and remove the cycle.`,
        providers: [...new Set(cycleMembers)],
      });
    }

    // 2. Provider conflict rules
    const providerSet = new Set(this.providers);
    for (const rule of CONFLICT_RULES) {
      const present = rule.providers.filter((p) => providerSet.has(p));
      // Report each conflicting pair
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          findings.push({
            severity: "error",
            code: rule.code,
            message: rule.message(present[i], present[j]),
            providers: [present[i], present[j]],
          });
        }
      }
    }

    // 3. Unsafe teardown order (only if no cycle — cycle already reported)
    if (!hasCircularDependency) {
      const order = this.topologicalOrder();
      if (order === null) {
        findings.push({
          severity: "error",
          code: "UNSAFE_TEARDOWN_ORDER",
          message:
            "Teardown order could not be computed — the dependency graph has a cycle. " +
            "Ensure all dependsOn declarations form a DAG.",
          providers: this.providers,
        });
      }
    }

    // 4. Warning: integration edges that cross explicit dependency boundaries
    const explicitEdges = this._edges.filter((e) => e.kind === "explicit");
    const inferredEdges = this._edges.filter((e) => e.kind !== "explicit");
    for (const inferred of inferredEdges) {
      // If an inferred edge points in the OPPOSITE direction of an explicit edge
      // between the same two providers, that's a potential ordering conflict.
      const reverseExplicit = explicitEdges.find(
        (e) => e.from === inferred.to && e.to === inferred.from,
      );
      if (reverseExplicit) {
        findings.push({
          severity: "warning",
          code: "INFERRED_EDGE_CONFLICTS_EXPLICIT",
          message:
            `An inferred integration dependency (${inferred.from} → ${inferred.to}) ` +
            `conflicts with an explicit dependency (${reverseExplicit.from} → ${reverseExplicit.to}). ` +
            `Reason: ${inferred.reason}. ` +
            `Review whether your explicit ordering is correct.`,
          providers: [inferred.from, inferred.to],
        });
      }
    }

    const valid = !findings.some((f) => f.severity === "error");
    return { valid, findings, hasCircularDependency, cycleMembers };
  }

  // -------------------------------------------------------------------------
  // Visualization: DOT format
  // -------------------------------------------------------------------------

  /**
   * Export the dependency graph as a Graphviz DOT string.
   *
   * Example output:
   *   digraph ProviderGraph {
   *     rankdir=LR;
   *     node [shape=box, style=filled, fillcolor=lightblue];
   *     "supabase" -> "clerk" [label="integration", color=gray];
   *     "clerk"    -> "resend" [label="integration", color=gray];
   *   }
   */
  toDot(): string {
    const lines: string[] = [];
    lines.push("digraph ProviderGraph {");
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box, style=filled, fillcolor=lightblue, fontname="Helvetica"];');
    lines.push('  edge [fontname="Helvetica", fontsize=10];');
    lines.push("");

    // Node declarations with category color coding
    const providerCategories = this._buildProviderCategoryMap();
    const categoryColors: Record<string, string> = {
      auth: "lightyellow",
      database: "lightblue",
      payments: "lightgreen",
      deploy: "lightsalmon",
      email: "lavender",
      ai: "lightyellow",
      analytics: "lightcyan",
      observability: "lightcyan",
      errors: "lightcoral",
      cloud: "lightsalmon",
      featureflags: "lightyellow",
      comms: "lavender",
      code: "lightgray",
      tickets: "lightgray",
      default: "white",
    };

    for (const provider of this.providers.sort()) {
      const cat = providerCategories.get(provider) ?? "default";
      const color = categoryColors[cat] ?? categoryColors.default;
      lines.push(`  "${provider}" [label="${provider}\\n[${cat}]", fillcolor="${color}"];`);
    }
    lines.push("");

    // Edge declarations grouped by kind
    const edgeColors: Record<DependencyKind, string> = {
      explicit: "black",
      integration: "gray",
      "env-ref": "blue",
      "mcp-wiring": "purple",
    };
    const edgeStyles: Record<DependencyKind, string> = {
      explicit: "solid",
      integration: "dashed",
      "env-ref": "dotted",
      "mcp-wiring": "dashed",
    };

    for (const edge of this._edges) {
      const color = edgeColors[edge.kind];
      const style = edgeStyles[edge.kind];
      const escapedReason = edge.reason.replace(/"/g, "'").slice(0, 60);
      lines.push(
        `  "${edge.from}" -> "${edge.to}" [label="${edge.kind}", color="${color}", style="${style}", tooltip="${escapedReason}"];`,
      );
    }

    lines.push("");
    lines.push("  // Legend");
    lines.push('  subgraph cluster_legend {');
    lines.push('    label="Edge kinds";');
    lines.push('    style=dotted;');
    lines.push('    legend_explicit [label="explicit", style=filled, fillcolor=white];');
    lines.push('    legend_integration [label="integration", style=filled, fillcolor=white];');
    lines.push('    legend_envref [label="env-ref", style=filled, fillcolor=white];');
    lines.push("  }");

    lines.push("}");
    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Visualization: Mermaid format
  // -------------------------------------------------------------------------

  /**
   * Export the dependency graph as a Mermaid flowchart string.
   *
   * Suitable for pasting directly into GitHub markdown, Notion, or
   * rendering with mermaid-js.
   *
   * Example:
   *   ```mermaid
   *   flowchart LR
   *     subgraph auth["Auth"]
   *       clerk["clerk"]
   *     end
   *     supabase --> |integration| clerk
   *   ```
   */
  toMermaid(): string {
    const lines: string[] = [];
    lines.push("```mermaid");
    lines.push("flowchart LR");

    // Group nodes by category in subgraphs
    const categoryMap = this._buildProviderCategoryMap();
    const byCategory = new Map<string, string[]>();
    for (const [provider, cat] of categoryMap) {
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(provider);
    }

    // Render subgraphs
    let subgraphIdx = 0;
    for (const [cat, providers] of byCategory) {
      const subgraphId = `sg${subgraphIdx++}`;
      lines.push(`  subgraph ${subgraphId}["${cat}"]`);
      for (const p of providers.sort()) {
        lines.push(`    ${this._mermaidId(p)}["${p}"]`);
      }
      lines.push("  end");
    }

    lines.push("");

    // Edges
    for (const edge of this._edges) {
      const fromId = this._mermaidId(edge.from);
      const toId = this._mermaidId(edge.to);
      const arrowStyle = edge.kind === "explicit" ? "-->" : "-.->";
      lines.push(`  ${fromId} ${arrowStyle} |${edge.kind}| ${toId}`);
    }

    lines.push("```");
    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Dry-run integration: dependency order report
  // -------------------------------------------------------------------------

  /**
   * Build the full dependency order report for `stack apply --dry-run`.
   * Shows provision waves (what gets created first) and teardown waves
   * (reverse order for safe deprovisioning).
   */
  toDependencyOrderReport(): DependencyOrderReport {
    const provisionWaves = this.provisionWaves() ?? [];
    const provisionOrder = provisionWaves.flatMap((w) => w.providers);

    // Teardown is the reverse of provision waves
    const teardownWaves: ProvisionWave[] = [...provisionWaves]
      .reverse()
      .map((w, i) => ({ index: i, providers: [...w.providers] }));
    const teardownOrder = teardownWaves.flatMap((w) => w.providers);

    return {
      provisionWaves,
      teardownWaves,
      provisionOrder,
      teardownOrder,
      edges: [...this._edges],
      providerCount: this.providers.length,
    };
  }

  /**
   * Format the dependency order report as a human-readable string for CLI display.
   * Used by `stack apply --dry-run` to show ordering before provisioning.
   */
  formatDependencyOrderReport(): string {
    const report = this.toDependencyOrderReport();
    const lines: string[] = [];

    lines.push("PROVIDER DEPENDENCY GRAPH — DRY RUN");
    lines.push("═".repeat(60));
    lines.push(`Providers: ${report.providerCount}`);
    lines.push(`Edges:     ${report.edges.length} (${report.edges.filter((e) => e.kind === "explicit").length} explicit, ${report.edges.filter((e) => e.kind !== "explicit").length} inferred)`);
    lines.push("");

    if (report.provisionWaves.length === 0) {
      lines.push("  (no providers — nothing to provision)");
      return lines.join("\n");
    }

    lines.push("PROVISION ORDER");
    lines.push("─".repeat(60));
    for (const wave of report.provisionWaves) {
      const suffix = wave.index === 0 ? " — first" : wave.index === report.provisionWaves.length - 1 ? " — last" : "";
      lines.push(`  Wave ${wave.index}${suffix}: ${wave.providers.join(", ")}`);
    }

    lines.push("");
    lines.push("TEARDOWN ORDER (reverse provision order)");
    lines.push("─".repeat(60));
    for (const wave of report.teardownWaves) {
      const suffix = wave.index === 0 ? " — first (torn down first)" : wave.index === report.teardownWaves.length - 1 ? " — last (torn down last)" : "";
      lines.push(`  Wave ${wave.index}${suffix}: ${wave.providers.join(", ")}`);
    }

    lines.push("");
    lines.push("INFERRED DEPENDENCIES");
    lines.push("─".repeat(60));
    const inferredEdges = report.edges.filter((e) => e.kind !== "explicit");
    if (inferredEdges.length === 0) {
      lines.push("  (none — all dependencies are explicit)");
    } else {
      for (const edge of inferredEdges) {
        lines.push(`  ${edge.from} → ${edge.to}  [${edge.kind}]`);
        lines.push(`    ${edge.reason}`);
      }
    }

    lines.push("");
    lines.push("NOTE: Provision waves run in order; providers within a wave run in parallel.");

    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Build a map of provider → ProviderCategory for visualization. */
  private _buildProviderCategoryMap(): Map<string, string> {
    // Static category lookup — mirrors the known provider categories
    const knownCategories: Record<string, string> = {
      supabase: "database",
      neon: "database",
      turso: "database",
      convex: "database",
      firebase: "database",
      clerk: "auth",
      auth0: "auth",
      workos: "auth",
      stripe: "payments",
      vercel: "deploy",
      railway: "deploy",
      fly: "deploy",
      render: "deploy",
      cloudflare: "deploy",
      openai: "ai",
      anthropic: "ai",
      xai: "ai",
      deepseek: "ai",
      replicate: "ai",
      braintrust: "ai",
      modal: "ai",
      resend: "email",
      sendgrid: "email",
      mailgun: "email",
      postmark: "email",
      posthog: "analytics",
      mixpanel: "analytics",
      plausible: "analytics",
      sentry: "errors",
      datadog: "observability",
      grafana: "observability",
      upstash: "database",
      aws: "cloud",
      gcp: "cloud",
      github: "code",
      linear: "tickets",
      launchdarkly: "featureflags",
    };

    const map = new Map<string, string>();
    for (const p of this.providers) {
      map.set(p, knownCategories[p] ?? "cloud");
    }
    return map;
  }

  /** Sanitize a provider name to a valid Mermaid node id. */
  private _mermaidId(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, "_");
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Convenience factory: build a ProviderDependencyGraph from an array of
 * orchestration entries.
 *
 * @param entries   Orchestration entries (may include explicit dependsOn).
 * @param opts      Optional graph construction options.
 * @returns         A fully-built ProviderDependencyGraph ready to query.
 */
export function buildProviderGraph(
  entries: OrchestrationEntry[],
  opts?: ProviderDependencyGraphOptions,
): ProviderDependencyGraph {
  return new ProviderDependencyGraph(entries, opts);
}
