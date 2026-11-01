import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("the changelog's unreadable vault example matches apply output", () => {
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-doc-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const phantom = join(bin, "phantom");
    writeFileSync(
      phantom,
      '#!/bin/sh\ncase "$1" in\n --version) echo fixture;;\n list) exit 1;;\n *) exit 1;;\nesac\n',
    );
    chmodSync(phantom, 0o700);
    mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
    writeFileSync(join(dir, ".stack.toml"), "");
    writeFileSync(
      join(dir, ".stack", "recipes", "example.toml"),
      'id = "example"\nquery = "ai"\ncreatedAt = "2026-10-17T00:00:00.000Z"\n\n[[providers]]\nname = "openai"\n',
    );

    // Exercise real wiring and formatting while avoiding provider network calls.
    const cli = join(root, "packages/cli/src");
    const script = join(dir, "run-apply.ts");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
mock.module(${JSON.stringify(join(cli, "lib/provision-loop.ts"))}, () => ({
  provisionProviders: async () => ({ succeeded: ["openai"], failures: [] }),
}));
mock.module(${JSON.stringify(join(cli, "lib/phantom-preflight.ts"))}, () => ({
  requirePhantom: async () => {},
}));
mock.module(${JSON.stringify(join(cli, "commands/doctor.ts"))}, () => ({
  doctorCommand: { run: async () => {} },
}));
const { applyCommand } = await import(${JSON.stringify(join(cli, "commands/apply.ts"))});
await applyCommand.run({ args: { recipeId: "example", noWire: false, noRollback: false } });
`,
    );
    const result = spawnSync("bun", [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: dir,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
        CI: "1",
      },
      timeout: 20_000,
    });
    expect(result.status).toBe(0);
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const example = changelog.match(
      /If the vault cannot be read, the same recipe instead reports:\n\n {2}```text\n([\s\S]*?)\n {2}```/,
    );
    expect(example).not.toBeNull();
    const output = example?.[1]
      .split("\n")
      .map((line) => line.slice(2))
      .join("\n");
    expect(output).toContain("missing 0");
    expect(output).toContain("phantom-wire skipped: openai");
    expect(result.stdout).toContain(output ?? "example missing");
    const guide = readFileSync(join(root, "docs/apply-observation.md"), "utf8");
    expect(guide).toContain(`\`\`\`text\n${output}\n\`\`\``);
    const userImpact = readFileSync(join(root, "docs/apply-user-impact.md"), "utf8");
    expect(userImpact).toContain(`\`\`\`text\n${output}\n\`\`\``);
    const faq = readFileSync(join(root, "docs/apply-placeholder-faq.md"), "utf8");
    expect(faq).toContain(`\`\`\`text\n${output}\n\`\`\``);
    const migration = readFileSync(join(root, "docs/apply-placeholder-migration.md"), "utf8");
    expect(migration).toContain(`\`\`\`text\n${output}\n\`\`\``);
    const upgradeQuestions = readFileSync(join(root, "docs/apply-placeholder-upgrade-questions.md"), "utf8");
    expect(upgradeQuestions).toContain(`\`\`\`text\n${output}\n\`\`\``);
    const operatorImpact = readFileSync(join(root, "docs/apply-placeholder-operator-impact.md"), "utf8");
    const impactExamples = [...operatorImpact.matchAll(/```text\n([\s\S]*?)\n\s*```/g)].map(
      (match) => match[1].split("\n").map((line) => line.trim()).join("\n"),
    );
    expect(impactExamples).toHaveLength(2);
    expect(result.stdout.split("\n").map((line) => line.trim()).join("\n")).toContain(impactExamples[1]);
    const readerGuide = readFileSync(join(root, "docs/changelog-apply-reader-guide.md"), "utf8");
    expect(readerGuide).toContain(`\`\`\`text\n${output}\n\`\`\``);
    expect(result.stdout).not.toContain("not in Phantom:");
    const history = readFileSync(join(root, "docs/apply-placeholder-history.md"), "utf8");
    const historyExample = history.match(/```text\n([\s\S]*?)\n```/);
    expect(historyExample).not.toBeNull();
    expect(result.stdout).toContain(historyExample?.[1] ?? "example missing");
    expect(changelog).toContain(
      "they do not establish that the vault is empty or that no values are missing",
    );

    // A readable, empty inventory should produce the FAQ's missing-name example
    // and must not invoke Phantom to add a placeholder.
    writeFileSync(
      phantom,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> phantom-calls\ncase "$1" in\n --version) echo fixture;;\n list) echo "[]";;\n *) exit 1;;\nesac\n',
    );
    const missing = spawnSync("bun", [script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH ?? ""}`, NO_COLOR: "1", CI: "1" },
      timeout: 20_000,
    });
    expect(missing.status).toBe(0);
    const missingExample = faq.match(/```text\n([\s\S]*?)\n```/);
    expect(missingExample).not.toBeNull();
    expect(missingExample?.[1]).toContain("not in Phantom: OPENAI_API_KEY");
    expect(missing.stdout).toContain(missingExample?.[1] ?? "example missing");
    expect(missing.stdout.split("\n").map((line) => line.trim()).join("\n")).toContain(impactExamples[0]);
    expect(migration).toContain(`\`\`\`text\n${missingExample?.[1]}\n\`\`\``);
    expect(upgradeQuestions).toContain(`\`\`\`text\n${missingExample?.[1]}\n\`\`\``);
    expect(readerGuide).toContain(`\`\`\`text\n${missingExample?.[1]}\n\`\`\``);
    expect(userImpact).toContain(`\`\`\`text\n${missingExample?.[1]}\n\`\`\``);
    expect(userImpact).toContain("`phantom add OPENAI_API_KEY`");
    expect(readFileSync(join(dir, "phantom-calls"), "utf8").trim().split("\n")).toEqual([
      "--version",
      "list --json",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("reader guide locates and explains the historical apply fix", () => {
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const guide = readFileSync(join(root, "docs/changelog-apply-reader-guide.md"), "utf8");
  const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
  const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
  const entry = fixes?.trimStart().split("\n")[0] ?? "";
  expect(entry.startsWith("- **`stack apply` stops attempting to write placeholder secrets.**")).toBe(true);
  for (const detail of ["phantom add <KEY> TODO_STACK_APPLY --rotate", "every call failed", "`present` and `missing`"]) {
    expect(entry).toContain(detail);
    expect(guide).toContain(detail);
  }
  expect(guide).toContain("](../CHANGELOG.md#021-2026-10-16)");
  expect(guide).toContain("missing\nnames alone do not fail it");
  expect(guide).toContain("`--noWire` skips\nboth the name checks and the stubs");
});

test("observation guide inspection commands and apply options exist in the CLI", async () => {
  const guide = readFileSync(join(root, "docs/apply-observation.md"), "utf8");
  expect(guide).toContain(
    "stack list --json\nstack status --json\nstack info <service> --json\nstack doctor --json",
  );
  const { listCommand } = await import("../packages/cli/src/commands/list.ts");
  const { statusCommand } = await import("../packages/cli/src/commands/status.ts");
  const { infoCommand } = await import("../packages/cli/src/commands/info.ts");
  const { doctorCommand } = await import("../packages/cli/src/commands/doctor.ts");
  const { applyCommand } = await import("../packages/cli/src/commands/apply.ts");
  for (const command of [listCommand, statusCommand, infoCommand, doctorCommand]) {
    expect(command.args).toHaveProperty("json");
  }
  expect(infoCommand.args).toHaveProperty("service");
  expect(applyCommand.args).toHaveProperty("noWire");
  expect(applyCommand.args).toHaveProperty("noRollback");
});

test("partial failure still checks the whole recipe without creating secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-partial-doc-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const phantom = join(bin, "phantom");
    writeFileSync(
      phantom,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> phantom-calls\ncase "$1" in\n --version) echo fixture;;\n list) echo "[]";;\n *) exit 1;;\nesac\n',
    );
    chmodSync(phantom, 0o700);
    mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
    writeFileSync(join(dir, ".stack.toml"), "");
    writeFileSync(
      join(dir, ".stack", "recipes", "example.toml"),
      'id = "example"\nquery = "ai and payments"\ncreatedAt = "2026-10-17T00:00:00.000Z"\n\n[[providers]]\nname = "openai"\n\n[[providers]]\nname = "stripe"\n',
    );
    const cli = join(root, "packages/cli/src");
    const script = join(dir, "run-apply.ts");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
mock.module(${JSON.stringify(join(cli, "lib/provision-loop.ts"))}, () => ({
  provisionProviders: async () => ({ succeeded: ["openai"], failures: [{ name: "stripe", message: "fixture failure" }] }),
}));
mock.module(${JSON.stringify(join(cli, "lib/phantom-preflight.ts"))}, () => ({ requirePhantom: async () => {} }));
mock.module(${JSON.stringify(join(cli, "commands/doctor.ts"))}, () => ({ doctorCommand: { run: async () => {} } }));
const { applyCommand } = await import(${JSON.stringify(join(cli, "commands/apply.ts"))});
await applyCommand.run({ args: { recipeId: "example", noWire: process.argv.includes("--noWire"), noRollback: false } });
`,
    );
    const result = spawnSync("bun", [script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH ?? ""}`, NO_COLOR: "1", CI: "1" },
      timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("OPENAI_API_KEY");
    expect(result.stdout).toContain("STRIPE_SECRET_KEY");
    expect(result.stdout).toContain("webhooks 1");
    expect(result.stdout + result.stderr).toContain("Some providers failed: stripe: fixture failure");
    expect(readFileSync(join(dir, ".stack/webhooks/stripe.ts"), "utf8")).toContain("stripe-signature");
    expect(readFileSync(join(dir, "phantom-calls"), "utf8").trim().split("\n")).toEqual([
      "--version",
      "list --json",
    ]);

    // Opting out skips both the inventory and the webhook file, even after a
    // partial provider failure. Provider failure still determines the exit.
    rmSync(join(dir, ".stack/webhooks/stripe.ts"));
    rmSync(join(dir, "phantom-calls"));
    const noWire = spawnSync("bun", [script, "--noWire"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH ?? ""}`, NO_COLOR: "1", CI: "1" },
      timeout: 20_000,
    });
    expect(noWire.status).toBe(1);
    expect(noWire.stdout + noWire.stderr).toContain("Some providers failed: stripe: fixture failure");
    expect(noWire.stdout).not.toContain("secrets in vault");
    expect(() => readFileSync(join(dir, ".stack/webhooks/stripe.ts"))).toThrow();
    expect(() => readFileSync(join(dir, "phantom-calls"))).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
