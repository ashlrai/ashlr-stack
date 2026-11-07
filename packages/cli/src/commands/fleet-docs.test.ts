import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

interface FleetCommand {
  meta?: { name?: string };
  args?: Record<string, { type?: string }>;
}

const commandsDir = import.meta.dir;
const docPath = resolve(commandsDir, "../../../../docs/fleet-commands.md");
const doc = readFileSync(docPath, "utf8");

const files = readdirSync(commandsDir)
  .filter((name) => /^fleet-.+\.ts$/.test(name) && !name.endsWith(".test.ts"))
  .sort();

test("fleet command sources exist to document", () => {
  expect(files.length).toBeGreaterThan(0);
});

for (const file of files) {
  const name = file.replace(/\.ts$/, "");
  test(`docs/fleet-commands.md lists ${name} and its flags`, async () => {
    const mod = (await import(`./${file}`)) as Record<string, unknown>;
    const candidates = Object.values(mod).filter(
      (value): value is FleetCommand =>
        typeof value === "object" && value !== null && (value as FleetCommand).meta?.name === name,
    );
    expect(candidates).toHaveLength(1);
    const command = candidates[0]!;
    expect(doc).toContain(`\`${name}\``);
    for (const [key, arg] of Object.entries(command.args ?? {})) {
      if (arg.type === "positional") continue;
      expect(doc).toContain(`--${key}`);
    }
  });
}
