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
 * belong to the parent. citty never passes those to the subcommand, so an
 * option before a subcommand name is refused even when the parent declares it
 * (`stack --json list` printed the human list). Left alone:
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
  /**
   * Set when the option was typed before a subcommand name that declares
   * it, e.g. the `list` of `stack --json list`. citty hands the subcommand
   * only the tokens after its name, so the option was dropped even when the
   * parent declares it. A misplaced option the subcommand does not declare
   * either (`stack -v list`) is reported as unknown for the subcommand.
   */
  before?: string;
}

type Resolvable<T> = T | Promise<T> | (() => T) | (() => Promise<T>);

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function distance(a: string, b: string): number {
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

/** The candidate within `max` edits of `name` (case-insensitive), if any. */
export function closestName(name: string, candidates: string[], max = 2): string | undefined {
  const best = candidates
    .map((n) => ({ n, d: distance(name.toLowerCase(), n.toLowerCase()) }))
    .sort((x, y) => x.d - y.d)[0];
  return best && best.d <= max ? best.n : undefined;
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
      const best = closestName(
        name,
        [...long].filter((n) => n !== "help"),
      );
      const suggestion = best ? `--${kebab(best)}` : undefined;
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
      const before = own.slice(0, index);
      const unknown = check(before, args, command);
      if (unknown) return unknown;
      // A declared option before the subcommand is not passed to it either:
      // citty drops it, so `stack --json list` printed the human list.
      const misplaced = before.find((t) => t.startsWith("-") && t !== "-" && !/^-\d/.test(t));
      if (misplaced) {
        const path = `${command} ${name}`;
        const subArgs = ((await resolveValue(sub.args as Resolvable<ArgsDef>)) ?? {}) as ArgsDef;
        // Point at `<sub> --json` only when the subcommand takes that option.
        const subTakesIt = "_" in subArgs || check([misplaced], subArgs, path) === null;
        return {
          flag: misplaced.split("=")[0],
          command: path,
          before: subTakesIt ? name : undefined,
        };
      }
      return await findUnknownFlag(sub, rawArgs.slice(index + 1), `${command} ${name}`);
    }
  }
  return check(own, args, command);
}

/**
 * The command a raw argv resolves to, as typed (`stack env show`), following
 * the same "first token without a leading -" rule as citty.
 */
export async function commandPath<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  rawArgs: string[],
  command = "stack",
): Promise<string> {
  const subCommands = await resolveValue(
    cmd.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>> | undefined,
  );
  if (!subCommands) return command;
  const index = rawArgs.findIndex((a) => !a.startsWith("-"));
  if (index < 0) return command;
  const name = rawArgs[index];
  const sub = await resolveValue(subCommands[name]);
  if (!sub) return command;
  return commandPath(sub, rawArgs.slice(index + 1), `${command} ${name}`);
}

/** One line naming the option, the closest declared one, and where to look. */
export function describeUnknownFlag(unknown: UnknownFlag): string {
  if (unknown.before) {
    return `Option ${unknown.flag} goes after the subcommand: run \`${unknown.command} ${unknown.flag}\` (see \`${unknown.command} --help\`).`;
  }
  const hint = unknown.suggestion ? ` Did you mean ${unknown.suggestion}?` : "";
  return `Unknown option ${unknown.flag} for \`${unknown.command}\`.${hint} Run \`${unknown.command} --help\` for its options.`;
}
