# Site changelog `stack apply` change reference

The site renders
[packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md)
at `/docs/changelog`. The site's `sync-content` script copies the
[root changelog](../CHANGELOG.md) over the site copy before site development
and builds, so the two checked-in files are identical and each entry below
sits at the same release and subsection in both. This page identifies every
site changelog entry that records a change to `stack apply` and summarizes
the behavior those entries state.

## The entries

- **Unreleased → Changed**
  ([site copy](../packages/site/src/data/CHANGELOG.md#unreleased)): the
  section's only Changed bullet, "`stack apply` does not create placeholder
  secrets." — the newest statement of apply wiring behavior.
- **0.3.0 → Changed**
  ([site copy](../packages/site/src/data/CHANGELOG.md#030-2026-10-31)): the
  long bullet beginning "After at least one provider succeeds, `stack apply`
  wiring checks the recipe's secret names..." — the detailed account, with
  the `secrets in vault` / `missing` / `skipped` output examples. The same
  release's **Changed and fixed** subsection carries the shorter bullet
  "Apply wiring checks existing secret names without storing placeholders;
  unreadable vaults are reported as skipped, not missing." — it does not
  spell `stack apply` verbatim.
- **0.2.2 → Bug fixes**
  ([site copy](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)): two
  apply bullets that do not touch wiring —
  "**`stack apply` with a missing recipe writes nothing.**" (the recipe is
  resolved before `stack init` would run) and "**`stack apply` and `stack
  init --template` keep going after a provider fails.**" (every provider is
  tried; the run ends with `Some providers failed: ...` and exit 1).
- **0.2.1 → Bug fixes**
  ([site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)): the
  first bug-fix bullet, "**`stack apply` stops attempting to write
  placeholder secrets.**" — the removal entry. Wiring previously ran
  `phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)
  for every declared secret; every call failed because Phantom Secrets
  refuses values in argv and has no `--rotate`, so the printed `envelopes`
  count was always 0. `WireResult.envelopes` is replaced by `present` and
  `missing`. 0.2.1 was tagged but never published, so the fix first shipped
  in 0.2.2.
- **0.1.0 → AI recommendation layer — `stack recommend` + `stack apply`**
  ([site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011)):
  the original "**`stack apply [recipe-id]`**" description — apply re-runs
  the `stack add` pipeline for every provider in the recipe, then checks
  declared secret names in Phantom and creates webhook stubs (Stripe, Clerk,
  Supabase, GitHub). The entry is annotated with the failed
  `TODO_STACK_APPLY` placeholder history.

Two other bullets spell `stack apply` verbatim but only mention it: the 0.2.2
fix "**The last lines of a failing command reach a pipe on Bun 1.2.**" (a
piped `stack apply` as an example of lost output) and the 0.1.0
"**`stack recommend [query]`**" bullet ("follow up with `stack apply <id>`").

## What the entries state about `stack apply`

Read together, the site changelog states that apply wiring:

- runs after at least one provider succeeds, and checks the declared secret
  names of every provider in the recipe, including providers that failed;
- does not create placeholder secrets, never writes to the vault, and does
  not fill missing values — provider setup may separately store real values;
- with a readable vault, checks names using `phantom list --json` and prints
  `secrets in vault N · missing M · webhooks K` plus a `not in Phantom:` line
  listing missing names;
- with an unreadable vault, reports providers as skipped instead of
  identifying missing names (`skipped 1`, `(phantom-wire skipped: openai)`);
  the zero counts cover only checked names, and unknown providers are also
  skipped;
- can create webhook stubs for the recipe providers even if the vault is
  unreadable;
- treats a missing name as not itself failing apply — an applied recipe is
  not proof that every required secret is present — while provider failures
  do fail the run;
- requires user action for each required missing value: run `phantom add
  <NAME>` in a trusted terminal and enter the real value;
- is skipped entirely by `--noWire`, which skips both the checks and the
  stubs; the 0.3.0 entry adds that no wiring summary is printed then.

## Verify

From the repository root, list every site changelog bullet that spells
`stack apply` verbatim:

```sh
grep -n -E '^- .*`stack apply' packages/site/src/data/CHANGELOG.md
```

Expect eight hits: the six change entries that spell it verbatim, plus the
two mention bullets above. Then confirm the site copy still matches its
source:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files are identical; status 1 shows
differences, and a higher status indicates an error. Review differences in
context before syncing, because `sync-content` overwrites the site copy.

The checked-in files record the change; they do not establish which version
is installed or what the deployed site shows. For a location-only map that
also covers mentions on other surfaces, see the
[site changelog source map](site-changelog-source-map.md); for the removal
entry alone, see [where to find the site changelog entry](site-changelog-entry-location.md)
and the [site entry reference](apply-site-entry-reference.md).
