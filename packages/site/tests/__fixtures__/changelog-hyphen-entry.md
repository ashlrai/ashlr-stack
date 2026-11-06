# Changelog

## 0.2.2 (2026-10-25)

### Added

- Handshake conformance kit: `contract/ashlr-handshake.v1.json` is the canonical machine-readable `--ashlr-handshake` v1 contract (pinned by sha256), with a dependency-free checker (`lib/handshake-conformance.ts`) and gated capabilities that map to the argv other tools run (`doctor-fix` means `doctor --fix --json`). Stack's test validates its own handshake and that `stack doctor --ecosystem --fix` uses the contract argv. Other tools vendor the file and run the same check. Docs: docs/ashlr-handshake.md.
