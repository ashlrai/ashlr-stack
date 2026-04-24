# Stack Privacy Policy

**Document version:** 1.0.0
**Effective date:** 2026-04-23
**Contact:** privacy@ashlr.ai (or open a [GitHub Issue](https://github.com/ashlrai/stack/issues))

---

## Telemetry is opt-in

Stack never sends telemetry without explicit consent. On first run in an
interactive terminal you are asked:

```
Share anonymous usage telemetry (command + duration, no paths/secrets)? [y/N]
```

The default answer is **N**. Nothing is transmitted until you answer **y**.

---

## What we collect

When you opt in, each CLI invocation may send one event containing **only**
the following fields:

| Field | Type | Plain-language description |
|---|---|---|
| `type` | `"command"` or `"error"` | Whether the run completed normally or exited with an error. |
| `command` | string | The top-level subcommand name (e.g. `"add"`, `"scan"`, `"list"`). Never includes arguments or flag values. |
| `exitCode` | number | Process exit code (0 = success). |
| `durationMs` | number | Wall-clock milliseconds from CLI start to exit. |
| `runId` | UUID | A random UUID generated fresh each time Stack runs. Not stored anywhere; not linkable across runs. |
| `installId` | UUID | A random UUID generated once on your machine and stored in `~/.ashlr/stack/config.json`. Used only to count distinct installations, not to identify you. |
| `stackVersion` | string | The installed version of Stack (e.g. `"0.1.0"`). |
| `platform` | string | Operating system platform: `"darwin"`, `"linux"`, or `"win32"`. |

That is the complete payload. No additional fields are ever added to a
payload without a corresponding update to this document (see
[Changelog](#changelog)).

---

## What we do NOT collect

The following are **explicitly excluded** from every telemetry event, by
design in the source code:

- Current working directory (`cwd`) or any filesystem path.
- Project names, directory names, or repository names.
- Provider names or choices made for any specific project or stack.
- Secret values, API keys, tokens, or anything stored in Phantom.
- Environment variable names or values.
- Contents of `.stack.toml` or `.stack.local.toml`.
- Your email address or any account identifier.
- Stack command arguments or flag values (only the subcommand name is sent).

**Your IP address** is visible to our telemetry endpoint at the HTTP layer,
as with any web request. We do not store it beyond **48 hours**, and it is
used solely for abuse mitigation (rate-limiting and bot filtering). It is
never written to our analytics database or associated with event records.

---

## How to opt out

There are four ways to disable telemetry permanently:

1. **Decline the first-run prompt** — answer `N` (or press Enter) when asked.
2. **CLI command:** `stack telemetry disable` (coming in a future release).
3. **Environment variable:** set `STACK_TELEMETRY=0` in your shell or CI
   environment. This overrides any stored opt-in for the lifetime of that
   process.
4. **Delete the config file:** `rm ~/.ashlr/stack/config.json`. Stack will
   behave as if never prompted; no data will be sent until you opt in again.

Once opted out, no data is sent — not even a "user opted out" ping.

---

## Data retention

| Data | Retention |
|---|---|
| Raw event records | Purged after **30 days**. |
| Aggregated daily statistics (counts, p50/p95 durations, error rates) | Retained for **90 days**. |
| IP addresses | Purged after **48 hours**. |

Aggregates contain no per-install or per-run identifiers.

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-04-23 | Initial document. Fields: `type`, `command`, `exitCode`, `durationMs`, `runId`, `installId`, `stackVersion`, `platform`. |
