/**
 * Rewrite kebab-case long flags to the camelCase keys our citty commands
 * declare, so `--dry-run` parses the same as `--dryRun`.
 *
 * Why this exists: citty 0.1.6 maps kebab CLI tokens onto camelCase arg keys
 * through a Proxy whose fallback uses `??`. A boolean arg with `default: false`
 * therefore shadows the kebab-parsed value — `out.dryRun` is `false` (the
 * default) before the proxy ever checks `out["dry-run"]`, so `??` short-circuits
 * and `--dry-run` is silently ignored while `--dryRun` works. Our flags are
 * documented in kebab-case (README, --help, the docs site), so the documented
 * spelling is the broken one — and for a provider that doesn't gate on a missing
 * OAuth client id, `add <provider> --dry-run` would run the *real* provisioning
 * flow instead of the advertised no-op preview.
 *
 * Normalizing the raw argv up front fixes every command at once and keeps both
 * spellings working, without per-flag aliases (which citty 0.1.6 renders as a
 * misleading single-dash `-dry-run` in `--help`).
 *
 * Deliberately left untouched:
 *   - `--no-*` tokens. citty treats `--no-foo` as negation (sets `foo=false`),
 *     which is the documented way to disable a default-true boolean such as
 *     `templates apply --no-continue-on-error`. Rewriting it would break that.
 *   - Everything after a bare `--`. Those are passthrough positionals (e.g.
 *     `stack exec -- <cmd>`), not flags for us to interpret.
 *   - Single-word flags and flag *values* (only the name before `=` is touched,
 *     so `--region=us-east-1` and `--use=my-resource-id` are safe).
 */
export function normalizeKebabFlags(argv: string[]): string[] {
  const out: string[] = [];
  let passthrough = false;
  for (const token of argv) {
    if (passthrough) {
      out.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      out.push(token);
      continue;
    }
    // Match `--word-word[=value]`: a long flag whose name has an interior
    // hyphen. The name class excludes `=`, so a hyphenated *value* never drags
    // the match past the `=`.
    const match = /^--([a-z0-9]+(?:-[a-z0-9]+)+)(=.*)?$/.exec(token);
    if (match && !match[1].startsWith("no-")) {
      const camel = match[1].replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      out.push(`--${camel}${match[2] ?? ""}`);
    } else {
      out.push(token);
    }
  }
  return out;
}
