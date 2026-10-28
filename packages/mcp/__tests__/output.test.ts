import { expect, test } from "bun:test";
import { compactJsonOutput } from "../src/output.ts";
import { TOOLS } from "../src/tools.ts";

test("catalog retains every consumer input contract", () => {
  expect(
    TOOLS.map(({ name, inputSchema }) => ({
      name,
      ...inputSchema,
      properties: Object.fromEntries(
        Object.entries(inputSchema.properties).map(([key, { type }]) => [key, { type }]),
      ),
    })),
  ).toMatchSnapshot();
});

test("tools/list stays within the audited payload budget", () => {
  const payload = JSON.stringify({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  });
  expect(Buffer.byteLength(payload)).toBeLessThan(8500);
});

test("JSON compaction preserves nested fields, escapes, whitespace in values and numbers", () => {
  const input = `{
    "schema": "fixture/v1",
    "services": [{"name": "a b", "nested": {"empty": [], "nil": null, "ok": false}}],
    "escaped": "quote: \\" slash: \\\\ tab: \\t",
    "integer": 9007199254740993,
    "exponent": 1.00e+30
  }`;
  const output = compactJsonOutput(input, ["list", "--json"]);
  expect(output).toMatchSnapshot();
  expect(JSON.parse(output)).toEqual(JSON.parse(input));
  expect(output).toContain("9007199254740993");
  expect(output).toContain("1.00e+30");
  expect(compactJsonOutput(output, ["--json"])).toBe(output);
});

test("human output and malformed JSON retain their formatting", () => {
  for (const input of ['{\n  "a": 1\n}', 'warning\n{ "a": 1 }', '{ "broken":']) {
    expect(compactJsonOutput(input, [])).toBe(input);
  }
  expect(compactJsonOutput('warning\n{ "a": 1 }', ["--json"])).toBe(
    'warning\n{ "a": 1 }',
  );
  expect(compactJsonOutput("", ["--json"])).toBe("");
});
