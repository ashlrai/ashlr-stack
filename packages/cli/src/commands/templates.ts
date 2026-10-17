import {
  addService,
  assertPhantomInstalled,
  hasConfig,
  listProviderNames,
  listTemplates,
  loadTemplate,
  readConfig,
  writeConfig,
} from "@ashlr/stack-core";
import { defineCommand, runCommand } from "citty";
import { colors, intro, outro, outroError, prompts, spinnerBridge } from "../ui.ts";

/**
 * Stable machine shape for `stack templates list --json`. Fields may be added
 * but existing ones must not change meaning. Secret *names* only.
 */
export interface TemplatesReport {
  schema: "ashlr.stack.templates/v1";
  total: number;
  templates: Array<{
    name: string;
    services: Array<{ name: string; provider: string; secrets: string[]; mcp: string | null }>;
  }>;
}

export async function buildTemplatesReport(): Promise<TemplatesReport> {
  const templates: TemplatesReport["templates"] = [];
  for (const name of listTemplates()) {
    const template = await loadTemplate(name);
    templates.push({
      name,
      services: Object.entries(template?.services ?? {}).map(([service, spec]) => ({
        name: service,
        provider: spec.provider ?? service,
        secrets: [...(spec.secrets ?? [])],
        mcp: spec.mcp ?? null,
      })),
    });
  }
  return { schema: "ashlr.stack.templates/v1", total: templates.length, templates };
}

const templatesListCommand = defineCommand({
  meta: { name: "list", description: "List available templates." },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (schema ashlr.stack.templates/v1).",
    },
  },
  async run({ args }) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(await buildTemplatesReport(), null, 2)}\n`);
      return;
    }
    intro("stack templates");
    const names = listTemplates();
    if (names.length === 0) {
      outro(colors.dim("No templates yet."));
      return;
    }
    console.log();
    for (const name of names) console.log(`  ${colors.cyan("·")} ${colors.bold(name)}`);
    console.log();
  },
});

/** `stack templates` — list or apply starter templates. Bare `stack templates` runs `list`. */
export const templatesCommand = defineCommand({
  meta: { name: "templates", description: "List or apply starter stack templates." },
  subCommands: {
    list: templatesListCommand,
    apply: defineCommand({
      meta: {
        name: "apply",
        description: "Apply a template — runs `stack add` for each service listed.",
      },
      args: {
        name: { type: "positional", required: true, description: "Template name." },
        continueOnError: {
          type: "boolean",
          default: true,
          description: "Keep going when a single service fails (default: true).",
        },
      },
      async run({ args }) {
        const name = String(args.name);
        intro(`stack templates apply ${name}`);

        const template = await loadTemplate(name);
        if (!template) {
          outroError(`Unknown template: ${name}`);
          return;
        }

        try {
          await assertPhantomInstalled();
        } catch (err) {
          outroError((err as Error).message);
          return;
        }

        // If there's no .stack.toml, seed one from the template up front so
        // subsequent addService calls have a place to write.
        if (!hasConfig()) {
          await writeConfig({
            stack: {
              version: "1",
              project_id: `stk_${Math.random().toString(16).slice(2, 14)}`,
              template: name,
            },
            services: {},
            environments: template.environments ?? [{ name: "dev", default: true }],
          });
        }

        const config = await readConfig();
        const available = new Set(listProviderNames());
        const order = Object.keys(template.services ?? {});

        const results: { name: string; status: "ok" | "skip" | "fail"; detail?: string }[] = [];

        for (const name of order) {
          const spec = template.services[name];
          if (!spec) continue;
          const providerName = spec.provider ?? name;

          if (!available.has(providerName)) {
            results.push({ name, status: "skip", detail: "provider not registered" });
            continue;
          }
          if (config.services[providerName]) {
            results.push({ name, status: "skip", detail: "already in stack" });
            continue;
          }

          const spinner = prompts.spinner();
          spinner.start(`Adding ${name}…`);
          try {
            const result = await addService({
              providerName,
              interactive: process.stdout.isTTY === true,
              ...spinnerBridge(spinner, `Adding ${name}…`),
            });
            spinner.stop(
              `${colors.green("●")} ${name} → ${result.displayName} (${result.resourceId})`,
            );
            results.push({ name, status: "ok" });
          } catch (err) {
            spinner.stop(colors.red(`✗ ${name} failed: ${(err as Error).message}`));
            results.push({ name, status: "fail", detail: (err as Error).message });
            if (!args.continueOnError) break;
          }
        }

        console.log();
        const ok = results.filter((r) => r.status === "ok").length;
        const skip = results.filter((r) => r.status === "skip").length;
        const fail = results.filter((r) => r.status === "fail").length;
        if (fail > 0) {
          outroError(`${ok} added, ${skip} skipped, ${fail} failed.`);
        } else {
          outro(colors.green(`${ok} added, ${skip} skipped.`));
        }
      },
    }),
  },
  // citty 0.1.6 also calls this parent `run` after a matched subcommand, so
  // only fall through to `list` when no subcommand was given.
  async run({ rawArgs }) {
    if (rawArgs.some((a) => !a.startsWith("-"))) return;
    await runCommand(templatesListCommand, { rawArgs });
  },
});
