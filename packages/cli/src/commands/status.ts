import { defineCommand } from "citty";
import { hasConfig, isPhantomInstalled, listSecrets, readConfig } from "@ashlr/stack-core";
import { colors } from "../ui.ts";

export const statusCommand = defineCommand({
  meta: { name: "status", description: "Show stack health at a glance." },
  async run() {
    const hasStack = hasConfig();
    const phantomOk = await isPhantomInstalled();
    const config = hasStack ? await readConfig() : undefined;
    const vaultKeys = phantomOk ? await listSecrets().catch(() => []) : [];

    console.log();
    console.log(colors.bold("  Ashlr Stack"));
    console.log();
    console.log(
      `  ${statusDot(hasStack)} .stack.toml       ${hasStack ? colors.dim(config?.stack.project_id) : colors.dim("missing — run `stack init`")}`,
    );
    console.log(
      `  ${statusDot(phantomOk)} phantom           ${phantomOk ? colors.dim(`${vaultKeys.length} secrets in vault`) : colors.dim("not installed")}`,
    );
    console.log(
      `  ${statusDot(hasStack && Object.keys(config?.services ?? {}).length > 0)} services          ${colors.dim(`${Object.keys(config?.services ?? {}).length} configured`)}`,
    );
    console.log();
    if (config) {
      for (const [name, entry] of Object.entries(config.services)) {
        console.log(
          `    ${colors.cyan("·")} ${name.padEnd(14)} ${colors.dim(entry.resource_id ?? "-")}`,
        );
      }
      console.log();
    }
  },
});

function statusDot(ok: boolean): string {
  return ok ? colors.green("●") : colors.red("●");
}
