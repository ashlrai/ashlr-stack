import { readConfig, scanSource, writeConfig } from "@ashlr/stack-core";
import { removeMcpEntry } from "@ashlr/stack-core/mcp-writer";
import { defineCommand } from "citty";
import { removeVaultSecrets, requirePhantom } from "../lib/phantom-preflight.ts";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";

export const removeCommand = defineCommand({
  meta: {
    name: "remove",
    description:
      "Remove local service config and MCP wiring; attempt Phantom secret removal (headless runs may retain secrets).",
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
      description: "Remove every local service entry; prompt for confirmation in a terminal.",
    },
    allOrphans: {
      type: "boolean",
      default: false,
      description:
        "Detect services in .stack.toml no longer present in source, then remove their local entries.",
    },
    keepRemote: {
      type: "boolean",
      default: false,
      description: "Compatibility flag; upstream resources are kept for every removal.",
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
        message: `Remove ${orphans.length} orphaned local service(s) and attempt to remove their Phantom secrets? Upstream resources remain.`,
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
    const kept = await removeVaultSecrets(entry.secrets);
    totalSecrets += entry.secrets.length - kept.length;
    if (entry.mcp) await removeMcpEntry(entry.mcp);
    delete config.services[name];
  }
  await writeConfig(config);

  outro(
    colors.green(
      `Removed ${orphans.length} orphaned local service(s), ${totalSecrets} Phantom secret(s).${keepRemote ? " (upstream resources kept; --keepRemote selected)" : " (upstream resources kept)"}`,
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
        message: `Remove ${serviceName} from .stack.toml, attempt to remove its ${entry.secrets.length} Phantom secret(s), and remove its MCP entry if present? ${keepRemote ? "Upstream resource kept (--keepRemote selected)" : "Upstream resource kept"}.`,
        initialValue: false,
      })
    : true;
  if (!confirmed || prompts.isCancel(confirmed)) {
    outroError("Cancelled.");
    return;
  }

  if (entry.secrets.length > 0) await requirePhantom();
  await removeVaultSecrets(entry.secrets);
  if (entry.mcp) await removeMcpEntry(entry.mcp);
  delete config.services[serviceName];
  await writeConfig(config);

  outro(colors.green(`Removed ${serviceName} locally (upstream resource kept).`));
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
      message: `Remove ${serviceNames.length} local service(s), attempt to remove ${totalSecrets} Phantom secret(s), and strip MCP entries? ${keepRemote ? "(upstream resources kept; --keepRemote selected)" : "(upstream resources kept)"}`,
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
  let removedSecrets = 0;
  for (const name of serviceNames) {
    const entry = config.services[name];
    removedSecrets += entry.secrets.length - (await removeVaultSecrets(entry.secrets)).length;
    if (entry.mcp) await removeMcpEntry(entry.mcp);
    delete config.services[name];
  }
  await writeConfig(config);

  outro(
    colors.green(
      `Removed ${serviceNames.length} local service(s), ${removedSecrets} Phantom secret(s) (upstream resources kept).`,
    ),
  );
}
