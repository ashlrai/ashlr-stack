# Task Plan: Coverage recovery

## Goal
Find the coverage failure behind repeated empty guardian exits, add a focused regression, and verify the existing coverage command without starting guardian work.

## Phases
- [x] Read repository instructions and identify coverage tooling.
- [x] Reproduce and isolate the underlying failure; check existing work for overlap.
- [x] Implement one focused fix and regression coverage.
- [ ] Run touched tests, coverage, typecheck and lint; write BRIDGE_NOTES.md.

## Errors Encountered
Shell glob bunfig* matched nothing; corrected to rg --files. Locus access denied by expired session; historical evidence unavailable. Explicit script typecheck caught Error.code access; fixed with an in-operator guard. Process inspection denied by macOS. Formatter first check found layout differences; applied Biome output.

## Status
Final validation and bridge handoff; waiting for the initially launched full coverage run.
