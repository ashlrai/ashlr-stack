import { defineCommand } from "citty";
import {
  findProjectByName,
  listProjects,
  registerProject,
  unregisterProject,
} from "@ashlr/stack-core";
import { colors, intro, outro, outroError } from "../ui.ts";

/**
 * `stack projects` — work across every Stack-enabled project on this machine.
 *
 *   stack projects list
 *   stack projects register   (register the current cwd)
 *   stack projects remove <name|path>
 *   stack projects where <name>
 */
export const projectsCommand = defineCommand({
  meta: {
    name: "projects",
    description: "Manage the cross-project registry at ~/.stack/projects.json.",
  },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List every Stack-enabled project on this machine." },
      async run() {
        intro("stack projects");
        const projects = await listProjects();
        if (projects.length === 0) {
          outro(colors.dim("No projects registered yet. Run `stack init` in one to start."));
          return;
        }
        console.log();
        for (const p of projects) {
          const template = p.template ? colors.dim(` [${p.template}]`) : "";
          const services = p.services.length
            ? colors.dim(` · ${p.services.join(", ")}`)
            : colors.dim(" · no services");
          console.log(
            `  ${colors.green("●")} ${colors.bold(p.name)}${template}  ${colors.dim(p.project_id)}`,
          );
          console.log(`    ${colors.dim(p.path)}${services}`);
        }
        console.log();
      },
    }),
    register: defineCommand({
      meta: { name: "register", description: "Register the current directory in the registry." },
      async run() {
        intro("stack projects register");
        const entry = await registerProject(process.cwd());
        if (!entry) {
          outroError("No .stack.toml in the current directory — run `stack init` first.");
          return;
        }
        outro(colors.green(`Registered ${entry.name} (${entry.project_id}).`));
      },
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove a project from the registry (does not delete files)." },
      args: {
        target: { type: "positional", required: true, description: "Project name or absolute path." },
      },
      async run({ args }) {
        intro("stack projects remove");
        const target = String(args.target);
        const match = target.startsWith("/") ? target : (await findProjectByName(target))?.path;
        if (!match) {
          outroError(`No registered project matches "${target}".`);
          return;
        }
        await unregisterProject(match);
        outro(colors.green(`Removed ${target} from registry.`));
      },
    }),
    where: defineCommand({
      meta: { name: "where", description: "Print the path of a registered project." },
      args: {
        name: { type: "positional", required: true, description: "Project name." },
      },
      async run({ args }) {
        const project = await findProjectByName(String(args.name));
        if (!project) {
          process.exitCode = 1;
          console.error(`No registered project named "${args.name}".`);
          return;
        }
        console.log(project.path);
      },
    }),
  },
});
