#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# `pnpm ci:fast [--e2e]`: local feedback, not the complete CI staging lane (CONTRIBUTING.md › CI lanes), sized for a laptop that
# shares ~13 GB of RAM: one heavy command at a time, ESLint with a 6 GB heap, two typecheck and Vitest workers.
#
# 1. The static job: format, lint, typecheck, SPDX, test files, tokens, i18n, migration order.
# 2. DCO: every commit since the merge base with origin/dev (or WF_CI_BASE) is signed off by its author.
# 3. Unit tests of the code changed since that merge base (`vitest --changed`, no coverage gate).
# 4. With --e2e: the production build and the E2E core projects (m0, tablet, app); needs `pnpm dev:up`.
#
# The pre-commit hook scans secrets. CI additionally runs all unit tests with coverage, integration tests, Docker
# build/boot and backup restore on dev; main also requires mutation and every E2E project before merging.

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

target=${WF_CI_BASE:-dev}
git fetch --quiet origin "$target"
base=$(git merge-base HEAD "origin/$target")

step pnpm format:check
# A pull or rebase can add messages without rerunning the install-time generator.
step pnpm --filter @wf/i18n compile
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
    echo "Commit $sha is missing 'Signed-off-by: $author' (git rebase --signoff origin/$target)" >&2
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

printf '\nci:fast green. CI additionally enforces the complete staging lane on dev and the full lane on main.\n'
