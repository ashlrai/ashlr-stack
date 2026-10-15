# Stack Privacy Policy

**Document version:** 1.0.0
**Effective date:** 2026-04-23
**Contact:** privacy@ashlr.ai (or open a [GitHub Issue](https://github.com/ashlrai/ashlr-stack/issues))

## Telemetry is opt-in

`packages/core/src/telemetry.ts` requires a stored opt-in before emitting a
telemetry event. The interactive first-run prompt defaults to **N**;
`stack telemetry enable` explicitly enables the stored choice. A first run
without a TTY records telemetry as disabled. `STACK_TELEMETRY=0` suppresses
emission regardless of that stored choice; `STACK_TELEMETRY=1` alone does not
opt in.

The reviewed source has no default telemetry endpoint. After opt-in, an
operator-supplied `STACK_TELEMETRY_ENDPOINT` or saved `endpoint` can enable
HTTP delivery. Without either endpoint, `emit` returns without sending an
event. This describes client source behavior, not the current deployment or
privacy practices of a hosted endpoint.

## What we collect

The client constructs these fields before attempting an HTTP POST:

| Field | Type | Source meaning |
|---|---|---|
| `type` | `"command"` or `"error"` | Event type supplied by the caller. |
| `command` | string | The CLI supplies its first command-line argument; the core API accepts a caller-supplied string. |
| `exitCode` | number | Exit code supplied by the caller, defaulting to 0. |
| `durationMs` | number | Duration supplied by the caller, defaulting to 0. |
| `runId` | UUID | Random process-level identifier; not persisted by this module. |
| `installId` | UUID | Persistent installation identifier in `~/.ashlr/stack/config.json`. |
| `stackVersion` | string | A source constant in the telemetry module; it is not proof of the installed package version. |
| `platform` | string | The running process platform. |

## What we do NOT collect

The fixed payload does not automatically include cwd, config contents,
provider selections, environment values or vault contents. The module does
not generally sanitize arbitrary strings passed by callers. Review command
arguments and any custom integrations before enabling an endpoint; the
payload structure is not a global redaction guarantee. The persistent
installation identifier can link events from the same installation.

A configured HTTP endpoint may also see network metadata such as an IP
address. This client repository does not establish the server's collection,
logging, access controls or retention. Verify the actual endpoint's policy
and operation separately.

## How to opt out

- Decline the first-run prompt.
- Run `stack telemetry disable` to persist the disabled choice; use
  `stack telemetry status` to inspect it.
- Set `STACK_TELEMETRY=0` to suppress emission for that process environment.

Opting out does not send an opt-out event. The preference file is local
state; preserve a backup before manually changing it.

## Data retention

The original policy listed these targets. No server implementation or
operational retention enforcement is established by the reviewed client
source; confirm the policy of any endpoint before enabling delivery.

| Data | Recorded target |
|---|---|
| Raw event records | 30 days. |
| Aggregated statistics | 90 days. |
| IP addresses | 48 hours. |

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-04-23 | Initial document. Fields: `type`, `command`, `exitCode`, `durationMs`, `runId`, `installId`, `stackVersion`, `platform`. |
