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
pnpm check         # everything CI checks before the slower jobs
```

`.env` is for local development only and is gitignored. Never put real production credentials in it.

## Branches and pull requests

`main` is protected: nobody pushes to it directly, and every change goes through a pull request.

1. Create a branch from the latest `main`, for example `feat/budget-rollover` or `fix/period-boundary`.
2. Make small, focused commits, each signed off (`git commit -s`, see [DCO](#developer-certificate-of-origin-dco)).
3. Run `pnpm check` (and the other test commands that apply, see [Commands](#commands)) before pushing.
4. Push and open a pull request against `main`. Describe what changed, why, and how you tested it; link the issue if there is one.
5. CI must be green. Required checks: lint/format/typecheck/repo checks, unit tests (100% per-file coverage), mutation tests, integration tests, secret scan (gitleaks), and DCO sign-off.
6. Keep your branch up to date by **rebasing** onto `main` (`git fetch origin && git rebase origin/main`), never by merging `main` into it. `main` requires a linear history, and pull requests are merged with **rebase merge**, so every commit lands on `main` as you wrote it. Squash fixup commits (`git rebase -i origin/main`) before the pull request is merged, so each commit on `main` is meaningful and passes CI on its own.

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
- **100% coverage per file.** Lines, branches, functions, and statements, enforced per file by Vitest (v8 provider). Every source file is included in the coverage report, so a file without tests counts as 0%. A pull request that lowers any file below 100% cannot be merged.
- **Integration tests** are named `*.integration.test.ts` and run against real Postgres/Valkey/SeaweedFS through Testcontainers (Docker required). They prove what unit tests fake (RLS, S3, queues), do not count toward coverage, and never replace the co-located unit test.
- **Mutation testing.** `packages/domain` and `packages/crypto` also run Stryker; the mutation score must stay at **≥ 90%** (aim for 100%). Coverage alone does not prove a test asserts anything.
- **Coverage-ignore policy.** Exclusions are only for code we do not write (generated Paraglide output, generated code, `*.d.ts`, config files) and live in one shared list in [`vitest.config.ts`](vitest.config.ts), reviewed in pull requests. Inline `v8`/`c8`/`istanbul ignore` comments are rejected by lint unless they carry a reason and an issue reference, e.g. `/* v8 ignore next -- Node-only fallback, see #42 */`. Prefer deleting unreachable branches over ignoring them.
- **Good tests** assert behavior and boundaries, not implementation details. Golden numbers come from [PRD §7](docs/PRD.md#7-canonical-calculation-rules) and [plan §5](docs/IMPLEMENTATION_PLAN.md#5-domain-package-golden-tests-from-the-design-seed); use property tests (`fast-check`) where a law exists (round-trips, sums).

## Commands

| Command | What it does |
|---|---|
| `pnpm check` | Format check, lint, typecheck, SPDX header check, test-file check, and unit tests with the coverage gate. Run before every push. |
| `pnpm test` | Unit tests in watch mode. |
| `pnpm test:unit` | Unit tests once, with the 100% per-file coverage gate (same as CI). |
| `pnpm test:integration` | Integration tests (`*.integration.test.ts`) against real services; needs Docker. |
| `pnpm test:mutation` | Stryker mutation tests for `packages/domain` and `packages/crypto` (≥ 90%). Run it when you change those packages. |
| `pnpm format` | Format the repository with Prettier. |
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
