# Upgrade questions: `stack apply` placeholders

## Was the historical placeholder a usable credential?

No. `TODO_STACK_APPLY` was a marker, not a usable credential. Historical
wiring tried to write it for each declared secret, but every attempt failed;
those attempts wrote no placeholder. They do not establish the contents of
your vault. See the [changelog](../CHANGELOG.md#021-2026-10-16).

## What should I check after upgrading?

Check the installed version with `stack --version` and its behavior with
`stack apply --help`. Review the existing apply output and use
`phantom list --json` to check secret names. A present name does not prove
that its value works. For each required missing name, run `phantom add <NAME>`
in a trusted terminal and enter the real value when prompted. Do not put the
value in a command argument.

For skipped checks, provider failures, and webhook stubs, follow the
[upgrade checklist](apply-upgrade-check.md). Do not rerun apply just to
inspect the vault; it can provision resources and change files.
