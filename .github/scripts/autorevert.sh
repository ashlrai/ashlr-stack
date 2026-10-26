#!/usr/bin/env bash
# Deterministic autorevert. Every exit prints one DECISION line.
set -euo pipefail
say() { echo "DECISION $*"; }
run=$(gh api "repos/$REPO/actions/runs/$RUN_ID")
j() { jq -r "$1" <<<"$run"; }
name=$(j .name); event=$(j .event); branch=$(j .head_branch)
sha=$(j .head_sha); attempt=$(j .run_attempt); concl=$(j .conclusion)
wf=$(j .workflow_id); created=$(j .created_at)

if [ "$name" = "Release" ]; then
  say "release-failure run=$RUN_ID sha=$sha action=issue"
  [ "$DRY" = true ] && exit 0
  t="Autorevert: Release failed at ${sha:0:7}"
  gh issue list -R "$REPO" --state open --search "\"$t\" in:title" --json number --jq length | grep -qx 0 &&
    gh issue create -R "$REPO" --title "$t" --body "Release run $(j .html_url) failed. Release commits and tags are never auto-reverted; a box agent triages." >/dev/null
  exit 0
fi
[ "$event" = push ] && [ "$branch" = "$MAIN" ] || { say "skip not-main-push"; exit 0; }
[ "$concl" = failure ] || { say "skip conclusion=$concl"; exit 0; }

# Kill switch: open pause issue, or 2 autoreverts in 24h, stops everything.
if [ "$(gh issue list -R "$REPO" --state open --label autorevert-paused --json number --jq length)" != 0 ]; then
  say "skip kill-switch-open"; exit 0; fi

# Flake guard: first failure reruns failed jobs once; the rerun's completion re-triggers us.
if [ "$attempt" = 1 ]; then
  say "rerun-failed run=$RUN_ID sha=$sha"
  [ "$DRY" = true ] || gh run rerun "$RUN_ID" -R "$REPO" --failed
  exit 0
fi

# Culprit: the previous completed push run on main must be green, else main was already red.
prev=$(gh api "repos/$REPO/actions/workflows/$wf/runs?branch=$MAIN&event=push&status=completed&per_page=20" \
  --jq "[.workflow_runs[] | select(.created_at < \"$created\")][0] | .conclusion // \"none\"")
[ "$prev" = success ] || { say "skip previous=$prev sha=$sha"; exit 0; }

git fetch -q origin "$MAIN"
[ "$(git cat-file -t "$sha" 2>/dev/null)" = commit ] || { say "skip sha-not-found $sha"; exit 0; }
git merge-base --is-ancestor "$sha" "origin/$MAIN" || { say "skip not-on-main $sha"; exit 0; }
subj=$(git log -1 --format=%s "$sha")
case "$subj" in Revert*|*autorevert*) say "skip is-revert $sha"; exit 0;; esac
if printf '%s' "$subj" | grep -Eiq '^(release|chore\(release\))'; then say "skip release-commit $sha"; exit 0; fi
if git diff-tree --no-commit-id --name-only -r "$sha" | grep -Eq '^\.github/workflows/(release|autorevert)'; then
  say "skip touches-release-or-autorevert $sha"; exit 0; fi

br="autorevert/$sha"
if [ "$(gh pr list -R "$REPO" --state all --head "$br" --json number --jq length)" != 0 ]; then
  say "skip pr-exists $br"; exit 0; fi

since=$(date -u -d '-24 hours' +%Y-%m-%dT%H:%M:%SZ)
n=$(gh pr list -R "$REPO" --state all --label autorevert --search "created:>=$since" --json number --jq length)
if [ "$n" -ge 2 ]; then
  say "kill-switch count=$n sha=$sha"
  [ "$DRY" = true ] && exit 0
  gh label create autorevert-paused -R "$REPO" --color B60205 -f >/dev/null
  gh issue create -R "$REPO" --label autorevert-paused --title "Autorevert paused: $n reverts in 24h" \
    --body "Main CI red at $sha ($(j .html_url)). Kill switch tripped; close this issue to re-arm." >/dev/null
  exit 0
fi

say "revert sha=$sha subj=$(printf '%q' "$subj")"
[ "$DRY" = true ] && exit 0
git config user.name github-actions[bot]
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
git checkout -q -b "$br" "origin/$MAIN"
if ! git revert --no-edit "$sha"; then
  gh issue create -R "$REPO" --title "Autorevert: revert of ${sha:0:7} conflicts" --body "Main CI red: $(j .html_url)" >/dev/null
  say "conflict $sha"; exit 0
fi
git push -q origin "$br"
gh label create autorevert -R "$REPO" --color D93F0B -f >/dev/null
url=$(gh pr create -R "$REPO" --base "$MAIN" --head "$br" --label autorevert \
  --title "Revert \"$subj\" (autorevert)" \
  --body "Main CI failed twice at $sha: $(j .html_url). Required checks run via workflow_dispatch on this branch.")
gh pr merge "$url" --auto --squash
gh workflow run "$wf" -R "$REPO" --ref "$br"
say "opened $url"
