# Reviewing the changelog mirror

`CHANGELOG.md` is the repository changelog. The site renders
`packages/site/src/data/CHANGELOG.md`; the site's `sync-content` script copies the
root file to that path before a site build or dev server starts. Review the
checked-in files before running that script: it overwrites the site copy and
can hide a difference that needs investigation.

The shared apply fix is in **0.2.1 (2026-10-16)**, under **Bug fixes**:
“`stack apply` stops attempting to write placeholder secrets.” It says wiring
checks existing secret names without writing or filling values, explains the
unreadable-vault case and the old failed placeholder attempts, and distinguishes
provider setup from wiring. Other apply notes in Unreleased, 0.3.0 and the
older recipe description add context; do not mistake them for this fix entry.

From the repository root, locate the entry in both files:

```sh
rg -n -F 'stops attempting to write placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Check that there is exactly one result for each path and read the whole entry
in its release section. A missing result in either file, duplicates, or a change
in the behavior described needs investigation. `rg` can succeed when it finds
only one of the two files, so its exit status alone does not establish parity.

Then compare the complete files, without changing either one:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files are byte-for-byte equal. Status 1
means differences were found: `-` lines are from the root changelog and `+`
lines from the site copy. Read each hunk in context, including the apply entry;
do not assume every difference is an error or that a matching entry makes the
rest of the files match. A status greater than 1 is an error, such as a missing
file, and is not a successful comparison. After deciding what should change,
update the appropriate copy and repeat the comparison. The existing site test
currently requires full equality as well as the pinned apply entry:

```sh
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts
```

The test is a check on the checked-in files, not proof that a particular site
build or release has been deployed.
