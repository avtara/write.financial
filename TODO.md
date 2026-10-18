# TODO

Details and exit criteria for each milestone are in the [implementation plan](docs/IMPLEMENTATION_PLAN.md) §8. FR/D numbers refer to the [PRD](docs/PRD.md).

**Definition of done for every item below (D27):** unit tests for all new/changed code, a co-located `*.test.ts(x)` for every source file, and **100% per-file unit coverage** (lines, branches, functions, statements) in every package, green in CI. An item is not checked off until that holds.

## Preparation

- [x] PRD v1.1 and implementation plan
- [x] Complete design, including additional screens (Section 19) and write.financial brand (Section 20)
- [x] Free + BYOK market data research
- [x] Public repo, AGPL-3.0 license, secret scanning + push protection, Dependabot
- [x] Google Cloud project `write-financial`: OAuth client, Gmail API, Pub/Sub topic `gmail-push`
- [ ] Confirm runtime versions: Node 24 LTS + pnpm 12 + TypeScript 6.0 (see implementation plan §2)
- [ ] VPS details: specs, Postgres version, dedicated or shared Redis, Docker, disk encryption
- [ ] DNS for `write.financial` and email provider (SPF/DKIM/DMARC) — before staging
- [ ] Off-site backup bucket (Backblaze B2 / Cloudflare R2)
- [ ] Offline backup location for the master encryption key (KEK)
- [ ] Export logo to `images/brand/`

## M0 — Secure foundation

- [x] pnpm + Turborepo monorepo, SPDX headers, `.nvmrc`, `.env.example`
- [x] CI: lint, typecheck, unit tests with the **100% per-file coverage gate** + test-file existence check, mutation tests (domain/crypto), integration, E2E, gitleaks, DCO check
- [x] Vitest workspace + `@vitest/coverage-v8` thresholds `100` per file, browser mode for components, `msw`, `fast-check`, Stryker; ESLint rule blocking unjustified `v8 ignore`
- [x] Branch protection on `main` (PR required + CI passing)
- [x] Dev `docker-compose`: Postgres 18, Valkey 9, SeaweedFS, Mailpit
- [x] Drizzle + initial migrations with RLS and separate DB roles
- [x] `packages/crypto`: per-user KEK/DEK, log redaction
- [ ] Better Auth: email/password, Google, 2FA (TOTP, backup codes, passkey), lockout, device list
- [x] Encrypted object storage (`integrations/objectstore`) + safe image upload
- [x] Design tokens, dark/light theme, desktop app shell + tablet rail, `<Money>` + privacy mode
- [ ] i18n: Paraglide, Bahasa Indonesia + English messages, language switcher, locale-aware number/date formatting, missing-key check in CI
- [x] Domain `money`, `period`, `ledger` + golden tests
- [ ] Worker skeleton (dispatcher, Bull Board, maintenance)
- [ ] Docker image + self-host compose + first-run setup wizard
- [x] SECURITY.md, CONTRIBUTING.md, TRADEMARK.md
- [ ] Cloud staging with encrypted backups

## M1 — Ledger

- [ ] 5-step onboarding
- [ ] Accounts + balance reconciliation
- [ ] Categories + tags
- [ ] Record Transaction (sheet + Quick Add bar), transfers with exchange rates
- [ ] Transactions page: filters, views, bulk actions, detail, split, delete + undo
- [ ] ⌘K command palette
- [ ] M1 unit tests: 100% per-file coverage gate green

## M2 — Periods, budget, dashboard

- [ ] Payday periods 1–28, transition periods, recalculation
- [ ] Versioned budgets, moving leftovers, rollover, alerts
- [ ] Week/Month/Year dashboard + custom range
- [ ] M2 unit tests: 100% per-file coverage gate green

## M3 — Scheduling, Review queue, subscriptions, calendar, notifications

- [ ] Recurring transactions + scheduling engine in the worker
- [ ] Review queue page
- [ ] Automatic period close + confirmed proposals
- [ ] Subscriptions, calendar, notifications (popover, page, email)
- [ ] M3 unit tests: 100% per-file coverage gate green

## M4 — Savings goals, debts, credit cards, receivables

- [ ] Savings goals + sinking funds
- [ ] Credit cards, installments, payment priority
- [ ] Receivables: record, receive payments, write off
- [ ] M4 unit tests: 100% per-file coverage gate green

## M5 — Investments & market data

- [ ] Assets, investment transactions, valuation, allocation, rebalancing
- [ ] Built-in, BYOK, and manual price sources + exchange rate & market API screen
- [ ] M5 unit tests: 100% per-file coverage gate green

## M6 — Reports, export, import

- [ ] Final monthly reports + quarterly/yearly/custom
- [ ] PDF/Excel/CSV export, CSV/XLSX import
- [ ] Full data export + account deletion
- [ ] M6 unit tests: 100% per-file coverage gate green

## M7 — Automation & AI

- [ ] Auto rules (suggestions)
- [ ] AI Assistant + receipt reading (BYOK)
- [ ] Gmail (feature flag) + Gmail log
- [ ] M7 unit tests: 100% per-file coverage gate green

## M8 — Tablet & quality

- [ ] Tablet polish on every page
- [ ] Dashboard customization, app lock PIN
- [ ] Accessibility and performance audit
- [ ] M8 unit tests: 100% per-file coverage gate green

## M9a — Open-source v1.0 release

- [ ] Complete self-host guide
- [ ] Admin & instance status pages
- [ ] Cross-version upgrade tests in CI
- [ ] Code security audit
- [ ] M9a unit tests: 100% per-file coverage gate green

## M9b — Cloud launch

- [ ] PT Perorangan + NIB + PSE registration
- [ ] Privacy policy & terms of service
- [ ] Penetration test
- [ ] Google verification (login; Gmail later)
- [ ] M9b unit tests: 100% per-file coverage gate green
