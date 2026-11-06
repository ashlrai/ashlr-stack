import { describe, expect, it } from "bun:test";
import { normalizeKebabFlags } from "../lib/normalize-args.ts";

/**
 * Parser-level guard for the kebab→camel rewrite. citty 0.1.6 silently ignores
 * `--dry-run` when the arg key is `dryRun` with `default: false`; we normalize
 * the raw argv so the documented kebab spelling maps onto the declared key.
 */
describe("normalizeKebabFlags", () => {
  it("returns a new empty array without mutating an empty input", () => {
    const input: string[] = [];
    Object.freeze(input);

    const result = normalizeKebabFlags(input);

    expect(result).toEqual([]);
    expect(result).not.toBe(input);
    expect(input).toEqual([]);
  });

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

  it("preserves ordinary positionals' order and spelling", () => {
    // Hyphenated, camelCase, mixed-case and numeric positionals are not flags.
    const argv = ["swap", "my-resource", "fooBar", "Some-Name", "a-b-c", "42", "x_y", "-v"];
    expect(normalizeKebabFlags(argv)).toEqual([
      "swap",
      "my-resource",
      "fooBar",
      "Some-Name",
      "a-b-c",
      "42",
      "x_y",
      "-v",
    ]);
  });

  it("keeps positionals in place when interleaved with rewritten flags", () => {
    expect(
      normalizeKebabFlags([
        "add",
        "--dry-run",
        "supabase",
        "--keep-from=clerk",
        "my-db",
        "--force",
      ]),
    ).toEqual(["add", "--dryRun", "supabase", "--keepFrom=clerk", "my-db", "--force"]);
  });

  it("preserves duplicate positionals", () => {
    expect(normalizeKebabFlags(["swap", "a-b", "a-b", "a-b"])).toEqual([
      "swap",
      "a-b",
      "a-b",
      "a-b",
    ]);
  });

  it("does not mutate the input array", () => {
    const argv = ["add", "my-db", "--dry-run", "--keep-from=clerk", "--", "--inner-flag"];
    const snapshot = [...argv];
    const out = normalizeKebabFlags(argv);
    expect(argv).toEqual(snapshot);
    expect(out).not.toBe(argv);
  });

  it("returns an empty array for empty argv", () => {
    expect(normalizeKebabFlags([])).toEqual([]);
  });

  it("rewrites a kebab flag with a hyphenated value", () => {
    expect(normalizeKebabFlags(["swap", "--keep-from=a-b-c"])).toEqual([
      "swap",
      "--keepFrom=a-b-c",
    ]);
  });

  it("keeps a positional argument with spaces as one element", () => {
    const argv = ["add", "my project name", "--dry-run"];
    const out = normalizeKebabFlags(argv);
    expect(out).toEqual(["add", "my project name", "--dryRun"]);
    expect(out).toHaveLength(3);
  });

  it("keeps a space-separated flag value as one element", () => {
    expect(normalizeKebabFlags(["swap", "--keep-from", "clerk and auth0"])).toEqual([
      "swap",
      "--keepFrom",
      "clerk and auth0",
    ]);
  });

  it("preserves spaces in a `--flag=value` value while rewriting the name", () => {
    expect(normalizeKebabFlags(["swap", "--keep-from=a b  c"])).toEqual([
      "swap",
      "--keepFrom=a b  c",
    ]);
  });

  it("does not rewrite or split a token with spaces that merely starts like a flag", () => {
    // The whole token is one argv element; the space keeps it from matching the flag shape.
    expect(normalizeKebabFlags(["exec", "--dry-run now"])).toEqual(["exec", "--dry-run now"]);
  });

  it("preserves spaces (and leading/trailing whitespace) after a bare `--`", () => {
    expect(normalizeKebabFlags(["exec", "--", "echo", " hello  world "])).toEqual([
      "exec",
      "--",
      "echo",
      " hello  world ",
    ]);
  });

  describe("PR965: Unicode argv preservation", () => {
    it("preserves a Unicode positional's exact characters and order", () => {
      // CJK, emoji (astral plane, surrogate pair), a combining sequence (NFD "é"),
      // and RTL text. Output must be code-point-identical: no NFC/NFD folding.
      const positionals = ["プロジェクト", "🚀-ship", "café", "ñandú", "שלום"];
      const out = normalizeKebabFlags(["add", ...positionals, "--dry-run"]);
      expect(out).toEqual(["add", ...positionals, "--dryRun"]);
      expect(out.slice(1, -1).map((s) => [...s])).toEqual(positionals.map((s) => [...s]));
      expect(out[3]).toBe("café");
      expect(out[3]).not.toBe("café");
    });

    it("keeps order when Unicode positionals sit between kebab flags", () => {
      expect(normalizeKebabFlags(["--keep-from=clerk", "日本語", "--dry-run", "émoji😀"])).toEqual([
        "--keepFrom=clerk",
        "日本語",
        "--dryRun",
        "émoji😀",
      ]);
    });

    it("leaves a Unicode value after `=` and hyphenated Unicode tokens alone", () => {
      expect(normalizeKebabFlags(["add", "--keep-from=クラーク-ß"])).toEqual([
        "add",
        "--keepFrom=クラーク-ß",
      ]);
      // Non-ASCII "flag names" don't match the ASCII flag pattern, so pass through.
      expect(normalizeKebabFlags(["--ドライ-ラン", "--é-à"])).toEqual(["--ドライ-ラン", "--é-à"]);
    });

    it("does not touch Unicode positionals after a bare `--`", () => {
      expect(normalizeKebabFlags(["exec", "--", "echo", "你好", "--inner-flag"])).toEqual([
        "exec",
        "--",
        "echo",
        "你好",
        "--inner-flag",
      ]);
    });
  });
});
