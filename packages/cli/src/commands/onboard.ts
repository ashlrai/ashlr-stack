import {
  AGENT_CLIENTS,
  type AgentClient,
  type OnboardEntryPlan,
  applyOnboarding,
  planOnboarding,
  undoOnboarding,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors } from "../ui.ts";

function label(p: OnboardEntryPlan): string {
  switch (p.state) {
    case "not-detected":
      return colors.dim("not installed");
    case "not-wired":
      return colors.yellow("not wired");
    case "wired":
      return colors.green("wired");
    case "differs":
      return colors.yellow("entry differs (left untouched)");
    case "error":
      return colors.red(`error: ${p.error ?? "unreadable"}`);
  }
}

export const onboardCommand = defineCommand({
  meta: {
    name: "onboard",
    description:
      "Detect Codex, Claude Code, Cursor and Gemini CLI and register the Phantom gateway in each (plan by default).",
  },
  args: {
    apply: {
      type: "boolean",
      description: "Write the changes. Without this flag nothing is written.",
    },
    undo: { type: "boolean", description: "Restore the files saved by the last --apply." },
    client: {
      type: "string",
      description: "Comma list: claude,codex,cursor,gemini. Default: all.",
    },
    all: { type: "boolean", description: "Also wire clients that are not detected." },
    home: { type: "string", description: "Home directory to use (default: your home)." },
    json: { type: "boolean", description: "Emit JSON." },
  },
  async run({ args }) {
    const home = args.home ? String(args.home) : undefined;
    const out = (v: unknown): void => console.log(JSON.stringify(v, null, 2));

    if (args.undo) {
      try {
        const r = await undoOnboarding({ ...(home ? { home } : {}) });
        if (args.json) out(r);
        else {
          for (const e of r.restored)
            console.log(`  restored ${e.client}  ${colors.dim(e.configPath)}`);
          for (const x of r.refused)
            console.log(`  ${colors.yellow("refused")} ${x.entry.client}: ${x.reason}`);
        }
        if (r.refused.length > 0) process.exitCode = 1;
      } catch (err) {
        console.error(colors.red((err as Error).message));
        process.exitCode = 1;
      }
      return;
    }

    let clients: AgentClient[] | undefined;
    if (args.client) {
      clients = String(args.client)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as AgentClient[];
      const bad = clients.filter((c) => !AGENT_CLIENTS.includes(c));
      if (bad.length > 0 || clients.length === 0) {
        console.error(
          colors.red(
            `Unknown client: ${bad.join(", ") || "(none)"}. Use: ${AGENT_CLIENTS.join(", ")}.`,
          ),
        );
        process.exitCode = 2;
        return;
      }
    }
    const opts = {
      ...(home ? { home } : {}),
      ...(clients ? { clients } : {}),
      includeUndetected: Boolean(args.all),
    };

    if (!args.apply) {
      const plan = planOnboarding(opts);
      if (args.json) out({ mode: "plan", clients: plan });
      else {
        console.log(`\n  stack onboard ${colors.dim("(plan, nothing written)")}\n`);
        for (const p of plan) {
          console.log(`  ${p.client.padEnd(7)} ${label(p)}  ${colors.dim(p.configPath)}`);
        }
        const n = plan.filter((p) => p.willWrite).length;
        console.log(
          n > 0
            ? `\n  ${n} file(s) would change. Run \`stack onboard --apply\` to write them (backups are saved; \`--undo\` restores).\n`
            : "\n  Nothing to change.\n",
        );
      }
      if (planOnboarding(opts).some((p) => p.state === "error")) process.exitCode = 1;
      return;
    }

    const r = await applyOnboarding(opts);
    if (args.json) out({ mode: "apply", ...r });
    else {
      for (const e of r.written) {
        console.log(
          `  wrote ${e.client}  ${colors.dim(e.configPath)}${e.backupPath ? colors.dim(`  (backup ${e.backupPath})`) : ""}`,
        );
      }
      for (const p of r.verified) console.log(`  ${p.client.padEnd(7)} ${label(p)}`);
      if (r.written.length === 0) console.log("  Nothing to change.");
    }
    if (r.verified.some((p) => p.state === "error")) process.exitCode = 1;
  },
});
