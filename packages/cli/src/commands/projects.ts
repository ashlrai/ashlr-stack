import { resolve } from "node:path";
import {
  findProjectByName,
  listProjects,
  registerProject,
  unregisterProject,
} from "@ashlr/stack-core";
import { defineCommand, runCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

/**
 * `stack projects` — work across every Stack-enabled project on this machine.
 *
 *   stack projects list
 *   stack projects register   (register the current cwd)
 *   stack projects remove <name|path>
 *   stack projects where <name>
 */
/**
 * Stable machine shape for `stack projects list --json`. Fields may be added
 * but existing ones must not change meaning.
 */
export interface ProjectsReport {
  schema: "ashlr.stack.projects/v1";
  total: number;
  projects: Array<{
    name: string;
    path: string;
    project_id: string;
    template: string | null;
    services: string[];
    last_seen: string;
  }>;
}

export async function buildProjectsReport(): Promise<ProjectsReport> {
  const projects = (await listProjects()).map((p) => ({
    name: p.name,
    path: p.path,
    project_id: p.project_id,
    template: p.template ?? null,
    services: [...p.services],
    last_seen: p.last_seen,
  }));
  return { schema: "ashlr.stack.projects/v1", total: projects.length, projects };
}

const projectsListCommand = defineCommand({
  meta: { name: "list", description: "List every Stack-enabled project on this machine." },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (schema ashlr.stack.projects/v1).",
    },
  },
  async run({ args }) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(await buildProjectsReport(), null, 2)}\n`);
      return;
    }
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
});

export const projectsCommand = defineCommand({
  meta: {
    name: "projects",
    description: "Manage the cross-project registry at ~/.stack/projects.json.",
  },
  subCommands: {
    list: projectsListCommand,
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
      meta: {
        name: "remove",
        description: "Remove a project from the registry (does not delete files).",
      },
      args: {
        target: {
          type: "positional",
          required: true,
          description: "Project name or absolute path.",
        },
      },
      async run({ args }) {
        intro("stack projects remove");
        const target = String(args.target);
        // A registered name first, then the argument as a path (absolute or
        // relative to cwd). Only claim success when an entry was dropped.
        const byName = await findProjectByName(target);
        const removed = await unregisterProject(byName?.path ?? resolve(target));
        if (!removed) {
          outroError(
            `No registered project matches "${target}". Run \`stack projects list\` for names and paths.`,
          );
          return;
        }
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
  // Bare `stack projects` means `stack projects list` (see env.ts).
  async run({ rawArgs }) {
    if (rawArgs.some((a) => !a.startsWith("-"))) return;
    await runCommand(projectsListCommand, { rawArgs });
  },
});
