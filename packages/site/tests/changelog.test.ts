import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const placeholderRemovalHeading = "- **`stack apply` stops attempting to write placeholder secrets.**";

function missingPlaceholderRemovalEntries(source: string, published: string): string[] {
  return [
    ["CHANGELOG.md", source],
    ["packages/site/src/data/CHANGELOG.md", published],
  ]
    .filter(([, changelog]) => !changelog.split("\n").some((line) => line.startsWith(placeholderRemovalHeading)))
    .map(([path]) => path);
}

test("both changelogs include the apply placeholder-removal entry", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(missingPlaceholderRemovalEntries(source, published)).toEqual([]);
});

test.each([
  [placeholderRemovalHeading, "", ["packages/site/src/data/CHANGELOG.md"]],
  ["", placeholderRemovalHeading, ["CHANGELOG.md"]],
  ["", "", ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]],
  [placeholderRemovalHeading, placeholderRemovalHeading, []],
])("placeholder-removal check reports each missing copy", (source, published, missing) => {
  expect(missingPlaceholderRemovalEntries(source, published)).toEqual(missing);
});

test("site changelog mirrors the source and explains apply's placeholder behavior", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(published).toBe(source);
  expect(published).not.toContain("`stack apply` stops writing placeholder secrets");

  const applyEntry = published
    .split("\n")
    .find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntry).toContain(
    "Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder for each declared secret, but those calls failed; the 0.2.1 fix above removed the attempts.",
  );
  expect(applyEntry).toContain(
    "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.",
  );
  expect(applyEntry).toContain("Provider setup may already store real values");
  expect(applyEntry).toContain("wiring reports how many secret names are present and missing and lists missing names");
  expect(applyEntry).toContain("Missing names alone do not make apply fail; provider failures still do.");
  expect(applyEntry).toContain("wiring reports providers as skipped instead of identifying missing names");
  expect(applyEntry).toContain("creates webhook stubs (Stripe, Clerk, Supabase, GitHub)");
  expect(applyEntry).toContain("Wiring is on by default; `--noWire` opts out");

  const fixEntry = published.split("\n").find((line) => line.startsWith(placeholderRemovalHeading));
  expect(fixEntry).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(fixEntry).toContain("Provider setup may already store real values");
  expect(fixEntry).toContain("users must supply each required missing value themselves");
  expect(fixEntry).toContain("it reports providers as skipped instead of identifying missing names");
  expect(fixEntry).toContain("Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`");
  expect(fixEntry).toContain("every call failed and the printed `envelopes` count was always 0");
  expect(applyEntry).toContain("Users must supply each required missing value");
  for (const entry of [applyEntry, fixEntry])
    expect(entry).toContain("run `phantom add <NAME>` from a trusted terminal and enter the real value");
});

test("current release apply note explains the action required even after success", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const version = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;
  const section = published.split(`## ${version} (`)[1]?.split("\n## ")[0];
  const entry = section?.split("\n").find((line) => line.startsWith("- After at least one provider succeeds, `stack apply`"));
  expect(entry).toContain("without creating placeholders or filling missing values");
  expect(entry).toContain("Provider setup may store real values separately");
  expect(entry).toContain("each required missing value needs user action");
  expect(entry).toContain("run `phantom add <NAME>` in a trusted terminal and enter the real value");
  expect(entry).toContain("Missing names alone do not make apply fail");
  expect(entry).toContain("If the vault cannot be read, providers are reported as skipped");
});
