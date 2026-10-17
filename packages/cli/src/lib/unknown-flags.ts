import type { ArgsDef, CommandDef } from "citty";

/**
 * Find the first option on the command line that the resolved command does
 * not declare.
 *
 * citty 0.1.6 parses unknown options into `args` and never complains, so a
 * typo was silently dropped and the command ran without it: `stack list --jsn`
 * printed the human list with exit 0, and `stack upgrade --json` printed a
 * banner an agent could not parse. runCli refuses the command instead.
 *
 * The walk mirrors citty's own subcommand resolution: the first token that
 * does not start with "-" names the subcommand, and the options before it
 * belong to the parent. Left alone:
 *   - everything after a bare `--` (passthrough for `stack exec -- cmd`),
 *   - commands that declare a `_` positional (they forward their argv),
 *   - negative numbers such as `-1`, which are values, not options,
 *   - `--no-<flag>` negation of a declared flag, and `--help`/`-h`.
 */
export interface UnknownFlag {
  /** The option as typed, without any `=value`. */
  flag: string;
  /** The command it was given to, e.g. `stack templates list`. */
  command: string;
  /** A declared option within two edits of the typo, kebab-cased. */
  suggestion?: string;
}

type Resolvable<T> = T | Promise<T> | (() => T) | (() => Promise<T>);

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

function check(tokens: string[], args: ArgsDef, command: string): UnknownFlag | null {
  const long = new Set<string>(["help"]);
  const short = new Set<string>(["h"]);
  for (const [key, def] of Object.entries(args)) {
    if (def.type === "positional") continue;
    long.add(key);
    const aliases = "alias" in def && def.alias ? [def.alias].flat() : [];
    for (const alias of aliases) (alias.length === 1 ? short : long).add(alias);
  }
  for (const token of tokens) {
    if (token === "--") break;
    if (!token.startsWith("-") || token === "-" || /^-\d/.test(token)) continue;
    if (token.startsWith("--")) {
      const name = camel(token.slice(2).split("=")[0]);
      const negated = name.startsWith("no") ? name.charAt(2).toLowerCase() + name.slice(3) : "";
      if (long.has(name) || (negated && long.has(negated))) continue;
      const flag = token.split("=")[0];
      const declared = [...long].filter((n) => n !== "help");
      const best = declared
        .map((n) => ({ n, d: distance(name.toLowerCase(), n.toLowerCase()) }))
        .sort((x, y) => x.d - y.d)[0];
      const suggestion = best && best.d <= 2 ? `--${kebab(best.n)}` : undefined;
      return { flag, command, suggestion };
    }
    for (const c of token.slice(1).split("=")[0]) {
      if (!short.has(c)) return { flag: `-${c}`, command };
    }
  }
  return null;
}

export async function findUnknownFlag<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  rawArgs: string[],
  command = "stack",
): Promise<UnknownFlag | null> {
  const args = ((await resolveValue(cmd.args as Resolvable<ArgsDef>)) ?? {}) as ArgsDef;
  if ("_" in args) return null;
  const end = rawArgs.indexOf("--");
  const own = end >= 0 ? rawArgs.slice(0, end) : rawArgs;
  const subCommands = await resolveValue(
    cmd.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>> | undefined,
  );
  if (subCommands && Object.keys(subCommands).length > 0) {
    const index = own.findIndex((a) => !a.startsWith("-"));
    if (index >= 0) {
      const name = own[index];
      const sub = await resolveValue(subCommands[name]);
      // An unknown subcommand is citty's error to report, with usage.
      if (!sub) return null;
      return (
        check(own.slice(0, index), args, command) ??
        (await findUnknownFlag(sub, rawArgs.slice(index + 1), `${command} ${name}`))
      );
    }
  }
  return check(own, args, command);
}

/** One line naming the option, the closest declared one, and where to look. */
export function describeUnknownFlag(unknown: UnknownFlag): string {
  const hint = unknown.suggestion ? ` Did you mean ${unknown.suggestion}?` : "";
  return `Unknown option ${unknown.flag} for \`${unknown.command}\`.${hint} Run \`${unknown.command} --help\` for its options.`;
}
