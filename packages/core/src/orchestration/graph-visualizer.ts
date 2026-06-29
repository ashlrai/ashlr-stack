/**
 * Rollback Dependency Graph Visualizer
 *
 * Renders a RollbackGraph / RollbackPlan as:
 *  1. ASCII art DAG (human-readable in terminals)
 *  2. Mermaid flowchart diagram (for documentation, wikis)
 *  3. JSON graph format (for third-party graphing tools like D3, Cytoscape, etc.)
 *
 * The visualizer also supports rendering the rollback plan wave-by-wave,
 * showing which providers are torn down in each wave and the dependency
 * chains between them.
 */

import type { RollbackGraph, RollbackPlan, RollbackWave } from "./rollback-graph.ts";

// ---------------------------------------------------------------------------
// JSON graph format (for third-party graphing)
// ---------------------------------------------------------------------------

/** A node in the exported JSON graph. */
export interface GraphNode {
  id: string;
  /** Wave index in the rollback plan (0 = torn down first). */
  wave: number;
  /** Providers that must be torn down before this one (i.e., this depends on them). */
  dependsOn: string[];
  /** Providers that depend on this one (torn down after). */
  dependents: string[];
}

/** A directed edge in the exported JSON graph. */
export interface GraphEdge {
  /** Provider that must be torn down first. */
  from: string;
  /** Provider that is torn down after `from`. */
  to: string;
}

/** Full JSON graph export for third-party graphing tools. */
export interface JsonGraphExport {
  /** Graph format version — bump on breaking changes. */
  version: 1;
  /** ISO 8601 timestamp of graph generation. */
  generatedAt: string;
  /** Total number of providers in the graph. */
  nodeCount: number;
  /** Total number of dependency edges in the graph. */
  edgeCount: number;
  /** All nodes with their wave assignment and adjacency info. */
  nodes: GraphNode[];
  /** All directed edges (rollback ordering: from → to means from tears down before to). */
  edges: GraphEdge[];
  /** Ordered rollback waves (wave 0 runs first). */
  waves: Array<{ index: number; providers: string[] }>;
}

// ---------------------------------------------------------------------------
// RollbackGraphVisualizer
// ---------------------------------------------------------------------------

/**
 * Renders a RollbackGraph and its computed RollbackPlan as ASCII art,
 * Mermaid diagrams, and JSON graph exports.
 *
 * Usage:
 *   const viz = new RollbackGraphVisualizer(graph, plan);
 *   console.log(viz.toAscii());
 *   console.log(viz.toMermaid());
 *   const json = viz.toJsonGraph();
 */
export class RollbackGraphVisualizer {
  private readonly _graph: RollbackGraph;
  private readonly _plan: RollbackPlan;
  /** Maps provider → wave index for O(1) lookup. */
  private readonly _waveOf: Map<string, number>;

  constructor(graph: RollbackGraph, plan: RollbackPlan) {
    this._graph = graph;
    this._plan = plan;
    this._waveOf = new Map();
    for (const wave of plan.waves) {
      for (const p of wave.providers) {
        this._waveOf.set(p, wave.index);
      }
    }
  }

  // -------------------------------------------------------------------------
  // ASCII art renderer
  // -------------------------------------------------------------------------

  /**
   * Render the rollback plan as ASCII art.
   *
   * Output format:
   *
   *   Rollback Plan — 3 waves, 5 providers
   *   ══════════════════════════════════════
   *
   *   Wave 0 (parallel) — torn down first
   *   ┌─────────────────────────────────────┐
   *   │  stripe-webhook                     │
   *   └─────────────────────────────────────┘
   *           │ depends-on
   *   Wave 1 (parallel)
   *   ┌─────────────────────────────────────┐
   *   │  stripe          supabase           │
   *   └─────────────────────────────────────┘
   *           │ depends-on
   *   Wave 2 (parallel) — torn down last
   *   ┌─────────────────────────────────────┐
   *   │  clerk           user-data          │
   *   └─────────────────────────────────────┘
   */
  toAscii(): string {
    const lines: string[] = [];
    const totalProviders = this._plan.scope.size;
    const totalWaves = this._plan.waves.length;

    lines.push(`Rollback Plan — ${totalWaves} wave${totalWaves !== 1 ? "s" : ""}, ${totalProviders} provider${totalProviders !== 1 ? "s" : ""}`);
    lines.push("═".repeat(50));

    if (totalWaves === 0) {
      lines.push("  (empty plan — nothing to roll back)");
      return lines.join("\n");
    }

    for (let i = 0; i < this._plan.waves.length; i++) {
      const wave = this._plan.waves[i]!;
      lines.push("");

      const suffix =
        i === 0
          ? " — torn down FIRST"
          : i === this._plan.waves.length - 1
          ? " — torn down LAST"
          : "";
      lines.push(`Wave ${wave.index} (${wave.providers.length === 1 ? "single" : "parallel"})${suffix}`);

      // Build box
      const BOX_WIDTH = 50;
      lines.push("┌" + "─".repeat(BOX_WIDTH) + "┐");

      // Lay providers out in rows of up to 3
      const ROW_SIZE = 3;
      for (let j = 0; j < wave.providers.length; j += ROW_SIZE) {
        const rowItems = wave.providers.slice(j, j + ROW_SIZE);
        const colWidth = Math.floor(BOX_WIDTH / ROW_SIZE);
        const rowStr = rowItems.map((p) => p.padEnd(colWidth)).join("").slice(0, BOX_WIDTH);
        lines.push("│  " + rowStr.padEnd(BOX_WIDTH - 2) + "│");
      }

      lines.push("└" + "─".repeat(BOX_WIDTH) + "┘");

      // Draw connector to next wave
      if (i < this._plan.waves.length - 1) {
        lines.push("         │ (depends-on ↓)");
      }
    }

    lines.push("");
    lines.push("Legend: Wave 0 is deprovisioned first; higher waves run after lower waves complete.");

    // Append dependency detail
    const edgeLines = this._renderEdgeList();
    if (edgeLines.length > 0) {
      lines.push("");
      lines.push("Dependencies:");
      lines.push(...edgeLines);
    }

    return lines.join("\n");
  }

  /** Render a bullet list of dependency edges for the ASCII footer. */
  private _renderEdgeList(): string[] {
    const lines: string[] = [];
    for (const [dep, dependents] of this._graph) {
      for (const dependent of dependents) {
        lines.push(`  ${dependent} → must roll back before → ${dep}`);
      }
    }
    return lines;
  }

  // -------------------------------------------------------------------------
  // Mermaid renderer
  // -------------------------------------------------------------------------

  /**
   * Render the rollback graph as a Mermaid flowchart (top-down).
   *
   * Output is valid Mermaid markdown that can be pasted into GitHub,
   * Notion, or rendered by mermaid-js.
   *
   * Example:
   *   ```mermaid
   *   flowchart TD
   *     subgraph Wave0["Wave 0 — torn down first"]
   *       stripe-webhook
   *     end
   *     subgraph Wave1["Wave 1"]
   *       stripe
   *       supabase
   *     end
   *     stripe-webhook --> stripe
   *     stripe-webhook --> supabase
   *   ```
   */
  toMermaid(): string {
    const lines: string[] = [];
    lines.push("```mermaid");
    lines.push("flowchart TD");

    // Subgraph per wave
    for (const wave of this._plan.waves) {
      const label =
        wave.index === 0
          ? `Wave ${wave.index} — torn down first`
          : wave.index === this._plan.waves.length - 1
          ? `Wave ${wave.index} — torn down last`
          : `Wave ${wave.index}`;
      lines.push(`  subgraph Wave${wave.index}["${label}"]`);
      for (const p of wave.providers) {
        // Sanitize node id for Mermaid (replace non-alphanumeric with _)
        const nodeId = this._mermaidId(p);
        lines.push(`    ${nodeId}["${p}"]`);
      }
      lines.push("  end");
    }

    // Edges: in rollback order, dependent → dependency
    // (A → B means A must be torn down before B)
    for (const [dep, dependents] of this._graph) {
      for (const dependent of dependents) {
        lines.push(`  ${this._mermaidId(dependent)} --> ${this._mermaidId(dep)}`);
      }
    }

    lines.push("```");
    return lines.join("\n");
  }

  /** Sanitize a provider name to a valid Mermaid node id. */
  private _mermaidId(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, "_");
  }

  // -------------------------------------------------------------------------
  // JSON graph export
  // -------------------------------------------------------------------------

  /**
   * Export the rollback graph as a structured JSON object suitable for
   * consumption by third-party graphing tools (D3.js, Cytoscape.js, etc.).
   */
  toJsonGraph(): JsonGraphExport {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Build reverse edges map: for each dependent, list its dependencies
    const dependsOnMap = new Map<string, string[]>();
    for (const name of this._plan.scope) {
      dependsOnMap.set(name, []);
    }
    for (const [dep, dependents] of this._graph) {
      for (const dependent of dependents) {
        dependsOnMap.get(dependent)?.push(dep);
        edges.push({ from: dependent, to: dep });
      }
    }

    for (const name of this._plan.scope) {
      nodes.push({
        id: name,
        wave: this._waveOf.get(name) ?? 0,
        dependsOn: dependsOnMap.get(name) ?? [],
        dependents: this._graph.get(name) ?? [],
      });
    }

    // Sort nodes deterministically
    nodes.sort((a, b) => a.wave - b.wave || a.id.localeCompare(b.id));

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
      waves: this._plan.waves.map((w) => ({ index: w.index, providers: w.providers })),
    };
  }

  // -------------------------------------------------------------------------
  // Rollback plan preview (used by `stack status --rollback-plan`)
  // -------------------------------------------------------------------------

  /**
   * Render a concise rollback plan preview suitable for `stack status --rollback-plan`.
   * Shows what would be torn down if the current provision fails, with
   * dependency chain annotations.
   *
   * @param failurePoint Optional: the provider that failed (highlighted in output).
   */
  toRollbackPlanPreview(failurePoint?: string): string {
    const lines: string[] = [];
    const totalProviders = this._plan.scope.size;

    if (totalProviders === 0) {
      return "No resources to roll back — provision has not started yet.";
    }

    lines.push("Rollback Preview — what would be torn down on failure:");
    lines.push("");

    if (failurePoint) {
      lines.push(`  Failure point: ${failurePoint}`);
      lines.push(`  Scope: ${totalProviders} provider${totalProviders !== 1 ? "s" : ""} provisioned before the failure`);
    } else {
      lines.push(`  Scope: all ${totalProviders} provider${totalProviders !== 1 ? "s" : ""}`);
    }
    lines.push("");

    for (const wave of this._plan.waves) {
      const waveLabel = wave.index === 0 ? " (first to be torn down)" : "";
      lines.push(`  Wave ${wave.index}${waveLabel}:`);
      for (const p of wave.providers) {
        const deps = this._graph.get(p) ?? [];
        // In provision terms: deps are providers that p depends on (p was provisioned after them)
        // In rollback terms: p must be torn down before its deps
        const dependsOnProviders: string[] = [];
        for (const [dep, dependents] of this._graph) {
          if (dependents.includes(p)) {
            dependsOnProviders.push(dep);
          }
        }
        const chainNote =
          dependsOnProviders.length > 0
            ? ` (must tear down before: ${dependsOnProviders.join(", ")})`
            : deps.length > 0
            ? ` (dependents: ${deps.join(", ")} tear down first)`
            : "";
        const marker = p === failurePoint ? " ← FAILED HERE" : "";
        lines.push(`    · ${p}${chainNote}${marker}`);
      }
      lines.push("");
    }

    lines.push(`  Execution: waves run sequentially; providers within a wave run in parallel.`);

    return lines.join("\n");
  }
}
