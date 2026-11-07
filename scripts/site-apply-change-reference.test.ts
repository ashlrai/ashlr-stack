import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/site-apply-change-reference.md");
const rawDoc = readFileSync(docPath, "utf8");
const doc = rawDoc.replace(/\s+/g, " ");
const sitePath = "packages/site/src/data/CHANGELOG.md";
const site = readFileSync(join(root, sitePath), "utf8");

function section(release: string, subsection: string): string {
  const body = site.split(`## ${release}\n`)[1]?.split("\n## ")[0] ?? "";
  return body.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
}

// Every apply change entry the reference identifies:
// [release heading, subsection, text the bullet begins with, release anchor]
const entries = [
  ["Unreleased", "Changed", "`stack apply` does not create placeholder secrets.", "unreleased"],
  [
    "0.3.0 (2026-10-31)",
    "Changed and fixed",
    "Apply wiring checks existing secret names without storing placeholders",
    "030-2026-10-31",
  ],
  [
    "0.3.0 (2026-10-31)",
    "Changed",
    "After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names",
    "030-2026-10-31",
  ],
  [
    "0.2.2 (2026-10-25)",
    "Bug fixes",
    "**`stack apply` with a missing recipe writes nothing.**",
    "022-2026-10-25",
  ],
  [
    "0.2.2 (2026-10-25)",
    "Bug fixes",
    "**`stack apply` and `stack init --template` keep going after a provider fails.**",
    "022-2026-10-25",
  ],
  [
    "0.2.1 (2026-10-16)",
    "Bug fixes",
    "**`stack apply` stops attempting to write placeholder secrets.**",
    "021-2026-10-16",
  ],
  [
    "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    "AI recommendation layer — `stack recommend` + `stack apply`",
    "**`stack apply [recipe-id]`**",
    "010--2026-04-19-superseded-by-011",
  ],
] as const;

test("the reference identifies each apply change entry where the site data has it", () => {
  for (const [release, subsection, lead, anchor] of entries) {
    expect(doc).toContain(release.split(" ")[0]);
    expect(doc).toContain(subsection.split(" — ")[0]);
    expect(doc).toContain(lead.replace(/\s+/g, " "));
    expect(doc).toContain(`](../packages/site/src/data/CHANGELOG.md#${anchor})`);
    const bullets = section(release, subsection)
      .split("\n")
      .filter((line) => line.startsWith(`- ${lead}`));
    expect(bullets, `${release} → ${subsection}: ${lead}`).toHaveLength(1);
  }
});

test("the stated wiring behavior in the doc is supported by the entries", () => {
  const unreleased = section("Unreleased", "Changed");
  const detailed = section("0.3.0 (2026-10-31)", "Changed");
  const removal = section("0.2.1 (2026-10-16)", "Bug fixes");
  for (const phrase of [
    "every provider in the recipe, including providers that failed",
    "a missing name does not itself fail apply, while provider failures do",
    "webhook stubs for those recipe providers, even if the vault is unreadable",
    "Supply required missing secrets as real values through Phantom",
    "`--noWire` skips both checks and stubs",
  ]) {
    expect(unreleased).toContain(phrase);
  }
  for (const phrase of [
    "without creating placeholders or filling missing values",
    "Provider setup may store real values separately",
    "secrets in vault 0 · missing 1 · webhooks 0",
    "secrets in vault 0 · missing 0 · webhooks 0 · skipped 1",
    "providers are reported as skipped",
    "an applied recipe is not proof that every required secret is present",
  ]) {
    expect(detailed).toContain(phrase);
  }
  for (const phrase of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
    "every call failed and the printed `envelopes` count was always 0",
  ]) {
    expect(removal).toContain(phrase);
  }
  for (const summary of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
    "every call failed",
    "the printed `envelopes` count was always 0",
  ]) {
    expect(doc).toContain(summary.replace(/\s+/g, " "));
  }
  for (const summary of [
    "does not create placeholder secrets",
    "never writes to the vault",
    "`phantom list --json`",
    "`phantom add",
    "an applied recipe is not proof that every required secret is present",
    "`--noWire`",
  ]) {
    expect(doc).toContain(summary);
  }
});

test("the reference never describes placeholder writes as a current step", () => {
  // Same contract packages/site/tests/changelog.test.ts pins on the entries:
  // no "writes/creates/stores/adds ... placeholder" claim, even when the
  // historical description remains intact.
  const currentWrite = /\b(?:writes|creates|stores|adds)\b[^.!?]*\bplaceholders?\b/i;
  expect(doc).not.toMatch(currentWrite);
  expect(`${doc} Wiring now writes a placeholder.`).toMatch(currentWrite);
});

test("the reference accounts for bullets that only mention apply", () => {
  for (const signature of [
    "Expanded coverage for `stack apply` when",
    "**The last lines of a failing command reach a pipe on Bun 1.2.**",
    "**`stack recommend [query]`**",
  ]) {
    expect(site).toContain(`- ${signature}`);
    expect(doc).toContain(signature.replace(/\s+/g, " "));
  }
});

test("the documented commands locate the apply bullets and compare the copies", () => {
  const commands = [...rawDoc.matchAll(/```sh\n([^\n]+)\n```/g)].map((match) => match[1]);
  expect(commands).toHaveLength(2);
  const dir = mkdtempSync(join(tmpdir(), "site-apply-change-ref-"));
  try {
    mkdirSync(join(dir, dirname(sitePath)), { recursive: true });
    const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    writeFileSync(join(dir, "CHANGELOG.md"), source);
    writeFileSync(join(dir, sitePath), source);
    const run = (command: string) => spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8" });

    const search = run(commands[0]);
    expect(search.status).toBe(0);
    expect(search.stdout.trim().split("\n")).toHaveLength(9);
    expect(run(commands[1]).status).toBe(0);

    writeFileSync(
      join(dir, sitePath),
      source.replace("stops attempting to write placeholder secrets", "continues attempting them"),
    );
    expect(run(commands[1]).status).toBe(1);
    rmSync(join(dir, sitePath));
    expect(run(commands[1]).status).toBeGreaterThan(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reference links resolve", () => {
  for (const match of rawDoc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
