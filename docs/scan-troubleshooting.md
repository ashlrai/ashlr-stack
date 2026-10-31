# Troubleshooting `stack scan`

`stack scan` looks for provider signals in a project directory. By default it
scans the current working directory; use `--path <directory>` to choose another.
Relative paths are resolved from the shell's working directory, not from the
repository root. In a monorepo, point `--path` at the individual project: the
scan does not recursively discover nested projects.

For a read-only, machine-readable report, run:

```sh
stack scan --path ./apps/api --json
```

A successful JSON report has a `hits` array, which can be empty. Validation
errors exit with status 1; in `--json` mode the error is plain text on stderr
and stdout contains no JSON report. Human-readable mode also exits 1 for these
errors, but formats the message for display. If both the confidence and path
are invalid, the confidence error is reported first.

## Path does not exist or is not a directory

```text
Path "./apps/api" does not exist or is not a directory.
```

Check your working directory and spelling, and pass the path to an existing
**directory**, not its `package.json` or another file. Check that the directory
is accessible to the current user; a failed directory stat can produce the same
message. For example, run `pwd` and `ls -ld ./apps/api`, then retry with the
correct relative or absolute directory path. The scan does not create a missing
path.

A missing `package.json` is different: it is allowed. The scanner can still
find signals in other supported files; an empty directory succeeds with no hits.

## Invalid or unreadable dependency manifest

```text
Invalid JSON in dependency manifest "apps/api/package.json". Fix it and retry the scan.
```

The path in the message is derived from `--path`. Correct the JSON syntax in
that project's `package.json` (for example, remove a trailing comma or close a
missing brace), then rerun the scan. The CLI stops before reporting results,
even if other files contain provider signals, so a partial scan is not mistaken
for a complete one.

```text
Cannot read dependency manifest "apps/api/package.json".
```

Check that `package.json` is a readable regular file and that the current user
can access it and its parent directory. Correct the file type or permissions,
then retry. An absent manifest is allowed, but other read errors stop the scan.
The CLI checks JSON syntax; it does not validate the full package manifest
schema or the syntax of every other scanned file.

## Unknown confidence

```text
Unknown confidence "hgih". Use one of: low, medium, high
```

Retry with `--confidence low`, `--confidence medium`, or `--confidence high`.
The value is case-insensitive. Without an explicit threshold, the default is
`medium`, or `high` when `--yes` is set. A successful empty report can mean
that no signals met the threshold; try `--confidence low` and verify `--path`
points at the intended project.

## Non-interactive `--auto`

Without a terminal, `stack scan --auto` exits 1 with:

```text
stack scan --auto asks before each add and there is no terminal. Use --yes to add high-confidence hits headlessly, or --json for the report.
```

Use `--json` for a read-only report. Use `--yes` only when you intend to add
qualifying providers without prompts: it implies `--auto`, can create
`.stack.toml`, and runs the add flow. `--json` takes precedence and does not
run the add flow, even when combined with `--yes`.
