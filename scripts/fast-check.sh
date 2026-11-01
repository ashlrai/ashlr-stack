#!/usr/bin/env bash
# Check workspaces changed since origin/main, including uncommitted work.
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
start=$SECONDS
failed=0
changes=$(mktemp) || exit 1
output=$(mktemp) || { rm -f "$changes"; exit 1; }
trap 'rm -f "$changes" "$output"' EXIT

if ! git diff --name-only --no-renames -z origin/main -- packages/ > "$changes" ||
   ! git ls-files --others --exclude-standard -z -- packages/ >> "$changes"; then
  printf 'FAIL changed packages (cannot compare with origin/main)\nTotal: %ss\n' "$((SECONDS - start))"
  exit 1
fi

packages=()
while IFS= read -r -d '' path; do
  case "$path" in
    packages/*/*)
      package=${path#packages/}
      package=${package%%/*}
      if [[ -f "packages/$package/package.json" && " ${packages[*]} " != *" $package "* ]]; then
        packages+=("$package")
      fi
      ;;
  esac
done < "$changes"

run_step() {
  local label=$1
  shift
  if "$@" > "$output" 2>&1; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label"
    cat "$output"
    failed=1
  fi
}

typecheck_package() (
  cd "packages/$1" && bunx tsc --noEmit -p tsconfig.json
)

for package in "${packages[@]}"; do
  run_step "$package typecheck" typecheck_package "$package"
  run_step "$package test" bun test --pass-with-no-tests "packages/$package"
done
if (( ${#packages[@]} == 0 )); then
  printf 'PASS no changed packages\n'
fi
printf 'Total: %ss\n' "$((SECONDS - start))"
exit "$failed"
