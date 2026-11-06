import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const doc = readFileSync(
  new URL("../docs/apply-placeholder-operator-check.md", import.meta.url),
  "utf8",
);
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

function examples(text: string): string[] {
  return [...text.matchAll(/```text\n([\s\S]*?)\n\s*```/g)].map((match) =>
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .join("\n"),
  );
}

describe("apply placeholder operator check", () => {
  it("uses the changelog's missing and unreadable inventory examples", () => {
    const samples = examples(doc);
    expect(samples).toHaveLength(2);
    const sourceSamples = examples(changelog);
    for (const sample of samples) expect(sourceSamples).toContain(sample);
    expect(samples[0]).toContain("not in Phantom: OPENAI_API_KEY");
    expect(samples[1]).toContain("phantom-wire skipped: openai");
  });

  it("identifies the historical failure without giving a command to create a placeholder", () => {
    expect(changelog).toContain("TODO_STACK_APPLY --rotate");
    expect(doc).toContain("`TODO_STACK_APPLY`");
    expect(doc).toContain("old `envelopes` count was always 0");
    expect(doc).toContain("Do not create placeholder values");
    expect(doc).not.toMatch(/phantom add[^\n`]*TODO_STACK_APPLY/);
    expect(doc).toContain("entering the real value when prompted");
  });
});
