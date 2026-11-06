# Placeholder-secret timeline in the changelog

`stack apply` once tried to write a `TODO_STACK_APPLY` placeholder into
Phantom for every declared secret. This page identifies the changelog entry
where that stopped and maps the entries around it.

The changelog exists in two places, kept identical by the site's
`sync-content` step (`cp ../../CHANGELOG.md src/data/CHANGELOG.md` in
`packages/site/package.json`):

- repo root: [CHANGELOG.md](../CHANGELOG.md)
- site mirror:
  [packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md),
  rendered at <https://stack.ashlr.ai/docs/changelog>

## The entry where apply stopped writing placeholder secrets

The entry is the first bullet of `### Bug fixes` under
`## 0.2.1 (2026-10-16)`, in both copies of the changelog:

- [CHANGELOG.md — 0.2.1 → Bug fixes](../CHANGELOG.md)
- [packages/site/src/data/CHANGELOG.md — 0.2.1 → Bug fixes](../packages/site/src/data/CHANGELOG.md)

It is titled **`stack apply` stops attempting to write placeholder
secrets.** and records, in part:

> Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate` (then
> without `--rotate`) for every declared secret. Phantom Secrets refuses
> values in argv and has no `--rotate`, so every call failed and the printed
> `envelopes` count was always 0. `WireResult.envelopes` is replaced by
> `present` and `missing`.

0.2.1 was tagged but never published to npm, so the fix first reached users
in **0.2.2 (2026-10-25)**, whose preamble says it "ships everything listed
here and under 0.2.1 below".

## Timeline

| Release | Date | Changelog entry |
| --- | --- | --- |
| `## 0.1.0 — 2026-04-19` | 2026-04-19 | "`stack apply [recipe-id]`" under "AI recommendation layer — `stack recommend` + `stack apply`": the first entry describing apply wiring. It is annotated that wiring historically attempted a `TODO_STACK_APPLY` placeholder per declared secret, that the calls failed, and that the 0.2.1 fix removed the attempts. |
| `## 0.2.1 (2026-10-16)` | 2026-10-16 | **The stop entry above** — apply's wiring stops attempting to write placeholder secrets. Tagged but never published. |
| `## 0.2.2 (2026-10-25)` | 2026-10-25 | Ships the fix: "0.2.2 supersedes it: it ships everything listed here and under 0.2.1 below." |
| `## 0.3.0 (2026-10-31)` | 2026-10-31 | "Changed and fixed": "Apply wiring checks existing secret names without storing placeholders; unreadable vaults are reported as skipped, not missing." The longer "Changed" entry in the same release adds the `secrets in vault` / `missing` / `skipped` output examples. |
| `## Unreleased` | — | Wiring checks secret names for every provider in the recipe, including providers that failed, and can create webhook stubs even when the vault is unreadable. |

## Related docs

- [Historical `stack apply` placeholder command](apply-placeholder-command-history.md) —
  the attempted `phantom add` forms and where their removal is documented.
- [`stack apply` and placeholder secrets](apply-placeholder-history.md) —
  current wiring behavior and the pre-0.2.1 history in prose.
- [Inspecting a `stack apply` result](apply-observation.md) — how to read the
  wiring output the 0.3.0 entry quotes.
- [Troubleshooting `stack apply`](apply-troubleshooting.md) — prerequisites,
  rollback, and recovery.
