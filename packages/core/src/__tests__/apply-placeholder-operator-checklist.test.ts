import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const checklist = readFileSync(
  new URL("../../../../docs/apply-placeholder-operator-checklist.md", import.meta.url),
  "utf8",
);
const changelog = readFileSync(new URL("../../../../CHANGELOG.md", import.meta.url), "utf8");

it("identifies the historical marker as a failed attempt, never an operator value", () => {
  const marker = "TODO_STACK_APPLY";
  expect(changelog).toContain(marker);
  expect(checklist).toContain(marker);
  expect(checklist).toContain("attempts failed");
  expect(checklist).toContain("Do not use the marker as a secret value");
  for (const block of checklist.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    expect(block[1]).not.toContain(marker);
  }
});

it("directs operators to enter real values and treats incomplete inventory as unknown", () => {
  expect(checklist).toContain("`phantom add <NAME>`");
  expect(checklist).toContain("`phantom add OPENAI_API_KEY`");
  expect(checklist).toContain("enter the real value when prompted");
  expect(checklist).toContain("do not put the value in command");
  expect(checklist).toContain("`skipped`, not missing");
  expect(checklist).toContain("`--noWire` skips both name checks and webhook");
});
