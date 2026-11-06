import { describe, expect, test } from "bun:test";
import { runCommand } from "citty";
import { doctorCommand } from "../commands/doctor.ts";
import { parseListArg } from "../lib/doctor-fix.ts";

describe("doctor optional tool flags through Citty", () => {
  for (const flag of ["install", "apply"] as const) {
    for (const trailing of [[], ["--json"]]) {
      test(`bare --${flag} ${trailing.join(" ")} parses as boolean`, async () => {
        const rawArgs = ["--ecosystem", `--${flag}`, ...trailing];
        let called = false;
        await runCommand(
          {
            ...doctorCommand,
            run({ args, rawArgs: received }) {
              called = true;
              expect(args[flag]).toBe(true);
              expect(args.ecosystem).toBe(true);
              expect(args.json).toBe(trailing.length > 0);
              expect(received).toEqual(rawArgs);
              expect(parseListArg(received, `--${flag}`)).toEqual([]);
            },
          },
          { rawArgs },
        );
        expect(called).toBe(true);
      });
    }

    for (const tokens of [[`--${flag}`, "locus,lexicon"], [`--${flag}=locus,lexicon`]]) {
      test(`${tokens.join(" ")} preserves the explicit tool allowlist`, async () => {
        let called = false;
        await runCommand(
          {
            ...doctorCommand,
            run({ rawArgs }) {
              called = true;
              expect(parseListArg(rawArgs, `--${flag}`)).toEqual(["locus", "lexicon"]);
            },
          },
          { rawArgs: ["--ecosystem", ...tokens, "--json"] },
        );
        expect(called).toBe(true);
      });
    }
  }

  test("bare install and apply stay distinct from an absent tool list", async () => {
    let called = false;
    await runCommand(
      {
        ...doctorCommand,
        run({ args, rawArgs }) {
          called = true;
          expect(args.install).toBe(true);
          expect(args.apply).toBe(true);
          expect(parseListArg(rawArgs, "--install")).toEqual([]);
          expect(parseListArg(rawArgs, "--apply")).toEqual([]);
          expect(parseListArg(rawArgs, "--missing")).toBeUndefined();
        },
      },
      { rawArgs: ["--ecosystem", "--install", "--apply", "--json"] },
    );
    expect(called).toBe(true);
  });
});
