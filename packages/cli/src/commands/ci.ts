import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineCommand } from "citty";
import { hasConfig } from "@ashlr/stack-core";
import { colors, intro, outro, outroError } from "../ui.ts";

const DEFAULT_WORKFLOW = `name: Stack doctor

# Runs \`stack doctor --json --all\` in CI. Requires two repository secrets:
#
#   PHANTOM_VAULT_PASSPHRASE  — passphrase for the encrypted-file vault fallback
#                                (Phantom uses this in CI where keychain isn't available).
#   PHANTOM_CLOUD_TOKEN       — GitHub OAuth device token for \`phantom cloud pull\`.
#
# Both are created once with \`phantom login\` + \`phantom cloud push\` locally, then
# copied into GitHub \`Settings → Secrets and variables → Actions\`.

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    # Nightly drift check — catches when an upstream key gets revoked out of band.
    - cron: "0 7 * * *"
  workflow_dispatch:

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Phantom Secrets
        run: npm install -g phantom-secrets

      - name: Install Stack CLI
        run: npm install -g @ashlr/stack

      - name: Pull vault from Phantom Cloud
        env:
          PHANTOM_CLOUD_TOKEN: \${{ secrets.PHANTOM_CLOUD_TOKEN }}
          PHANTOM_VAULT_PASSPHRASE: \${{ secrets.PHANTOM_VAULT_PASSPHRASE }}
        run: phantom cloud pull --force

      - name: Run stack doctor
        run: stack doctor --json > stack-doctor.json

      - name: Upload doctor report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: stack-doctor-report
          path: stack-doctor.json
`;

/**
 * `stack ci init` — scaffold a ready-to-commit GitHub Actions workflow that
 * runs `stack doctor --json` on every push + nightly, backed by Phantom Cloud
 * for secret pull. The YAML is opinionated but gives a correct-by-default
 * starting point; users tweak from there.
 */
export const ciCommand = defineCommand({
  meta: {
    name: "ci",
    description: "Scaffold CI integrations that run `stack doctor` on pushes + nightly.",
  },
  subCommands: {
    init: defineCommand({
      meta: {
        name: "init",
        description: "Write .github/workflows/stack-ci.yml for GitHub Actions.",
      },
      args: {
        force: {
          type: "boolean",
          default: false,
          description: "Overwrite an existing stack-ci.yml.",
        },
      },
      async run({ args }) {
        intro("stack ci init");
        if (!hasConfig()) {
          outroError("No .stack.toml found. Run `stack init` first.");
          return;
        }
        const cwd = process.cwd();
        const dir = resolve(join(cwd, ".github", "workflows"));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const path = join(dir, "stack-ci.yml");
        if (existsSync(path) && !args.force) {
          outroError(`${path} already exists. Pass --force to overwrite.`);
          return;
        }
        await writeFile(path, DEFAULT_WORKFLOW, "utf-8");
        console.log();
        console.log(`  ${colors.green("●")} wrote ${colors.bold(".github/workflows/stack-ci.yml")}`);
        console.log();
        console.log(colors.dim("  Next steps:"));
        console.log(colors.dim("    1. Add PHANTOM_VAULT_PASSPHRASE + PHANTOM_CLOUD_TOKEN to repo secrets."));
        console.log(colors.dim("    2. Commit the workflow."));
        console.log(
          colors.dim("    3. Watch the first run in Actions — downloads the doctor report as an artifact."),
        );
        console.log();
        outro(colors.green("CI workflow scaffolded."));
      },
    }),
  },
});
