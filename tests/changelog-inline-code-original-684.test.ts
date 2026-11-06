import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("inline-code fixture retains backtick-wrapped text in parsed entries", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-inline-code-original-684.md"))).toEqual([
    {
      version: "0.2.0",
      date: "2026-11-03",
      entries: ["Use `stack apply` to wire providers.", "Set `OPENAI_API_KEY` in `~/.env`.", "The `--noWire` flag opts out of wiring."],
    },
    {
      version: "0.1.0",
      date: "2026-04-19",
      entries: ["Run `stack scan` first, then `stack onboard`.", "Configure the provider in `.stack/config.json`."],
    },
  ]);
});
