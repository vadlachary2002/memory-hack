#!/usr/bin/env bash
# Opens one stacked PR per build step, titled and described from docs/prs on each branch.
# Needs the GitHub CLI logged in as the repo owner: brew install gh && gh auth login
# Usage: bash scripts/create-prs.sh
set -euo pipefail

REPO="vadlachary2002/memory-hack"
STEPS=(
  "main step-1-ledger 01-step-1-ledger"
  "step-1-ledger step-2-ingest 02-step-2-ingest"
  "step-2-ingest step-3-forget 03-step-3-forget"
  "step-3-forget step-4-ask 04-step-4-ask"
  "step-4-ask step-5-temporal 05-step-5-temporal"
  "step-5-temporal step-6-harness 06-step-6-harness"
  "step-6-harness step-7-adapters 07-step-7-adapters"
)

cd "$(git rev-parse --show-toplevel)"
git fetch -q origin

for entry in "${STEPS[@]}"; do
  read -r base head doc <<<"$entry"
  text="$(git show "origin/${head}:docs/prs/${doc}.md")"
  title="$(printf '%s\n' "$text" | awk '/^# PR title/{f=1;next} /^# PR description/{f=0} f' | sed '/^$/d' | head -1)"
  body="$(printf '%s\n' "$text" | awk '/^# PR description/{f=1;next} f')"
  existing="$(gh pr list --repo "$REPO" --head "$head" --state open --json number --jq '.[0].number' || true)"
  if [ -n "$existing" ]; then
    echo "PR #${existing} already open for ${head}, updating title and body"
    gh pr edit "$existing" --repo "$REPO" --base "$base" --title "$title" --body "$body" >/dev/null
    continue
  fi
  gh pr create --repo "$REPO" --base "$base" --head "$head" --title "$title" --body "$body"
done

echo
gh pr list --repo "$REPO" --state open
