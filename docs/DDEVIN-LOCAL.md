# Devin Local: fleet assessment

Research snapshot: 2026-11-07. Recommendation: **continue the existing Devin CLI lane; do not create a separate Devin Local lane or assume it can use oMLX.** Consider a small Desktop evaluation only for an operator who needs its visual workflow, using existing entitlement and the fleet's existing isolation. This is a capability assessment, not a claim that Devin is better or worse than another agent.

## What it is

[Devin Local](https://docs.devin.ai/desktop/devin-local/overview) is Cognition's local agent harness, shared with Devin CLI and presented as the primary local agent in Devin Desktop. It runs tools against the machine's files and environment. Desktop is the graphical product; Local is its agent; CLI is another interface to the shared harness. Devin Cloud is a separate remote execution environment, accessible from CLI with `--cloud`. Cognition describes the distinction in its [CLI quickstart](https://docs.devin.ai/cli). Local execution does **not** establish local model inference or offline operation.

The installed `devin 3000.11.3` help says local agent execution is the default, `--cloud` selects cloud sessions, `-p` is noninteractive, and `--model` selects a model. On the supplied fleet description, `devin --permission-mode dangerous --model swe-2-flash-max -p --prompt-file …` already uses the local agent harness. The launcher itself was not verified in this checkout; its sandbox and actual runtime configuration are taken from the task context. No live paid session was run.

## What changes for the fleet?

| Question | Finding |
| --- | --- |
| A new autonomous local agent? | No separate harness is needed for the described lane. CLI and Desktop share the Local harness; surface, version, settings and available integrations may still differ. |
| Local model / oMLX? | Unproven. The [model guide](https://docs.devin.ai/cli/models), installed model docs and installed complete configuration reference document selecting available models, but do not document a custom inference base URL or OpenAI-compatible local provider. An HTTP proxy is not evidence of a model backend. Open-weight model availability does not mean on-device inference. Do not route sensitive prompts to an undocumented endpoint or promise offline use. Revisit if Cognition documents a supported local provider; then test with a loopback-only endpoint and verify actual network traffic. |
| Desktop UI? | Yes: an editor and agent interface, worktree workflows, permission prompts and visual review; [Local documentation](https://docs.devin.ai/desktop/devin-local/overview) also describes subagents and Quick Review. The CLI already documents subagents, sandbox, MCP, rules and skills, so these are not automatically new fleet capabilities. |
| More repo awareness? | [Desktop documents](https://docs.devin.ai/desktop/context-awareness/overview) indexed local code, open-file context and pinning, with remote repository indexing on Teams/Enterprise. That is a potential interactive benefit, not proof the Local agent receives all indexed context or outperforms CLI retrieval. Verify context flow, indexing limits and data handling before use on private repos. |
| Isolation? | `dangerous` auto-approves tools; it is not a sandbox. Installed help calls CLI `--sandbox` a research preview for exec processes, with workspace writes and explicit read denies; Desktop also offers [sandboxing](https://docs.devin.ai/desktop/devin-local/overview). Neither is evidence of equivalence to the fleet's external sandbox. Preserve the existing fleet controls and validate effective process, filesystem and network boundaries for any Desktop experiment. |

Cognition also documents [Adaptive and Fusion model selection](https://docs.devin.ai/cli/models) through the shared CLI. These are provider/model selection features, not evidence of local inference. Model access and configuration can differ by account and version.

## Cost and constraints

As published on the [pricing page](https://devin.ai/pricing) on the research date, Free has a light agent quota and limited models; Pro is $20/month, Max $200/month, and Teams $80/month plus $40/month per full developer seat. Quotas, concurrent limits, availability and enterprise agreements vary. Extra usage can be charged at API pricing; check the actual account before a trial. No new subscription or spend is authorized by this assessment.

The [model pricing page](https://docs.devin.ai/desktop/models) says SWE-2 Flash is free on self-serve until December 4, 2026 at 18:00 UTC; afterward its listed extra-usage rates are $0.10 per million input tokens, $0.01 cache reads, $0.125 cache writes and $0.50 output. Flash Max requires a paid plan. Promotions and quota accounting can change; this does not establish the fleet account's entitlement or actual bill. Cloud sessions have different terms. Local file execution still sends model context to a service when using hosted models; assess the applicable account's data and retention terms separately.

## Proposed evaluation

1. Keep automated jobs on the existing sandboxed CLI lane. Do not modify its security profile, permissions or model routing based on a UI feature.
2. If there is a real operator need, use an existing entitled account and a disposable, non-sensitive test repository. Run Desktop Local in a verified isolated environment with no new spend. Compare a small fixed set of representative tasks against the current CLI lane at the same model and comparable settings: task acceptance, elapsed time, operator interventions, usage and whether relevant context was actually supplied. Record versions and configuration; avoid treating marketing claims as measurements.
3. Adopt Desktop as an optional operator interface only if it measurably improves review or debugging without weakening isolation or exceeding existing entitlement. Keep headless orchestration in CLI. For oMLX, wait for documented custom backend support, then separately verify loopback routing, tool-calling compatibility, quality and failure behavior before proposing a lane.

Sources: [Devin Local](https://docs.devin.ai/desktop/devin-local/overview), [CLI models](https://docs.devin.ai/cli/models), [Desktop context](https://docs.devin.ai/desktop/context-awareness/overview), [pricing](https://devin.ai/pricing), [model rates](https://docs.devin.ai/desktop/models), and installed `devin --help`, `devin version`, and `/opt/homebrew/Caskroom/devin-cli/3000.11.3/share/devin/docs/{models,reference/configuration/config-file}.mdx`.
