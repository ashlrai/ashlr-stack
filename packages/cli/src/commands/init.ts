import { defineCommand } from "citty";
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
    outro(
      `Wrote ${colors.bold(".stack.toml")} (${config.stack.project_id})${templateName ? ` from template ${colors.bold(templateName)}` : ""}.`,
    );
  },
});
