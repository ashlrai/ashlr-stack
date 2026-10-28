/** A distributable Stack component, rather than an installed companion tool. */
export interface StackComponent {
  readonly id: "core" | "cli" | "mcp" | "plugin";
  readonly name: string;
  readonly version: string;
  readonly distribution: "npm" | "claude-code-plugin";
}

/**
 * Source release metadata for ecosystem consumers. Versions do not establish
 * registry publication or describe tools installed on the current machine.
 * Additive fields may stay in v1; removals or renames require a schema bump.
 */
export interface StackManifest {
  readonly schema_version: 1;
  readonly kind: "ashlr-stack-manifest";
  readonly components: readonly StackComponent[];
}

/**
 * Import from @ashlr/stack-core. This JSON-safe export performs no filesystem,
 * network, credential or subprocess access. Keep versions in sync on release;
 * the fixture contract test checks the package and plugin metadata for drift.
 */
export const STACK_MANIFEST = Object.freeze({
  schema_version: 1,
  kind: "ashlr-stack-manifest",
  components: Object.freeze([
    Object.freeze({ id: "core", name: "@ashlr/stack-core", version: "0.2.2", distribution: "npm" }),
    Object.freeze({ id: "cli", name: "@ashlr/stack", version: "0.2.2", distribution: "npm" }),
    Object.freeze({ id: "mcp", name: "ashlr-stack-mcp", version: "0.2.2", distribution: "npm" }),
    Object.freeze({
      id: "plugin",
      name: "stack",
      version: "0.1.0",
      distribution: "claude-code-plugin",
    }),
  ]),
} as const) satisfies StackManifest;
