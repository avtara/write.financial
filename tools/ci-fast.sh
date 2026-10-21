#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# `pnpm ci:fast [--e2e]`: the CI fast lane on a developer machine (CONTRIBUTING.md › CI lanes), sized for a laptop that
# shares ~13 GB of RAM: one heavy command at a time, ESLint with a 6 GB heap, two typecheck and Vitest workers.
#
# 1. The static job: format, lint, typecheck, SPDX, test files, tokens, i18n, migration order.
# 2. DCO: every commit since the merge base with origin/main is signed off by its author.
# 3. Unit tests of the code changed since that merge base (`vitest --changed`, no coverage gate).
# 4. With --e2e: the production build and the E2E core projects (m0, tablet, app); needs `pnpm dev:up`.
#
# The pre-commit hook already scanned every commit with gitleaks. Integration tests, the backup restore, and the rest of
# the full lane run in CI.

set -eu

e2e=false
for arg in "$@"; do
  case "$arg" in
    --e2e) e2e=true ;;
    *)
      echo 'Usage: pnpm ci:fast [--e2e]' >&2
      exit 2
      ;;
  esac
done

step() {
  printf '\n▶ %s\n' "$*"
  "$@"
}

git fetch --quiet origin main
base=$(git merge-base HEAD origin/main)

step pnpm format:check
step env NODE_OPTIONS=--max-old-space-size=6144 pnpm lint
step pnpm exec tsc -p tsconfig.json
step pnpm exec turbo run typecheck --concurrency=2
step pnpm check:spdx
step pnpm check:test-files
step pnpm check:tokens
step pnpm check:i18n
step pnpm check:migrations

printf '\n▶ DCO sign-off since %s\n' "$base"
unsigned=0
for sha in $(git rev-list --no-merges "$base..HEAD"); do
  author=$(git show -s --format='%an <%ae>' "$sha")
  if ! git show -s --format='%B' "$sha" | grep -qxF "Signed-off-by: $author"; then
    echo "Commit $sha is missing 'Signed-off-by: $author' (git rebase --signoff origin/main)" >&2
    unsigned=1
  fi
done
[ "$unsigned" -eq 0 ]

# One project at a time: Node workers and headless Chromium together exceed the shared RAM. A changed package.json or
# Vitest config reruns every test (Vitest's forceRerunTriggers), as in CI.
for project in unit unit-browser; do
  step pnpm exec vitest run --project "$project" --changed "$base" --passWithNoTests --maxWorkers=2
done

if [ "$e2e" = true ]; then
  step pnpm --filter @wf/web build
  step pnpm --filter @wf/web test:e2e --project m0 --project tablet --project app
fi

printf '\nci:fast green. Push once; CI runs the same fast lane (and the full lane with the full-ci label).\n'
