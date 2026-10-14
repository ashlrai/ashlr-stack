/** Copyable Stack control-plane MCP bootstrap, independent of provider selection. */
const STACK_MCP_BOOTSTRAP = JSON.stringify(
  { mcpServers: { "ashlr-stack": { command: "ashlr-stack-mcp" } } },
  null,
  2,
);

export const STACK_MCP_PREREQUISITES =
  "Install @ashlr/stack and ashlr-stack-mcp so both `stack` and `ashlr-stack-mcp` are on PATH. Use the runtime required by the versions you installed.";

/** Catalog MCP markers control whether this optional bootstrap is shown. */
export function formatOptionalStackMcp(hasCatalogMcp: boolean): string {
  return hasCatalogMcp ? STACK_MCP_BOOTSTRAP : "";
}

export interface StackAddPlan {
  commands: string;
  unsupported: string[];
}

/** Emit only commands backed by canonical provider names, never display stubs. */
export function planStackAddCommands(
  selectedNames: readonly string[],
  supportedNames: ReadonlySet<string>,
): StackAddPlan {
  const commands: string[] = [];
  const unsupported: string[] = [];
  const seen = new Set<string>();

  for (const name of selectedNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (supportedNames.has(name) && /^[a-z][a-z0-9-]*$/.test(name)) {
      commands.push(`stack add ${name}`);
    } else {
      unsupported.push(name);
    }
  }

  return { commands: commands.join(" && "), unsupported };
}
