export interface UseCaseLink {
  label: string;
  href: string;
}

export interface UseCase {
  slug: string;
  title: string;
  description: string;
  intent: string;
  claims: Array<{
    id: string;
    title: string;
    body: string[];
    command?: string;
    sources: [UseCaseLink, ...UseCaseLink[]];
  }>;
  docs: UseCaseLink[];
}

const source = (path: string, label: string): UseCaseLink => ({
  label,
  href: `https://github.com/ashlrai/ashlr-stack/blob/main/${path}`,
});

export const USE_CASES: UseCase[] = [
  {
    slug: "detect-project-services",
    title: "Identify services in an existing project",
    description:
      "Review the services a repository depends on before planning setup. Follow a local inventory workflow and interpret the evidence behind each result.",
    intent: "For an inherited codebase or a project you are preparing to onboard.",
    claims: [
      {
        id: "prepare",
        title: "1. Choose the project to inspect",
        body: [
          "Start in the repository you want to inspect and check your installed CLI help. The source scan accepts a directory through --path, so you can target a project without changing the shell's working directory.",
          "This guide describes the repository's source implementation. Check the install guide and your installed command help before relying on these flags; a source checkout and a published package can differ.",
        ],
        command: "stack scan --help",
        sources: [
          source("packages/cli/src/commands/scan.ts", "Scan command and flags"),
          { label: "Install and version guidance", href: "/docs/capabilities#install" },
        ],
      },
      {
        id: "inventory",
        title: "2. Generate a local service inventory",
        body: [
          "Run the JSON scan with low confidence included to review weaker signals alongside stronger matches. JSON mode returns detected provider names, confidence levels and source evidence, then exits without running provider setup or writing Stack configuration.",
          "The scanner reads supported package manifests, framework configuration files and .env.example. Its rules cover JavaScript, Python, Go and Rust manifests. This is a catalog-based inventory, not a complete audit of every import or remote account.",
        ],
        command: "stack scan --json --confidence low --path .",
        sources: [
          source("packages/cli/src/commands/scan.ts", "Read-only JSON branch"),
          source("packages/core/src/detect-source.ts", "Detection rules and file readers"),
        ],
      },
      {
        id: "interpret",
        title: "3. Review evidence before acting",
        body: [
          "Inspect each entry in hits, especially its sources and confidence. The default scan threshold is medium; an explicit low threshold includes more signals. An empty result means no matching signals met the selected threshold, not that the project has no external services.",
          "Keep this inventory separate from automated setup. --yes implies --auto and can invoke stack add for detected providers. Provider setup can contact external services, so select and authorize that work after reviewing the inventory.",
        ],
        sources: [
          source("packages/cli/src/commands/scan.ts", "Thresholds and setup branch"),
          { label: "Provider setup boundaries", href: "/docs/capabilities#boundaries" },
        ],
      },
      {
        id: "next-step",
        title: "4. Decide whether to onboard or reconcile",
        body: [
          "For a project with existing .stack.toml configuration, doctor --reconcile compares configured service keys with detected provider names. Use the drift review guide below to interpret differences before removing anything.",
          "For a project without Stack configuration, keep the scan as a planning artifact and review the quickstart before running stack add. A detected SDK alone does not establish working credentials or provider health.",
        ],
        sources: [
          source("packages/cli/src/commands/doctor.ts", "Reconciliation implementation"),
          source("packages/core/src/detect-source.ts", "Local evidence scope"),
          { label: "Project quickstart", href: "/docs/quickstart" },
        ],
      },
    ],
    docs: [
      { label: "CLI reference", href: "/docs/cli" },
      { label: "Provider catalog", href: "/docs/providers" },
    ],
  },
  {
    slug: "plan-saas-stack",
    title: "Plan a SaaS service configuration",
    description:
      "Inspect a starter configuration before provisioning. Review service declarations, local writes and the decisions needed before connecting provider accounts.",
    intent: "For a new project whose service choices need review before setup.",
    claims: [
      {
        id: "select",
        title: "1. Inspect the available templates",
        body: [
          "Check your installed help and list templates first. The source command's JSON output describes template names, service providers, secret slot names and MCP declarations. These are configuration declarations, not credentials or evidence of provisioned resources.",
          "The nextjs-supabase-posthog template declares Supabase and PostHog services with dev and prod environments. Its name does not mean Stack generates a Next.js application; the template is a TOML service definition.",
        ],
        command: "stack templates --help\nstack templates list --json",
        sources: [
          source("packages/cli/src/commands/templates.ts", "Template listing implementation"),
          source("templates/nextjs-supabase-posthog/stack.toml", "Starter service definition"),
        ],
      },
      {
        id: "preview-config",
        title: "2. Write configuration without provisioning",
        body: [
          "In a fresh project directory, use --noProvision to write the selected configuration without entering the provider setup loop. This operation still writes local files. It is not a no-write preview.",
          "Stack splits service shape into .stack.toml and instance data into .stack.local.toml, adds the local file to .gitignore, and attempts to register the project in the local ~/.stack registry. Existing configuration is protected unless --force is supplied. Keep --force out of an exploratory workflow.",
        ],
        command: "stack init --template nextjs-supabase-posthog --noProvision",
        sources: [
          source("packages/cli/src/commands/init.ts", "Init write and provisioning branches"),
          source("packages/core/src/config.ts", "Split configuration writer"),
        ],
      },
      {
        id: "review",
        title: "3. Review the service boundary",
        body: [
          "Inspect the declared services and secret slot names in .stack.toml. The starter's resource identifiers are not populated by --noProvision, and an MCP declaration does not show that an editor has loaded a working connection.",
          "Before setup, review provider access, costs and the Phantom Secrets requirements. Stack's source and public packages can differ, so verify the commands supported by the version you installed.",
        ],
        sources: [
          source("templates/nextjs-supabase-posthog/stack.toml", "Unprovisioned starter entries"),
          { label: "Credentials, costs and installation", href: "/docs/capabilities" },
          { label: "MCP configuration limits", href: "/docs/mcp" },
        ],
      },
      {
        id: "provisioning-decision",
        title: "4. Choose a setup workflow deliberately",
        body: [
          "Template init without --noProvision attempts provider setup. Separately, templates apply runs setup for eligible entries but skips services already present in the configuration. Do not assume that applying a template after a config-only init will provision every declared service.",
          "Use the templates and stack add references to choose the next action for your project. Review partial results and reported failures individually before treating the project as ready.",
        ],
        sources: [
          source("packages/cli/src/commands/init.ts", "Template init behavior"),
          source("packages/cli/src/commands/templates.ts", "Apply skip and failure handling"),
          { label: "Service setup guide", href: "/docs/add" },
        ],
      },
    ],
    docs: [
      { label: "Template reference", href: "/docs/templates" },
      { label: "Configuration reference", href: "/docs/config" },
    ],
  },
  {
    slug: "review-service-drift",
    title: "Review service configuration drift",
    description:
      "Compare a project's configured services with local detection evidence. Interpret orphaned and untracked entries before choosing any cleanup action.",
    intent: "For an established project after dependency or service changes.",
    claims: [
      {
        id: "prepare",
        title: "1. Check the configuration being compared",
        body: [
          "Run this workflow from the intended project directory with its .stack.toml available. Reconciliation compares configured service keys against provider names found by the local scanner. If configuration cannot be read, the source implementation uses an empty configured set; confirm the file is present and readable before interpreting the report.",
          "Review your installed CLI help before using the source flags shown here. The scan uses supported manifests, configuration files and .env.example, so a missing detection is a prompt to investigate rather than proof that a service is unused.",
        ],
        command: "stack doctor --help",
        sources: [
          source("packages/cli/src/commands/doctor.ts", "runReconcile and configuration fallback"),
          source("packages/core/src/detect-source.ts", "Detection evidence and limits"),
        ],
      },
      {
        id: "compare",
        title: "2. Generate the reconciliation report",
        body: [
          "The reconciliation branch reads configuration and local detection evidence without changing the service configuration. In JSON mode it returns after reconciliation rather than proceeding to provider health checks.",
          "Inspect the configured, detected, orphans and untracked arrays in the reconciliation report. Orphans are configured names absent from detection; untracked entries are detected names absent from configuration. Custom service keys can differ from provider names, so check that mapping when reviewing a mismatch.",
        ],
        command: "stack doctor --reconcile --json",
        sources: [
          source("packages/cli/src/commands/doctor.ts", "Reconciliation branch and set comparison"),
        ],
      },
      {
        id: "interpret",
        title: "3. Separate drift from provider health",
        body: [
          "The JSON reconciliation path returns normally even when it reports drift. Automation must inspect the report rather than interpreting a zero exit status as no differences.",
          "A matching local inventory does not establish that remote services are healthy. The regular doctor path performs separate configured-service checks and requires the Phantom setup. Use the CLI reference to select the check you actually need.",
        ],
        sources: [
          source(
            "packages/cli/src/commands/doctor.ts",
            "JSON completion and health-check branches",
          ),
          { label: "Doctor command reference", href: "/docs/cli#doctor" },
        ],
      },
      {
        id: "cleanup",
        title: "4. Review cleanup as a separate action",
        body: [
          "The source removal command's --allOrphans mode rescans current evidence, removes orphaned local configuration and MCP entries, and attempts Phantom secret cleanup. It does not consume a saved reconciliation report or delete upstream provider resources.",
          "Inspect the service mapping and current evidence before running removal. Secret cleanup can require terminal confirmation or leave stored secrets behind; read the reported result. Local cleanup does not close provider accounts or stop their billing.",
        ],
        sources: [
          source(
            "packages/cli/src/commands/remove.ts",
            "Local removal and upstream-resource boundary",
          ),
          {
            label: "Maintenance guide and cleanup limits",
            href: "/docs/maintenance#remove-orphans",
          },
        ],
      },
    ],
    docs: [
      { label: "Maintenance reference", href: "/docs/maintenance" },
      { label: "Configuration reference", href: "/docs/config" },
    ],
  },
];
