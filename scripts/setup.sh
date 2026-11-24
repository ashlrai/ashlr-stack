#!/usr/bin/env bash
# macOS and Linux entry. The work is in setup.mjs so Windows can run the same steps.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/setup.mjs "$@"
