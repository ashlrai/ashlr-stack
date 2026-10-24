/**
 * The error for a service name that is not in .stack.toml. Names what is
 * configured (or says nothing is), so the caller can retry with a real name
 * instead of running `stack list` first.
 */
export function notInStackMessage(service: string, configured: string[]): string {
  if (configured.length === 0) {
    return `${service} is not in this stack, which has no services yet. Add one with \`stack add <provider>\` (see \`stack providers\`).`;
  }
  const wanted = service.toLowerCase();
  const near = configured.find((name) => name.toLowerCase() === wanted);
  const hint = near ? ` Did you mean ${near}?` : "";
  return `${service} is not in this stack.${hint} Configured services: ${[...configured].sort().join(", ")}.`;
}
