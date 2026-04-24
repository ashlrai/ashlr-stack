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
import { defineCommand } from "citty";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";

export const templatesCommand = defineCommand({
  meta: { name: "templates", description: "List or apply starter stack templates." },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List available templates." },
      run() {
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
    }),
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
              log: (event) => {
                spinner.stop();
                logEvent(event);
                spinner.start(`Adding ${name}…`);
              },
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
});
