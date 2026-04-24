import { readConfig, removeSecret, scanSource, writeConfig } from "@ashlr/stack-core";
import { removeMcpEntry } from "@ashlr/stack-core/mcp-writer";
import { defineCommand } from "citty";
import { requirePhantom } from "../lib/phantom-preflight.ts";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";

export const removeCommand = defineCommand({
  meta: {
    name: "remove",
    description: "Remove a service from the stack (vault entries and MCP config).",
  },
  args: {
    service: {
      type: "positional",
      required: false,
      description: "Service name. Omit with --all to remove every service.",
    },
    all: {
      type: "boolean",
      default: false,
      description: "Remove every service in this stack (with confirmation).",
    },
    allOrphans: {
      type: "boolean",
      default: false,
      description:
        "Detect services configured in .stack.toml but no longer present in source, then remove them.",
    },
    keepRemote: {
      type: "boolean",
      default: false,
      description: "Leave the provider-side resource untouched (don't deprovision).",
    },
  },
  async run({ args }) {
    if (args.allOrphans) return runRemoveAllOrphans(Boolean(args.keepRemote));
    if (args.all) return runRemoveAll(Boolean(args.keepRemote));
    if (!args.service) {
      intro("stack remove");
      outroError(
        "Missing service name. Pass --all to remove every service, or --allOrphans to remove drift.",
      );
      return;
    }
    return runRemoveOne(String(args.service), Boolean(args.keepRemote));
  },
});

async function runRemoveAllOrphans(keepRemote: boolean): Promise<void> {
  intro("stack remove --all-orphans");
  const config = await readConfig().catch(() => undefined);
  if (!config) {
    outroError("No .stack.toml found in current directory.");
    return;
  }

  const configured = Object.keys(config.services);
  if (configured.length === 0) {
    outro(colors.dim("No services configured — nothing to check."));
    return;
  }

  const detections = await scanSource(process.cwd());
  const detectedSet = new Set(detections.map((d) => d.provider));
  const orphans = configured.filter((name) => !detectedSet.has(name));

  if (orphans.length === 0) {
    outro(colors.green("No orphans found — all configured services are still used in source."));
    return;
  }

  console.log();
  console.log(`  ${colors.bold("Orphaned services (configured but not found in source):")}`);
  for (const name of orphans) {
    const entry = config.services[name];
    console.log(
      `    ${colors.yellow("⚠")} ${name.padEnd(14)} ${colors.dim(`${entry.secrets.length} secret(s)`)}`,
    );
  }
  console.log();

  const isTTY = process.stdout.isTTY === true;
  const confirmed = isTTY
    ? await prompts.confirm({
        message: `Remove ${orphans.length} orphaned service(s) and their secrets?`,
        initialValue: true,
      })
    : true;

  if (!confirmed || prompts.isCancel(confirmed)) {
    outroError("Cancelled.");
    return;
  }

  const totalOrphanSecrets = orphans.reduce(
    (n, name) => n + config.services[name].secrets.length,
    0,
  );
  if (totalOrphanSecrets > 0) await requirePhantom();
  let totalSecrets = 0;
  for (const name of orphans) {
    const entry = config.services[name];
    for (const secret of entry.secrets) {
      await removeSecret(secret);
      totalSecrets++;
    }
    if (entry.mcp) await removeMcpEntry(entry.mcp);
    delete config.services[name];
  }
  await writeConfig(config);

  outro(
    colors.green(
      `Removed ${orphans.length} orphaned service(s), ${totalSecrets} secret(s).${keepRemote ? " (upstream resources kept)" : ""}`,
    ),
  );
}

async function runRemoveOne(serviceName: string, keepRemote: boolean): Promise<void> {
  intro(`stack remove ${serviceName}`);
  const config = await readConfig();
  const entry = config.services[serviceName];
  if (!entry) {
    outroError(`${serviceName} is not in this stack.`);
    return;
  }

  const confirmed = process.stdout.isTTY
    ? await prompts.confirm({
        message: `Remove ${serviceName} from .stack.toml, delete its ${entry.secrets.length} secret(s), and ${keepRemote ? "keep" : "deprovision"} the upstream resource?`,
        initialValue: false,
      })
    : true;
  if (!confirmed || prompts.isCancel(confirmed)) {
    outroError("Cancelled.");
    return;
  }

  if (entry.secrets.length > 0) await requirePhantom();
  for (const secret of entry.secrets) {
    await removeSecret(secret);
  }
  if (entry.mcp) await removeMcpEntry(entry.mcp);
  delete config.services[serviceName];
  await writeConfig(config);

  outro(colors.green(`Removed ${serviceName}.`));
}

async function runRemoveAll(keepRemote: boolean): Promise<void> {
  intro("stack remove --all");
  const config = await readConfig();
  const serviceNames = Object.keys(config.services);
  if (serviceNames.length === 0) {
    outro(colors.dim("No services to remove."));
    return;
  }

  const totalSecrets = Object.values(config.services).reduce((acc, e) => acc + e.secrets.length, 0);

  console.log();
  console.log(`  ${colors.bold("About to remove:")}`);
  for (const name of serviceNames) {
    const entry = config.services[name];
    console.log(
      `    ${colors.red("●")} ${name.padEnd(14)} ${colors.dim(`${entry.secrets.length} secret(s)`)}`,
    );
  }
  console.log();

  // Two-step confirmation — large blast radius.
  if (process.stdout.isTTY) {
    const confirmed = await prompts.confirm({
      message: `Delete ${serviceNames.length} service(s), ${totalSecrets} secret(s), and strip MCP entries? ${keepRemote ? "(keeping upstream)" : "(deprovisioning upstream)"}`,
      initialValue: false,
    });
    if (!confirmed || prompts.isCancel(confirmed)) {
      outroError("Cancelled.");
      return;
    }
    const typed = await prompts.text({
      message: `Type ${colors.bold("remove all")} to confirm:`,
      validate(val) {
        return val === "remove all" ? undefined : "Type exactly: remove all";
      },
    });
    if (prompts.isCancel(typed)) {
      outroError("Cancelled.");
      return;
    }
  }

  if (totalSecrets > 0) await requirePhantom();
  for (const name of serviceNames) {
    const entry = config.services[name];
    for (const secret of entry.secrets) await removeSecret(secret);
    if (entry.mcp) await removeMcpEntry(entry.mcp);
    delete config.services[name];
  }
  await writeConfig(config);

  outro(colors.green(`Removed ${serviceNames.length} service(s), ${totalSecrets} secret(s).`));
}
