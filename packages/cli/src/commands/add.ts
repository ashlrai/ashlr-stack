import { spawnSync } from "node:child_process";
import {
  addService,
  detectPackageManager,
  findProviderRef,
  getProvider,
  hasConfig,
  installCommand,
  listProviderNames,
} from "@ashlr/stack-core";
import {
  dryRunProvider,
  formatDryRunReport,
  formatDryRunReportJson,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { requirePhantom } from "../lib/phantom-preflight.ts";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";

export const addCommand = defineCommand({
  meta: {
    name: "add",
    description: "Provision a service and wire its secrets + MCP entry.",
  },
  args: {
    service: {
      type: "positional",
      required: false,
      description: "Service name (e.g. supabase, neon, vercel). Omit for interactive picker.",
    },
    use: {
      type: "string",
      description: "Attach to an existing resource by id instead of creating a new one.",
    },
    region: {
      type: "string",
      description: "Region hint for providers that need one (e.g. us-east-1).",
    },
    dryRun: {
      type: "boolean",
      default: false,
      description: "Preview what would happen (no network calls, no vault writes, no MCP edits).",
    },
    install: {
      type: "string",
      default: "ask",
      description: "SDK install behaviour after provisioning: ask (default), always, never.",
    },
    webhookEndpoint: {
      type: "string",
      description:
        "Stripe only: HTTPS URL to register as a webhook endpoint. Triggers webhook provisioning and stores STRIPE_WEBHOOK_SECRET + STRIPE_WEBHOOK_ENDPOINT_ID in Phantom.",
    },
    events: {
      type: "string",
      description:
        "Stripe only: comma-separated list of Stripe events to subscribe to. Defaults to the subscription-lifecycle set when --webhook-endpoint is given.",
    },
    secretKeyFromVault: {
      type: "boolean",
      default: false,
      description:
        "Stripe only: skip the interactive sk_… paste and reuse STRIPE_SECRET_KEY already in Phantom.",
    },
    timeout: {
      type: "string",
      description:
        "Wall-clock timeout in seconds for each provider step (login, provision, materialize). Defaults to 30. Pass 0 to disable.",
    },
  },
  async run({ args }) {
    if (!hasConfig()) {
      intro("stack add");
      outroError("No .stack.toml found. Run `stack init` first.");
      return;
    }

    const available = listProviderNames();

    // Interactive picker when no service argument is provided.
    let service = args.service ? String(args.service) : undefined;
    if (!service) {
      if (!process.stdout.isTTY) {
        intro("stack add");
        outroError("No service specified. Usage: stack add <service>");
        return;
      }
      const grouped = await groupProvidersForPicker(available);
      const picked = await prompts.select({
        message: "Which service to add?",
        options: grouped,
      });
      if (prompts.isCancel(picked)) {
        intro("stack add");
        outroError("Cancelled.");
        return;
      }
      service = String(picked);
    }

    intro(`stack add ${service}${args.dryRun ? colors.dim(" (dry-run)") : ""}`);

    if (!args.dryRun) {
      await requirePhantom();
    }

    if (!available.includes(service)) {
      // Group the catalog by category so the suggestion doesn't wrap into an
      // unreadable one-line comma list on narrow terminals.
      const byCat: Record<string, string[]> = {};
      for (const name of available) {
        try {
          const p = await getProvider(name);
          if (!byCat[p.category]) byCat[p.category] = [];
          byCat[p.category].push(p.name);
        } catch {
          /* skip */
        }
      }
      const lines = Object.entries(byCat)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cat, names]) => `  ${colors.bold(cat.padEnd(10))} ${names.sort().join("  ")}`);
      console.log();
      console.log(`  Unknown provider ${colors.red(`"${service}"`)}.`);
      console.log();
      console.log(colors.dim("  Available providers:"));
      for (const line of lines) console.log(line);
      console.log();
      outroError("Pick one from the catalog above.");
      return;
    }

    // Dry-run: use the dry-run engine to produce a realistic preview.
    if (args.dryRun) {
      const hints = buildHints(args);
      const result = await dryRunProvider(service, {
        existingResourceId: args.use ? String(args.use) : undefined,
        hints,
        costEstimate: false,
      });

      // Always emit the structured table report
      const report = formatDryRunReport({
        generatedAt: new Date().toISOString(),
        providers: [result],
        totalSecrets: Object.keys(result.secrets).length,
        totalMcpEntries: result.mcpEntry ? 1 : 0,
      });

      console.log();
      for (const line of report.split("\n")) {
        console.log(`  ${line}`);
      }

      // SDK packages hint
      const dryRef = findProviderRef(service);
      const dryPkgs = dryRef?.sdkPackages ?? [];
      if (dryPkgs.length > 0) {
        console.log();
        console.log(
          `  ${colors.dim("sdk:")} would offer to install ${colors.bold(dryPkgs.join(", "))}`,
        );
      }

      console.log();
      outro(colors.dim("dry-run complete — nothing written."));
      return;
    }

    const spinner = prompts.spinner();
    try {
      spinner.start(`Wiring ${service}…`);
      const timeoutMs = args.timeout !== undefined
        ? Number(args.timeout) * 1000
        : undefined;
      const result = await addService({
        providerName: service,
        existingResourceId: args.use ? String(args.use) : undefined,
        hints: buildHints(args),
        interactive: process.stdout.isTTY === true,
        timeoutMs,
        log: (event) => {
          spinner.stop();
          logEvent(event);
          spinner.start(`Wiring ${service}…`);
        },
      });
      spinner.stop(
        `${colors.green("●")} ${result.displayName} (${result.resourceId}) · ${result.secretCount} secrets${
          result.mcpWired ? " · mcp wired" : ""
        }`,
      );

      // SDK install prompt.
      const ref = findProviderRef(service);
      const sdkPkgs = ref?.sdkPackages ?? [];
      if (sdkPkgs.length > 0) {
        await handleSdkInstall(sdkPkgs, args.install ? String(args.install) : "ask", args.dryRun);
      }

      // Nudge: remind the user to refresh .env.example.
      console.log(
        `  ${colors.dim("Run")} ${colors.bold("stack env export --example")} ${colors.dim("to refresh .env.example")}`,
      );

      outro(`${colors.green("✓")} ${service} is live.`);
    } catch (err) {
      spinner.stop(colors.red("Failed."));
      outroError((err as Error).message);
    }
  },
});

async function handleSdkInstall(pkgs: string[], mode: string, dryRun: boolean): Promise<void> {
  const pm = await detectPackageManager(process.cwd());
  const argv = installCommand(pm, pkgs);
  const cmdStr = argv.join(" ");

  const effectiveMode = !process.stdout.isTTY && mode === "ask" ? "never" : mode;

  if (effectiveMode === "never") {
    console.log();
    console.log(`  ${colors.dim("Next:")} run ${colors.bold(cmdStr)} to install the SDK.`);
    return;
  }

  if (effectiveMode === "ask") {
    console.log();
    const confirmed = await prompts.confirm({
      message: `Install SDK packages? ${colors.dim(pkgs.join(", "))}`,
      initialValue: true,
    });
    if (prompts.isCancel(confirmed) || !confirmed) {
      console.log(`  ${colors.dim("Skipped. Run:")} ${colors.bold(cmdStr)}`);
      return;
    }
  }

  // "always" or confirmed "ask" — run the install.
  if (dryRun) {
    console.log();
    console.log(`  ${colors.dim("[dry-run] would run:")} ${colors.bold(cmdStr)}`);
    return;
  }

  console.log();
  console.log(`  ${colors.dim("Running:")} ${colors.bold(cmdStr)}`);
  const result = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
  if (result.status !== 0) {
    console.log(
      `  ${colors.yellow("Warning:")} install exited with code ${result.status}. Run ${colors.bold(cmdStr)} manually.`,
    );
  }
}

function buildHints(
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const hints: Record<string, unknown> = {};
  if (args.region) hints.region = String(args.region);
  if (args.webhookEndpoint) hints.webhookEndpoint = String(args.webhookEndpoint);
  if (args.events) hints.events = String(args.events);
  if (args.secretKeyFromVault) hints.secretKeyFromVault = true;
  return Object.keys(hints).length > 0 ? hints : undefined;
}

async function groupProvidersForPicker(names: string[]) {
  const out: Array<{ label: string; value: string; hint?: string }> = [];
  for (const name of names) {
    try {
      const p = await getProvider(name);
      out.push({
        value: p.name,
        label: `${p.displayName} ${colors.dim(`· ${p.category}`)}`,
        hint: p.authKind,
      });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
