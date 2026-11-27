# Ashlr Stack docs

This folder holds the repository docs for Ashlr Stack. The published site docs are at [stack.ashlr.ai/docs](https://stack.ashlr.ai/docs), and agents should start with [llms.txt](https://stack.ashlr.ai/llms.txt) and [llms-full.txt](https://stack.ashlr.ai/llms-full.txt). The [README](../README.md) covers install, commands and MCP tools.

Stack is the service layer of the [Ashlr ecosystem](../README.md#part-of-the-ashlr-ecosystem): an autonomous, code-first, agent-native software factory chasing open-source RSI (recursive self-improvement), with agents doing the work and the human as a passive board member. Coding agents maintain these docs through pull requests. The rules they follow are in [AGENTS.md](../AGENTS.md); build and test steps are in [STACK.md](../STACK.md#agent-quickstart-from-a-clone). New contributors, human or agent, start with the [contributor path](../CONTRIBUTING.md#contribute-with-an-agent).

Many docs below are dated snapshots, research notes or proposals. Each one says so at the top. Check the source and `stack <command> --help` before relying on a snapshot.

## Use Stack

- [Getting started with the Ashlr tools together](getting-started-ecosystem.md): all seven tools (Phantom, Phantom Secrets, Locus, Lexicon, Ashlr Markdown, the ashlr plugin and Stack) with install commands.
- [Copy-paste examples](examples.md): runnable command blocks, starting with `stack providers --json`.
- [CLI command map](cli-command-map.md): every top-level command, an example, and what state it can change.
- [Scan an existing project](scan-guide.md), [scan output examples](scan-output-examples.md) and [troubleshooting `stack scan`](scan-troubleshooting.md).
- [Stack config files](stack-toml-schema.md): the `.stack.toml` and `.stack.local.toml` format the writer produces.
- [Provider auth matrix](provider-auth-matrix.md): how each provider authenticates.
- [Custom model endpoints](model-endpoints.md): `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `OLLAMA_HOST` and the allowed URLs.
- [Privacy policy](PRIVACY.md): telemetry is opt-in; what it collects and how to turn it off.

## Stack with Phantom Secrets and Locus

- [Stack with Phantom Secrets and Locus](phantom-locus.md): how the vault and identity plane fit with Stack.
- [Phantom agent preflight for `stack exec` and `stack doctor`](agent-preflight.md).
- [Ashlr companion handshake (v1)](ashlr-handshake.md): the format sibling tools use to report version and capabilities.
- [Core Phantom subprocess boundary](phantom-process.md): how core resolves and runs `phantom`.

## Contribute and release

- [Contribute with an agent](../CONTRIBUTING.md#contribute-with-an-agent): fork, install, the checks to run, what the required CI Gate check needs, and how PRs merge.
- [Adding a provider](adding-a-provider.md): every file to touch.
- [Releasing Ashlr Stack](RELEASE.md): the automatic release path, package identities and the last verified npm publication.
- Changelog upkeep: [format](changelog-format.md), [update and mirroring guide](changelog-mirroring.md), [source locations](changelog-source-locations.md), [entry source reference](changelog-entry-source-reference.md) and [reader note](changelog-reader-note.md).
- Site changelog: [review guide, checklist, apply entry source map and placeholder timeline](site-changelog-review.md).
- [Post-quantum readiness](PQ-READINESS.md): what cryptography Stack uses today.

## Fleet

The fleet commands read the state of the agent fleet that works on the Ashlr repos.

- [Fleet commands](fleet-commands.md): what each `fleet-*` command reads and reports.
- [Fleet machinery: source map](fleet-architecture.md).
- [Fleet job run records](fleet-job-runs.md) and [fleet job prompts](fleet-job-prompts.md).
- [Fleet outcome trends](fleet-metrics.md).
- [Worktree disk report](worktree-disk.md) and the [safe fleet worktree GC proposal](worktree-gc-proposal.md).
- [Fleet repo hygiene report](fleet-repo-hygiene.md) (data: [fleet-repo-hygiene.json](fleet-repo-hygiene.json)).
- [Autonomous fleet recovery](AUTONOMOUS-RECOVERY.md): operator runbook and proposal.
- Research and proposals: [leader fleet context](leader-fleet-context-proposal.md), [frontier local model evaluation](LOCAL-MODELS.md) and [Devin Local assessment](DDEVIN-LOCAL.md).

## Phantom wiring in `stack apply`

How `stack apply` wires Phantom for a recipe, and what its webhook examples do and do not verify. Start with [Phantom wiring status](phantom-wiring-status.md).

- Code and data: [code map and comment inventory](phantom-wire-code-map.md) and [data flow, provider table and trust limits](phantom-wire-data-flow.md).
- Boundaries: [wire boundary](phantom-wire-boundary.md) (inputs, outputs, error paths, trust boundary and the verification placeholder).
- Review: [signature and verification review](phantom-wire-signature-review.md) and [review and verification questions](phantom-wire-verification-questions.md).
- Webhook examples: [reading guide](phantom-wire-example-reading-guide.md) (with its trust boundary, wiring outputs, caveats, source map and review questions).

## The `stack apply` placeholder change

In 0.2.1, `stack apply` stopped trying to write placeholder secrets into Phantom. Start with the [placeholder history](apply-placeholder-history.md) or the [placeholder FAQ](apply-placeholder-faq.md), then [troubleshooting `stack apply`](apply-troubleshooting.md) or [inspecting a result](apply-observation.md).

- For operators: [FAQ, remediation and upgrade questionnaire](apply-placeholder-faq.md), [migration and migration questions](apply-placeholder-migration.md), [operator questions](apply-operator-questions.md), [operator checklist and migration unknowns](apply-placeholder-operator-checklist.md), [verify real values](apply-operator-verification.md), [review existing placeholders](apply-placeholder-review-checklist.md), [user impact](apply-user-impact.md), [upgrade check](apply-upgrade-check.md) and [upgrade note](apply-upgrade-note.md).
- History: [placeholder history and timeline](apply-placeholder-history.md), [history](stack-apply-history.md), [where to find the history](apply-history-location.md), [reading the history](apply-history-reader-guide.md), [historical command](apply-placeholder-command-history.md), [removal](apply-placeholder-removal.md) and [wiring history](apply-wiring-history.md).
- Terminology: [short changelog glossary](apply-changelog-reader-glossary.md), [terminology, examples and changelog wording](apply-placeholder-terminology.md) and [reader note](apply-placeholder-reader-note.md).
- Changelog entries for the change: [reader guide, exact locations, release timeline, glossary and file differences](apply-changelog-reader-guide.md), [notes for upgraders](apply-changelog-reader-guide.md#upgrading-from-the-old-wiring), [term citations by entry](apply-changelog-reader-guide.md#term-citations-by-entry), [root and site comparison, consistency check and 0.2.1 cross-reference](apply-changelog-reader-guide.md#entry-by-entry-comparison), [maintenance and 0.2.1 review checklist](apply-changelog-reader-guide.md#maintaining-these-notes) and [site entry reference](apply-site-entry-reference.md).
- The same entries seen from the changelog side: [why the old wording stays](apply-changelog-reader-guide.md#why-the-old-wording-stays-in-the-changelogs), [reading the report](apply-changelog-reader-guide.md#reading-the-report), [comparison](apply-changelog-reader-guide.md#the-021-fix-entry), [placeholder timeline](changelog-placeholder-timeline.md) and [site change reference](site-apply-change-reference.md).
