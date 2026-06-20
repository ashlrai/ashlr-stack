import { describe, expect, it } from "bun:test";
import { normalizeKebabFlags } from "../lib/normalize-args.ts";

/**
 * Parser-level guard for the kebab→camel rewrite. citty 0.1.6 silently ignores
 * `--dry-run` when the arg key is `dryRun` with `default: false`; we normalize
 * the raw argv so the documented kebab spelling maps onto the declared key.
 */
describe("normalizeKebabFlags", () => {
  it("rewrites a multi-word kebab flag to camelCase", () => {
    expect(normalizeKebabFlags(["add", "supabase", "--dry-run"])).toEqual([
      "add",
      "supabase",
      "--dryRun",
    ]);
  });

  it("rewrites three-word kebab flags", () => {
    expect(normalizeKebabFlags(["templates", "apply", "x", "--continue-on-error"])).toEqual([
      "templates",
      "apply",
      "x",
      "--continueOnError",
    ]);
  });

  it("preserves the value when the flag uses =", () => {
    expect(normalizeKebabFlags(["swap", "a", "b", "--keep-from=clerk"])).toEqual([
      "swap",
      "a",
      "b",
      "--keepFrom=clerk",
    ]);
  });

  it("leaves the already-camelCase spelling untouched", () => {
    expect(normalizeKebabFlags(["add", "supabase", "--dryRun"])).toEqual([
      "add",
      "supabase",
      "--dryRun",
    ]);
  });

  it("leaves single-word flags untouched", () => {
    expect(normalizeKebabFlags(["init", "--force", "--json"])).toEqual([
      "init",
      "--force",
      "--json",
    ]);
  });

  it("does not drag a hyphenated value into the flag name", () => {
    // `region` is a single word; only the value has hyphens.
    expect(normalizeKebabFlags(["add", "--region=us-east-1"])).toEqual([
      "add",
      "--region=us-east-1",
    ]);
    expect(normalizeKebabFlags(["add", "--use=my-resource-id"])).toEqual([
      "add",
      "--use=my-resource-id",
    ]);
  });

  it("leaves `--no-*` negation tokens alone", () => {
    // citty treats `--no-foo` as negation; rewriting it would break the
    // documented disable path for default-true booleans.
    expect(normalizeKebabFlags(["templates", "apply", "x", "--no-continue-on-error"])).toEqual([
      "templates",
      "apply",
      "x",
      "--no-continue-on-error",
    ]);
  });

  it("does not touch positionals after a bare `--`", () => {
    expect(normalizeKebabFlags(["exec", "--", "some-cmd", "--inner-flag"])).toEqual([
      "exec",
      "--",
      "some-cmd",
      "--inner-flag",
    ]);
  });

  it("rewrites a kebab flag with a hyphenated value", () => {
    expect(normalizeKebabFlags(["swap", "--keep-from=a-b-c"])).toEqual([
      "swap",
      "--keepFrom=a-b-c",
    ]);
  });
});
