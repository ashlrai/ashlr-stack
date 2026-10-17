import type { ArgsDef, CommandDef } from "citty";

/**
 * Unknown-flag detection for every `stack` command, run once before citty
 * parses anything.
 *
 * Why this exists: citty 0.1.6 parses leniently. An undeclared flag lands in
 * the parsed object under a key no command reads, so `stack list --jsno`,
 * `stack init --json` or `stack remove x --json` exit 0 and the caller (often
 * an agent) believes the flag took effect. This module resolves the subcommand
 * the same way citty does, checks each flag token against the args the
 * matched command declares, and reports the first unknown one.
 *
 * Accepted as known:
 *   - every declared non-positional arg, by its camelCase key or kebab-case
 *     spelling, and its aliases (`-v`, bundled short flags like `-vf`);
 *   - `--no-<arg>` negation of a declared arg (citty sets `<arg>=false`);
 *   - `--no-<rest>` where `no<Rest>` is itself a declared arg (init's
 *     `noInteractive`, swap's `noRollback`, ...). citty would read that token
 *     as negating an undeclared `<rest>` and leave `no<Rest>` at its default,
 *     so the token is rewritten to `--no<Rest>` and the documented spelling
 *     takes effect.
 *
 * Never checked:
 *   - anything after a bare `--` (passthrough for the wrapped command);
 *   - negative numbers used as values (`-1`) and a lone `-`;
 *   - commands in {@link FREE_FORM_COMMANDS}, which forward their raw argv.
 */

/**
 * Commands that take free-form flags and must never be checked.
 * `stack exec` forwards everything after `exec` (with or without `--`) to
 * `phantom exec`, so `stack exec npm test --watch` must reach npm untouched.
 */
export const FREE_FORM_COMMANDS: ReadonlySet<string> = new Set(["exec"]);

/**
 * Parent commands whose bare form runs a default subcommand with the same
 * raw argv (`stack templates --json` is `stack templates list --json`). Their
 * flags are the parent's own plus the default subcommand's.
 */
export const DEFAULT_SUBCOMMANDS: Readonly<Record<string, string>> = {
  templates: "list",
  projects: "list",
  env: "show",
  telemetry: "status",
};

export interface UnknownFlag {
  /** The token as typed, without any `=value` part (e.g. `--jsno`). */
  flag: string;
  /** `stack list`, `stack templates apply`, ... */
  command: string;
  /** Closest declared flag in the spelling the user is likely to type, if close. */
  suggestion?: string;
  /** True when the matched command declares `--json` and the argv sets it. */
  json: boolean;
  /** One-line message: `unknown option --jsno for stack list; did you mean --json?` */
  message: string;
}

export type FlagCheck = { ok: true; args: string[] } | { ok: false; error: UnknownFlag };

type AnyCommand = CommandDef<ArgsDef>;

interface FlagSet {
  /** Long names: declared keys (camelCase) and their kebab-case forms. */
  long: Map<string, string>;
  /** Single-character aliases. */
  short: Set<string>;
}

async function resolveValue<T>(
  value: T | (() => T) | (() => Promise<T>) | undefined,
): Promise<T | undefined> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : value;
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

async function flagsOf(cmds: AnyCommand[]): Promise<FlagSet> {
  const long = new Map<string, string>();
  const short = new Set<string>();
  for (const cmd of cmds) {
    const args = (await resolveValue(cmd.args)) ?? {};
    for (const [name, def] of Object.entries(args)) {
      if (def.type === "positional") continue;
      long.set(name, name);
      long.set(kebab(name), name);
      const aliases = "alias" in def && def.alias ? [def.alias].flat() : [];
      for (const alias of aliases) {
        if (alias.length === 1) short.add(alias);
        else {
          long.set(alias, name);
          long.set(kebab(alias), name);
        }
      }
    }
  }
  return { long, short };
}

interface Level {
  /** Index in the full argv where this level's own tokens start. */
  start: number;
  /** Index (exclusive) where they end: the subcommand token, or argv.length. */
  end: number;
  cmds: AnyCommand[];
  path: string[];
}

/**
 * Walk the subcommand tree exactly as citty 0.1.6's runCommand does: at each
 * level the first token that does not start with `-` names the subcommand.
 * Returns null when citty itself would fail (unknown subcommand) or when a
 * free-form command is reached, so the caller leaves argv alone.
 */
async function resolveLevels(root: AnyCommand, argv: string[]): Promise<Level[] | null> {
  const levels: Level[] = [];
  let cmd = root;
  let offset = 0;
  const path: string[] = [];
  for (;;) {
    const rest = argv.slice(offset);
    const subCommands = (await resolveValue(cmd.subCommands)) ?? {};
    const idx =
      Object.keys(subCommands).length > 0 ? rest.findIndex((a) => !a.startsWith("-")) : -1;
    if (idx < 0) {
      const cmds = [cmd];
      const fallback = DEFAULT_SUBCOMMANDS[path.join(" ")];
      if (fallback && subCommands[fallback]) {
        const sub = await resolveValue(subCommands[fallback]);
        if (sub) cmds.push(sub as AnyCommand);
      }
      levels.push({ start: offset, end: argv.length, cmds, path: [...path] });
      return levels;
    }
    const name = rest[idx];
    const next = subCommands[name];
    if (!next) return null;
    levels.push({ start: offset, end: offset + idx, cmds: [cmd], path: [...path] });
    path.push(name);
    if (FREE_FORM_COMMANDS.has(path.join(" "))) return null;
    const resolved = await resolveValue(next);
    if (!resolved) return null;
    cmd = resolved as AnyCommand;
    offset += idx + 1;
  }
}

/** Optimal string alignment distance (Levenshtein plus adjacent transposition). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function suggest(typed: string, flags: FlagSet): string | undefined {
  const target = camel(typed).toLowerCase();
  const names = new Set(flags.long.values());
  let best: { name: string; distance: number } | undefined;
  for (const name of names) {
    const distance = editDistance(target, name.toLowerCase());
    if (!best || distance < best.distance) best = { name, distance };
  }
  if (!best) return undefined;
  const limit = Math.max(1, Math.min(3, Math.floor(best.name.length / 3)));
  if (best.distance > limit) return undefined;
  // Answer in the spelling the user typed: camelCase in, camelCase out;
  // otherwise the kebab-case form the docs use.
  return /[A-Z]/.test(typed) ? best.name : kebab(best.name);
}

function setsJson(argv: string[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const token = argv[i];
    if (token === "--") return false;
    if (token === "--json" || token === "--json=true") return true;
  }
  return false;
}

/**
 * Check every flag in `argv` (the raw tokens after `stack`) against the
 * command it reaches. On success returns the argv to parse, with
 * `--no-<rest>` rewritten to a declared `--no<Rest>` where that applies.
 */
export async function checkFlags<T extends ArgsDef = ArgsDef>(
  root: CommandDef<T>,
  argv: string[],
): Promise<FlagCheck> {
  const levels = await resolveLevels(root as unknown as AnyCommand, argv);
  if (!levels) return { ok: true, args: argv };
  const out = [...argv];
  for (const level of levels) {
    const flags = await flagsOf(level.cmds);
    for (let i = level.start; i < level.end; i++) {
      const token = argv[i];
      if (token === "--") return { ok: true, args: out };
      if (!token.startsWith("-") || token === "-" || /^-\d/.test(token)) continue;
      const long = token.startsWith("--");
      const body = token.slice(long ? 2 : 1);
      const eq = body.indexOf("=");
      const name = eq >= 0 ? body.slice(0, eq) : body;
      const shown = long ? `--${name}` : `-${name}`;
      if (long) {
        if (name.startsWith("no-") && name.length > 3) {
          // citty reads any `--no-x` as `x=false`, even when `noX` is declared.
          if (flags.long.has(name.slice(3))) continue;
          const declared = flags.long.get(camel(name));
          if (declared) {
            out[i] = `--${declared}${eq >= 0 ? body.slice(eq) : ""}`;
            continue;
          }
        } else if (flags.long.has(name)) continue;
      } else if ([...name].every((c) => flags.short.has(c))) {
        continue;
      }
      const command = ["stack", ...level.path].join(" ");
      const suggestion = long ? suggest(name, flags) : undefined;
      const leaf = levels[levels.length - 1];
      const leafFlags = leaf === level ? flags : await flagsOf(leaf.cmds);
      const json = leafFlags.long.has("json") && setsJson(argv, leaf.start, leaf.end);
      const hint = suggestion
        ? `did you mean --${suggestion}?`
        : `run \`${command} --help\` for its options`;
      return {
        ok: false,
        error: {
          flag: shown,
          command,
          suggestion: suggestion ? `--${suggestion}` : undefined,
          json,
          message: `unknown option ${shown} for ${command}; ${hint}`,
        },
      };
    }
  }
  return { ok: true, args: out };
}
