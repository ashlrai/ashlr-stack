# CLI command map

This map describes the source CLI at version 0.3.0. Run `stack --help` and
`stack <command> --help` for the current syntax; nested commands also have
help. Examples assume `stack` is installed, a configured project where needed,
and the named files, services, or tools exist. Replace illustrative names and
paths with your own. Provider operations may require Phantom authentication;
fleet GitHub reports use Locus. Commands can fail when their inputs or external
services are unavailable.

The **State** column describes the command's possible effects, including
optional flags and subcommands, not just the example. “Read” means the Stack
operation does not intentionally change project or external service state;
network reads, telemetry, update checks, browser launches, and shell redirection
are separate effects. A child command run through `exec` can do anything.

| Command | Purpose | Example | State |
| --- | --- | --- | --- |
| `init` | Initialize a Stack project. | `stack init --noInteractive` | Writes project config, gitignore and project registry; templates can provision services. Even `--dryRun` writes local files. |
| `import` | Import an env file. | `stack import --from .env.local --dryRun` | Can write Phantom secrets and project config; example previews. |
| `scan` | Detect providers in a repository. | `stack scan --json` | Read normally; `--auto` can add services. |
| `clone` | Clone and scan a repository. | `stack clone https://github.com/example/example.git` | Creates a local directory. |
| `add` | Provision and wire a service. | `stack add supabase --dryRun` | Can provision resources and write secrets, config and MCP wiring; example previews. |
| `remove` | Remove a service's local wiring. | `stack remove supabase` | Changes config and MCP wiring and attempts secret removal; remote resources are retained. |
| `list` | List configured services. | `stack list --json` | Read. |
| `info` | Inspect one configured service. | `stack info supabase` | Read and health-check. |
| `status` | Check stack health. | `stack status --json` | Read and health-check. |
| `env` | Inspect or export the environment map. | `stack env show --json` | `export` writes `.env.example` unless `--stdout` is used; `show` and `diff` read. |
| `deps` | Show service dependencies. | `stack deps --json` | Read. |
| `doctor` | Diagnose services and configuration. | `stack doctor --json` | Read normally; `--fix` can remediate services. |
| `fleet-lanes` | Report dispatch lanes. | `stack fleet-lanes --json` | Read. |
| `fleet-supply` | Report fleet supply and idle time. | `stack fleet-supply --json` | Read. |
| `fleet-latency` | Report recent PR merge latency. | `stack fleet-latency --json` | Read via Locus. |
| `fleet-lag` | Report tag and merge lag. | `stack fleet-lag --json` | Read via Locus. |
| `fleet-waste` | Report launches and unfinished jobs. | `stack fleet-waste --json` | Read. |
| `fleet-reds` | Report failing CI jobs. | `stack fleet-reds --json` | Read via Locus. |
| `fleet-silent` | Report silent fleet failures. | `stack fleet-silent --json` | Read. |
| `fleet-collisions` | Rank files in conflicting PRs. | `stack fleet-collisions --file prs.json` | Read a JSON snapshot. |
| `fleet-delivery-lag` | Report undeployed merges from a fixture. | `stack fleet-delivery-lag --fixture delivery.json` | Read a JSON fixture. |
| `fleet-stuck` | Report open PRs and merge state. | `stack fleet-stuck --json` | Read via Locus. |
| `fleet-slo` | Compare fleet metrics with SLO targets. | `stack fleet-slo --json` | Read via Locus. |
| `fleet-act` | Preview a dispatcher request. | `stack fleet-act pause --lane codex-personal --json` | `--apply` appends an audit request for a dispatcher consumer; it does not execute the request. |
| `fleet-stream` | Translate fleet logs into NDJSON or SSE. | `stack fleet-stream --dispatch dispatch-events.log --jobs jobs.jsonl` | Reads logs; `--sse` opens a localhost listener and `--follow` keeps running. |
| `fleet-graph` | Report fleet nodes and relationships. | `stack fleet-graph --json` | Read. |
| `fleet-bets` | Report leader bet outcomes. | `stack fleet-bets --json` | Read. |
| `fleet` | Summarize fleet status. | `stack fleet --json` | Read via Locus; also offers `slo`, `collisions`, and `waste`. |
| `exec` | Run a command through Phantom. | `stack exec -- bun test` | The child command can change state. |
| `swap` | Migrate between providers. | `stack swap clerk auth0 --dryRun` | Can provision and remove wiring; example previews. |
| `sync` | Sync secrets to a deployment platform. | `stack sync --platform vercel` | Changes remote platform secrets. |
| `onboard` | Plan or configure agent integrations. | `stack onboard --json` | Plan by default; `--apply` or `--undo` changes client files. |
| `open` | Open a service dashboard. | `stack open supabase` | Launches a browser. |
| `login` | Refresh provider credentials. | `stack login github` | Changes credentials in Phantom. |
| `telemetry` | Manage telemetry preference. | `stack telemetry status` | `enable` and `disable` change the user preference; `status` reads it. |
| `templates` | List or apply templates. | `stack templates list --json` | `apply` provisions services; `list` reads. |
| `providers` | List supported providers. | `stack providers --json` | Read. |
| `recommend` | Recommend providers. | `stack recommend "app with postgres"` | Read normally; `--save` writes a recipe, `--synth` calls a local model. |
| `apply` | Apply a saved recipe. | `stack apply my-recipe` | Provisions and wires services and can initialize project config. |
| `projects` | Manage the project registry. | `stack projects list --json` | `register` and `remove` change the registry; `list` and `where` read. |
| `ci` | Report unavailable CI generation. | `stack ci --json` | Refuses with a nonzero exit; does not write a workflow. Use `stack doctor` instead. |
| `completion` | Emit shell completion. | `stack completion zsh` | Writes completion text to stdout. |
| `upgrade` | Check or install a CLI upgrade. | `stack upgrade --dryRun` | `--apply` can change the global npm installation; default checks npm. |

Nested command examples: `stack env export --example --stdout`, `stack env diff --json`,
`stack fleet slo --json`, `stack fleet collisions --file prs.json`,
`stack fleet waste --json`, `stack telemetry enable`, `stack telemetry disable`,
`stack templates apply nextjs-supabase-posthog`, `stack projects register`,
`stack projects remove my-project`, `stack projects where my-project`, and
`stack ci init --json` (also refuses). The table identifies their state effects.

The command-map test checks the table against root help and checks each example's
options against its command help. It also executes representative local examples
in an isolated project; examples needing credentials, external data, network, or
interactive input have their syntax checked without carrying out those operations.
