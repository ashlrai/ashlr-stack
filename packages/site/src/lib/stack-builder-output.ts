import type { Provider } from "./providers";
import type { ProviderRef } from "./providers-ref";

export interface JoinedProvider {
  display: Provider;
  ref: ProviderRef | null;
}

/** Join display art to the catalog without guessing credential names on drift. */
export function joinProviderReferences(
  displays: readonly Provider[],
  refs: readonly ProviderRef[],
): JoinedProvider[] {
  const displayCounts = new Map<string, number>();
  const canonicalNameCounts = new Map<string, number>();
  const byDisplayName = new Map<string, ProviderRef | null>();
  for (const display of displays) {
    displayCounts.set(display.name, (displayCounts.get(display.name) ?? 0) + 1);
  }
  for (const ref of refs) {
    canonicalNameCounts.set(ref.name, (canonicalNameCounts.get(ref.name) ?? 0) + 1);
    byDisplayName.set(ref.displayName, byDisplayName.has(ref.displayName) ? null : ref);
  }
  return displays.map((display) => {
    const candidate = byDisplayName.get(display.name);
    return {
      display,
      ref:
        displayCounts.get(display.name) === 1 &&
        candidate &&
        canonicalNameCounts.get(candidate.name) === 1
          ? candidate
          : null,
    };
  });
}

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

/** A missing catalog match stays planning-only even if its label resembles a command. */
export function planJoinedProviderCommands(
  selected: readonly JoinedProvider[],
  supportedNames: ReadonlySet<string>,
): StackAddPlan {
  const known = selected.flatMap(({ ref }) => (ref ? [ref.name] : []));
  const plan = planStackAddCommands(known, supportedNames);
  const unsupported = new Set(plan.unsupported);
  for (const { display, ref } of selected) {
    if (!ref) unsupported.add(display.name);
  }
  return { commands: plan.commands, unsupported: [...unsupported] };
}
