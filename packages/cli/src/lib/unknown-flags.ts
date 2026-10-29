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
  /**
   * Set when `flag` is not an option but a positional value the command has
   * no slot for: citty dropped it, so `stack recommend build a saas` searched
   * for "build" alone and `stack add supabase neon` added only supabase. Lists
   * the positionals the command does take, in order.
   */
  extra?: string[];
  /** A declared option was supplied without its value. */
  missingValue?: boolean;
}

type Resolvable<T> = T | Promise<T> | (() => T) | (() => Promise<T>);

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const isOption = (token: string) => token.startsWith("-") && token !== "-" && !/^-\d/.test(token);

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

function check(tokens: string[], args: ArgsDef, command: string, leaf = false): UnknownFlag | null {
  const long = new Set<string>(["help"]);
  const short = new Set<string>(["h"]);
  // Options that take a value: a separate value token is not a positional.
  const valued = new Set<string>();
  const positionals: string[] = [];
  for (const [key, def] of Object.entries(args)) {
    if (def.type === "positional") {
      positionals.push(key);
      continue;
    }
    long.add(key);
    const aliases = "alias" in def && def.alias ? [def.alias].flat() : [];
    for (const alias of aliases) (alias.length === 1 ? short : long).add(alias);
    if (def.type !== "boolean") for (const name of [key, ...aliases]) valued.add(name);
  }
  let seen = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") break;
    if (!token.startsWith("-") || token === "-" || /^-\d/.test(token)) {
      seen++;
      if (leaf && seen > positionals.length) return { flag: token, command, extra: positionals };
      continue;
    }
    if (token.startsWith("--")) {
      const name = camel(token.slice(2).split("=")[0]);
      const negated = name.startsWith("no") ? name.charAt(2).toLowerCase() + name.slice(3) : "";
      if (valued.has(name) && !token.includes("=")) {
        const next = tokens[i + 1];
        if (next === undefined || isOption(next)) {
          return { flag: token, command, missingValue: true };
        }
        i++;
      }
      if (long.has(name) || (negated && long.has(negated))) continue;
      const flag = token.split("=")[0];
      const best = closestName(
        name,
        [...long].filter((n) => n !== "help"),
      );
      const suggestion = best ? `--${kebab(best)}` : undefined;
      return { flag, command, suggestion };
    }
    const letters = token.slice(1).split("=")[0];
    for (const c of letters) {
      if (!short.has(c)) return { flag: `-${c}`, command };
    }
    // `-e prod`: a valued short option as the last letter takes the next token.
    const last = letters.at(-1);
    if (last && valued.has(last) && !token.includes("=")) {
      const next = tokens[i + 1];
      if (next === undefined || isOption(next)) {
        return { flag: `-${last}`, command, missingValue: true };
      }
      i++;
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
  return check(own, args, command, true);
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
  if (unknown.missingValue) {
    return `Option ${unknown.flag} for \`${unknown.command}\` requires a value. Run \`${unknown.command} --help\` for usage.`;
  }
  if (unknown.extra) {
    const takes =
      unknown.extra.length === 0
        ? "takes no arguments"
        : `takes ${unknown.extra.map((name) => `<${kebab(name)}>`).join(" ")}`;
    return `Unexpected argument "${unknown.flag}" for \`${unknown.command}\`, which ${takes}. Quote a value that contains spaces, or run the command once per value. Run \`${unknown.command} --help\` for usage.`;
  }
  if (unknown.before) {
    return `Option ${unknown.flag} goes after the subcommand: run \`${unknown.command} ${unknown.flag}\` (see \`${unknown.command} --help\`).`;
  }
  const hint = unknown.suggestion ? ` Did you mean ${unknown.suggestion}?` : "";
  return `Unknown option ${unknown.flag} for \`${unknown.command}\`.${hint} Run \`${unknown.command} --help\` for its options.`;
}

/**
 * Join `--opt value` into `--opt=value` for the string options a command with
 * subcommands declares itself (bare `stack env --env prod`).
 *
 * citty names the subcommand by the first token that does not start with
 * "-", so the separate value `prod` was taken for a subcommand and the run
 * failed with "Unknown command prod", although `stack env --help` lists
 * `--env`. Leaf commands and everything after the subcommand name are left
 * to citty, which parses their values itself.
 */
export async function bindParentOptionValues<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  rawArgs: string[],
): Promise<string[]> {
  const subCommands = await resolveValue(
    cmd.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>> | undefined,
  );
  if (!subCommands || Object.keys(subCommands).length === 0) return rawArgs;
  const args = ((await resolveValue(cmd.args as Resolvable<ArgsDef>)) ?? {}) as ArgsDef;
  const strings = new Set<string>();
  for (const [key, def] of Object.entries(args)) {
    if (def.type !== "string") continue;
    strings.add(key);
    const aliases = "alias" in def && def.alias ? [def.alias].flat() : [];
    for (const alias of aliases) strings.add(alias);
  }
  const out: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];
    if (token === "--") return [...out, ...rawArgs.slice(i)];
    if (!token.startsWith("-")) {
      const sub = await resolveValue(subCommands[token]);
      const rest = rawArgs.slice(i + 1);
      return [...out, token, ...(sub ? await bindParentOptionValues(sub, rest) : rest)];
    }
    const name = token.startsWith("--") ? camel(token.slice(2)) : token.slice(1);
    const next = rawArgs[i + 1];
    if (!token.includes("=") && strings.has(name) && next !== undefined && !isOption(next)) {
      out.push(`${token}=${next}`);
      i++;
      continue;
    }
    out.push(token);
  }
  return out;
}
