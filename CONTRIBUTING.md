# Contributing to write.financial

Thanks for your interest in improving write.financial. This guide covers the setup, the rules every change must follow, and how a change gets from your machine into `main`. Read the [PRD](docs/PRD.md) and the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the product and architecture background.

By contributing you agree that your contributions are licensed under [AGPL-3.0-only](LICENSE) and you certify the [Developer Certificate of Origin](#developer-certificate-of-origin-dco) for every commit. Please also read the [security policy](SECURITY.md) and the [trademark policy](TRADEMARK.md).

## Prerequisites

- **Node.js 24** (the exact major is in [`.nvmrc`](.nvmrc)). Use a version manager that reads `.nvmrc`:
  - [fnm](https://github.com/Schniz/fnm): `fnm install && fnm use`
  - [nvm](https://github.com/nvm-sh/nvm): `nvm install && nvm use`
- **pnpm 12** (the exact version is pinned in `packageManager` in [`package.json`](package.json)), for example via `corepack enable` or `npm install -g pnpm@12`.
- **Docker** (Docker Desktop, OrbStack, or Docker Engine) for the local dev stack and the integration tests (Testcontainers). The pre-commit secret scan also uses it when `gitleaks` is not installed.
- **git** and a POSIX shell. The scripts and git hooks are POSIX `sh`; on Windows, develop inside WSL 2.

## Setup

```sh
git clone https://github.com/avtara/write.financial.git
cd write.financial
fnm use            # or: nvm use
pnpm install       # also installs the git hooks (see "Secret scanning" below)
cp .env.example .env
pnpm dev:up        # Postgres, Valkey, SeaweedFS, and Mailpit in Docker (stop with pnpm dev:down, wipe with pnpm dev:reset)
pnpm --filter @wf/db db:bootstrap   # database roles, once per database (uses DATABASE_URL_SUPERUSER from .env)
pnpm --filter @wf/db db:migrate     # tables, Row-Level Security, seed rows
pnpm ci:fast       # the CI fast lane: static checks and the unit tests of your changes
```

`.env` is for local development only and is gitignored. Never put real production credentials in it.

## Branches and pull requests

`main` is protected: nobody pushes to it directly, and every change goes through a pull request.

1. Create a branch from the latest `main`, for example `feat/budget-rollover` or `fix/period-boundary`.
2. Make small, focused commits, each signed off (`git commit -s`, see [DCO](#developer-certificate-of-origin-dco)).
3. Run `pnpm ci:fast` (and the other test commands that apply, see [Commands](#commands)) before pushing.
4. Push and open a pull request against `main`. Describe what changed, why, and how you tested it; link the issue if there is one.
5. CI runs the [fast lane](#ci-lanes) on every push; the single required check, **CI gate**, passes when it (and the data lane, when it applies) is green. The pull request that closes a phase gets the `full-ci` label and must pass the full lane.
6. Keep your branch up to date by **rebasing** onto `main` (`git fetch origin && git rebase origin/main`), never by merging `main` into it. `main` requires a linear history, and pull requests are merged with **rebase merge**, so every commit lands on `main` as you wrote it. Squash fixup commits (`git rebase -i origin/main`) before the pull request is merged, so each commit on `main` is meaningful and passes CI on its own.

Rebase conflicts in generated or ordered files:

- `routeTree.gen.ts` conflict: take either side (e.g. `git checkout --theirs apps/web/src/generated/routeTree.gen.ts`), run `pnpm routes`, stage the result. Never hand-merge it.
- Migrations: renumber yours after the newest one on `main` (the SQL file, its `meta/_journal.json` entry, and its snapshot); `pnpm check:migrations` verifies the order.

## CI lanes

One workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) with two lanes; its first job, "Lane and changed paths", picks the lane.

| Lane | Runs on | Jobs |
|---|---|---|
| **Fast** | every push to a pull request | format, lint, typecheck, repo checks (SPDX, test files, tokens, i18n, migration order); unit tests of the changed code (`vitest --changed`, no coverage gate; includes the D14 architecture test when worker code changes); E2E core (Playwright projects `m0`, `tablet`, `app` against the production build); gitleaks; DCO |
| **Data** (added to the fast lane) | pull requests whose diff touches `packages/db`, `packages/auth`, `packages/crypto`, `apps/worker`, `apps/web/src/server`, or `deploy` | integration tests (Testcontainers) and the backup restore |
| **Full** | pushes to `main`, manual runs (`workflow_dispatch`), and pull requests labelled `full-ci` | everything: unit tests with the 100% per-file coverage gate, mutation tests (domain + crypto, incremental on pull requests), integration, every E2E project, the Docker image build + boot with the install proof, and the backup restore |

- **CI gate** is the only required check. It needs every job and passes when every job of the run's lane succeeded: the fast lane plus the data lane when it applies, or with `full-ci` the full lane (it lists the failed or skipped jobs otherwise).
- **Unit tests are still required for every change**: the fast lane runs the tests of the changed code and the co-located test-file check. **The 100% per-file coverage gate is enforced at phase end**: the pull request that closes a phase gets the `full-ci` label and merges only after the full lane. Every push to `main` also runs the full lane; that run is informational (nothing waits for it), and a red run on `main` is fixed in the next pull request.
- **The `full-ci` label** switches the pull request to the full lane: adding it starts a full run, and every later push runs full too while the label stays; removing it goes back to the fast lane. Any label change or push cancels the pull request's run in progress and starts a new one.
- **Mutation tests** reuse Stryker's incremental results cached per base branch: a pull request re-tests the mutants in changed domain/crypto files, and every mutant when a domain/crypto test, the mutation config, or the lockfile changed. Pushes to `main` re-test every mutant.
- **`pnpm ci:fast`** reproduces the fast lane locally with laptop-sized limits (ESLint with a 6 GB heap, two typecheck and Vitest workers, one command at a time): static checks, DCO, and the unit tests of the code changed since the merge base with `origin/main`. It regenerates i18n messages before lint/typecheck so pulls and rebases do not use stale generated exports. `pnpm ci:fast --e2e` adds the production build and E2E core (start the dev services first with `pnpm dev:up`).

## Developer Certificate of Origin (DCO)

We do not use a CLA. Instead, every commit must carry a `Signed-off-by` line certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/): in short, that you wrote the change or otherwise have the right to submit it under the project's open source license (PRD D21).

Sign off by committing with `-s`:

```sh
git commit -s -m "feat: add savings goal progress card"
```

This appends `Signed-off-by: Your Name <you@example.com>` using your `user.name` and `user.email`. CI checks that every commit in the pull request has a sign-off that **exactly matches the commit author**, so use your real name and the same email as the author.

Forgot to sign off? Add the sign-off to all commits on your branch and force-push:

```sh
git rebase --signoff origin/main
git push --force-with-lease
```

For just the last commit, `git commit --amend --no-edit -s` works too. If the author email was wrong, fix it first with `git rebase origin/main --exec 'git commit --amend --no-edit --reset-author -s'` after setting the correct `user.email`.

## Testing rules (D27)

Every change ships with unit tests, and CI blocks the merge otherwise ([PRD D27](docs/PRD.md#12-default-decisions--questions-for-the-product-owner), [plan §9](docs/IMPLEMENTATION_PLAN.md#9-testing-strategy)).

- **Co-located tests.** Every source file `src/**/*.ts(x)` in `apps/*`, `packages/*`, and `tools/*` has a test file next to it: `foo.ts` → `foo.test.ts`, `Foo.tsx` → `Foo.test.tsx`. `pnpm check:test-files` fails when one is missing.
- **100% coverage per file.** Lines, branches, functions, and statements, enforced per file by Vitest (v8 provider). Every source file is included in the coverage report, so a file without tests counts as 0%. Keep every file you touch at 100%: the full CI lane enforces it at phase end (`full-ci`) and reports it on every push to `main` (see [CI lanes](#ci-lanes)), and a file below 100% blocks the phase.
- **Integration tests** are named `*.integration.test.ts` and run against real Postgres/Valkey/SeaweedFS through Testcontainers (Docker required). They prove what unit tests fake (RLS, S3, queues), do not count toward coverage, and never replace the co-located unit test.
- **Tenant isolation.** New server function: add its case to `apps/web/test/isolation/cases/<module>.ts`. New server-function module: add it to `FUNCTIONS` in `apps/web/test/isolation/harness.ts`, create `cases/<module>.ts`, and add one spread line to `MATRIX` in `apps/web/src/server/fn/isolation.integration.test.ts`; the completeness guard still fails on a missing case.
- **Browser RPC boundaries.** When a route or component imports a new server-function module, update every affected browser test's RPC mock and loader fixture, including parent providers and layouts. Follow the existing module mocks: importing the real server module can pull database/auth/native Argon2 code into Vite and leave an error overlay blocking unrelated tests. Fix the missing boundary; do not disable the overlay, install a browser password-hashing fallback, or increase click timeouts to hide it.
- **E2E tests.** After `m0` (setup wizard), the feature projects run in parallel on `WF_E2E_WORKERS` workers (default 3). Each signs up its own invited user, with the design persona if it needs the ledger, in its `beforeAll`: `setUpProjectUser(browser, projectUser('<project>'), { persona })` from `e2e/support.ts`. A new spec gets its own project in `FEATURES` (`apps/web/playwright.config.ts`) and never shares a user. CI retries a failed test once and lists flaky tests in the job summary; fix them, don't rely on the retry.
- **Mutation testing.** `packages/domain` and `packages/crypto` also run Stryker; the mutation score must stay at **≥ 90%** (aim for 100%). Coverage alone does not prove a test asserts anything.
- **Coverage-ignore policy.** Exclusions are only for code we do not write (generated Paraglide output, generated code, `*.d.ts`, config files) and live in one shared list in [`vitest.config.ts`](vitest.config.ts), reviewed in pull requests. Inline `v8`/`c8`/`istanbul ignore` comments are rejected by lint unless they carry a reason and an issue reference, e.g. `/* v8 ignore next -- Node-only fallback, see #42 */`. Prefer deleting unreachable branches over ignoring them.
- **Good tests** assert behavior and boundaries, not implementation details. Golden numbers come from [PRD §7](docs/PRD.md#7-canonical-calculation-rules) and [plan §5](docs/IMPLEMENTATION_PLAN.md#5-domain-package-golden-tests-from-the-design-seed); use property tests (`fast-check`) where a law exists (round-trips, sums).

## Commands

| Command | What it does |
|---|---|
| `pnpm ci:fast` | The CI fast lane locally (see [CI lanes](#ci-lanes)); `--e2e` adds E2E core. Run before every push. |
| `pnpm check` | Format check, lint, typecheck, SPDX header, test-file, token, and migration-order checks, and unit tests with the coverage gate (the whole suite: needs a lot of RAM). |
| `pnpm check:migrations` | `packages/db/migrations` is numbered consecutively without gaps or duplicates and matches `meta/_journal.json` (after a rebase, renumber yours after the newest one on `main`). |
| `pnpm test` | Unit tests in watch mode. |
| `pnpm test:unit` | Unit tests once, with the 100% per-file coverage gate (same as the full CI lane). |
| `pnpm test:integration` | Integration tests (`*.integration.test.ts`) against real services; needs Docker. |
| `pnpm test:mutation` | Stryker mutation tests for `packages/domain` and `packages/crypto` (≥ 90%). Run it when you change those packages. |
| `pnpm test:e2e` | Builds the web app and runs the Playwright smoke tests (`apps/web/e2e`) against the production server. Run `pnpm exec playwright install chromium` once first. |
| `pnpm --filter @wf/web test:e2e:selfhost` | The install proof against a fresh self-host stack (`deploy/compose`, `docker compose up` first): setup wizard, admin with 2FA, sign-in. Needs `WF_SELFHOST_SETUP_TOKEN` (from `docker compose logs init`); `WF_SELFHOST_URL` defaults to `https://localhost`. CI runs it in the Docker job. |
| `pnpm --filter @wf/web dev` | The web app with hot reload at http://localhost:3000. Reads `.env`. |
| `pnpm --filter @wf/web build` / `start` | Production build, then the Node server (`apps/web/.output/server/index.mjs`) on port 3000 (`PORT`). `start` reads `.env`. |
| `pnpm format` | Format the repository with Prettier. |
| `pnpm routes` | Regenerates `apps/web/src/generated/routeTree.gen.ts` from the route files without a build (~3 s: Vite runs the TanStack Router generator when it resolves the config). |
| `pnpm lint` / `pnpm typecheck` | Run ESLint or TypeScript on their own. |

## Code conventions

- **License header.** Every code file starts with `// SPDX-License-Identifier: AGPL-3.0-only` (shell scripts: `# SPDX-License-Identifier: AGPL-3.0-only` after the shebang). `pnpm check:spdx` enforces it for TypeScript and JavaScript files.
- **TypeScript.** Strict mode (including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`), ESM only, `erasableSyntaxOnly` (no enums, namespaces, or parameter properties), `import type` for type-only imports, relative imports with the `.ts` extension. Packages export their TypeScript source; there is no build step for them. Use the type system to make illegal states unrepresentable, and throw typed `Error` subclasses with clear messages.
- **Money.** Amounts are `bigint` in the currency's minor unit (IDR exponent 0, USD 2). Never use floating-point numbers on money paths. Domain logic lives in `packages/domain` and depends on nothing.
- **i18n.** Bahasa Indonesia is the source language and English is the second locale (PRD D26). Every user-facing string comes from the message catalog; no hard-coded UI text in components (lint-enforced). Format numbers, money, dates, and plurals with the shared locale-aware formatters, not by hand. Add every new key to both locales.
- **Formatting** is Prettier (single quotes, 120 columns). Do not reformat unrelated code in a change.
- **No dead code** and no `TODO` stubs or placeholder implementations in merged code.

## Security rules

- **Never commit secrets**: API keys, tokens, passwords, private keys, OAuth client secrets, real `.env` files, database dumps, or real financial data. `.env` and `.env.*` are gitignored; only `.env.example` (placeholders and local-only development values) is committed.
- **Secret scanning.** `pnpm install` points git at the repository hooks (`core.hooksPath = .githooks`) unless it runs in CI. The [`pre-commit`](.githooks/pre-commit) hook scans staged changes with gitleaks v8.30.1 and the repository's [`.gitleaks.toml`](.gitleaks.toml), using a local `gitleaks` binary if installed, otherwise the Docker image; if neither is available it warns and lets the commit through. CI scans the full history on every push, so a secret that slips past locally still blocks the merge. If you committed a secret, treat it as leaked: rotate it first, then remove it from history.
- **The `.pen` design file is private.** It is gitignored and must never be committed; only the generated digests and tokens are in the repository.
- **Security problems** are reported privately, never in public issues or pull requests. See [SECURITY.md](SECURITY.md).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <summary in the imperative, lowercase, no trailing period>

Optional body explaining what and why.

Signed-off-by: Your Name <you@example.com>
```

| Type | Use for |
|---|---|
| `feat` | A new user-facing feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Adding or changing tests only |
| `build` | Build system, dependencies, tooling, CI configuration |
| `chore` | Maintenance that fits none of the above |

Write commit messages and code comments in English. Keep the summary under about 72 characters, for example `feat: add safe daily limit to budget page` or `fix: show the correct period name across month ends`.
