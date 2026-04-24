import {
  type StackConfig,
  emptyConfig,
  hasConfig,
  isPhantomInstalled,
  listTemplates,
  loadTemplate,
  resolveConfigPath,
  writeConfig,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { provisionProviders } from "../lib/provision-loop.ts";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Scaffold a .stack.toml in the current directory.",
  },
  args: {
    template: {
      type: "string",
      description: "Name of a starter template to apply (e.g. nextjs-supabase-posthog).",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Overwrite an existing .stack.toml.",
    },
    noInteractive: {
      type: "boolean",
      default: false,
      description: "Skip template picker — always creates a blank .stack.toml.",
    },
    noProvision: {
      type: "boolean",
      default: false,
      description: "Write the .stack.toml shape from the template but skip provisioning services.",
    },
    dryRun: {
      type: "boolean",
      default: false,
      description:
        "Print what would be provisioned without doing it (implies --noProvision for real calls).",
    },
    noRollback: {
      type: "boolean",
      default: false,
      description:
        "On partial provisioning failure, keep successfully-added services instead of rolling them back.",
    },
  },
  async run({ args }) {
    intro("stack init");

    const cwd = process.cwd();
    if (hasConfig(cwd) && !args.force) {
      outroError(
        `${colors.bold(".stack.toml")} already exists at ${resolveConfigPath(cwd)}. Pass --force to overwrite.`,
      );
      return;
    }

    if (!(await isPhantomInstalled())) {
      prompts.log.warn(
        colors.yellow(
          "Phantom Secrets isn't on your PATH. Stack will create .stack.toml anyway, but `stack add` needs Phantom.",
        ),
      );
      prompts.log.info("  Install: brew install ashlrai/phantom/phantom");
    }

    let templateName = args.template ? String(args.template) : undefined;

    if (!templateName && !args.noInteractive && process.stdout.isTTY) {
      const available = listTemplates();
      if (available.length > 0) {
        const picked = await prompts.select({
          message: "Pick a starter template (or blank):",
          options: [
            { value: "", label: "Blank — add services later with `stack add`" },
            ...available.map((name) => ({ value: name, label: name })),
          ],
        });
        if (prompts.isCancel(picked)) {
          outroError("Cancelled.");
          return;
        }
        if (picked) templateName = String(picked);
      }
    }

    let config: StackConfig;
    if (templateName) {
      const loaded = await loadTemplate(templateName);
      if (!loaded) {
        outroError(`Unknown template: ${templateName}`);
        return;
      }
      config = loaded;
      config.stack.template = templateName;
    } else {
      config = emptyConfig();
    }

    await writeConfig(config, cwd);

    // When no template was selected (blank init or --noInteractive), provisioning
    // has nothing to do. Also skip when --noProvision is explicitly passed.
    const serviceNames = Object.keys(config.services);
    if (templateName && serviceNames.length > 0 && !args.noProvision) {
      const targets = serviceNames.map((name) => ({ name }));

      if (args.dryRun) {
        console.log();
        console.log(
          `  ${colors.bold(".stack.toml")} written (${config.stack.project_id}) from template ${colors.bold(templateName)}.`,
        );
        await provisionProviders(targets, { rollback: false, dryRun: true });
        outro(`Dry run complete — ${serviceNames.length} service(s) would be provisioned.`);
        return;
      }

      console.log();
      console.log(
        `  ${colors.bold(".stack.toml")} written (${config.stack.project_id}) from template ${colors.bold(templateName)}.`,
      );
      console.log(
        colors.dim(`  Provisioning ${serviceNames.length} service(s): ${serviceNames.join(", ")}`),
      );
      console.log();

      const { succeeded, failures } = await provisionProviders(targets, {
        rollback: !args.noRollback,
      });

      if (failures.length > 0) {
        outroError(
          `Some services failed to provision: ${failures.map((f) => `${f.name}: ${f.message}`).join("; ")}`,
        );
        return;
      }

      outro(
        `${colors.green("✓")} ${succeeded.length} service(s) live. Run ${colors.bold("stack doctor")} to verify.`,
      );
    } else {
      outro(
        `Wrote ${colors.bold(".stack.toml")} (${config.stack.project_id})${templateName ? ` from template ${colors.bold(templateName)}` : ""}.`,
      );
    }
  },
});
