# Reader guide: finding the `stack apply` change in the changelogs

Start here if you want the documented `stack apply` change and do not know which file or heading holds it. Two checked-in files carry it: the repository [CHANGELOG.md](../CHANGELOG.md) and the site copy [packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md), which the site renders. They are byte-for-byte identical in this checkout, so either link reaches the same text. This guide describes those files, not an installed version or a deployed site; run `stack apply --help` for the version you use.

## The change in one paragraph

`stack apply` no longer attempts to write placeholder secrets. Its wiring step checks declared secret names against Phantom instead of writing to the vault or filling in missing values. Provider setup is separate and may store real credentials. Each required missing value needs user action: run `phantom add <NAME>` from a trusted terminal and enter the real value.

## Where to read it

| You want | Open | Entry |
| --- | --- | --- |
| The fix and why it was needed | [0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16) · [site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | First bullet under the first **Bug fixes** heading: "`stack apply` stops attempting to write placeholder secrets." |
| The current behavior | [Unreleased](../CHANGELOG.md#unreleased) · [site copy](../packages/site/src/data/CHANGELOG.md#unreleased) | **Changed**: "`stack apply` does not create placeholder secrets." |
| Vault output and unreadable-vault handling | [0.3.0 (2026-10-31)](../CHANGELOG.md#030-2026-10-31) · [site copy](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) | **Changed and fixed**, plus the detailed **Changed** entry |
| The original command description | [0.1.0 — 2026-04-19](../CHANGELOG.md#010--2026-04-19-superseded-by-011) · [site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) | **AI recommendation layer**, annotated with the history |

The 0.2.1 release has a second **Bug fixes** heading under "Earlier 0.2.1 notes (2026-10-12)", so link to the release anchor, not the subsection name. Related but different `stack apply` fixes (a missing recipe writes nothing; a failed provider no longer stops later ones) are under [0.2.2](../CHANGELOG.md#022-2026-10-25) ([site copy](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)).

## Limits worth knowing

- Per the Unreleased entry, a missing name does not itself fail apply, while provider failures do, and `--noWire` skips both checks and stubs.
- Wiring can create webhook stubs even if the vault is unreadable; an unreadable vault yields skipped providers, not proof that no names are missing.
- 0.2.1 was tagged but its npm publish failed; [0.2.2](../CHANGELOG.md#022-2026-10-25) supersedes it. Check the installed version before applying this history.

## Verify

```bash
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts scripts/apply-changelog-reader-guide.test.ts
```

For deeper reading see the [reader FAQ](apply-changelog-reader-faq.md) and the [apply history guide](apply-history-reader-guide.md).
