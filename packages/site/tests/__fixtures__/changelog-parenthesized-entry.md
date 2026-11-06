# Changelog

## Unreleased

### Fixed

- The release workflow renders the Homebrew formula placeholders (`$VERSION$` and the per-platform `$SHA_*$` values) as literals through `sed`, so the generated formula no longer depends on shell quoting of the `$` delimiters (#354).
