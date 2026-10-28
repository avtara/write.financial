# TODO

Details and exit criteria for each milestone are in the [implementation plan](docs/IMPLEMENTATION_PLAN.md) §8. FR/D numbers refer to the [PRD](docs/PRD.md).

**Definition of done for every item below (D27):** unit tests for all new/changed code, a co-located `*.test.ts(x)` for every source file, and **100% per-file unit coverage** (lines, branches, functions, statements) in every package, green in CI. An item is not checked off until that holds.

## Preparation

- [x] PRD v1.1 and implementation plan
- [x] Complete design, including additional screens (Section 19) and write.financial brand (Section 20)
- [x] Free + BYOK market data research
- [x] Public repo, AGPL-3.0 license, secret scanning + push protection, Dependabot
- [x] Google Cloud project `write-financial`: OAuth client, Gmail API, Pub/Sub topic `gmail-push`
- [x] Confirm runtime versions: Node 24 LTS + pnpm 12 + TypeScript 6.0 (see implementation plan §2)
- [ ] VPS details (the VPS is in hand): specs, Postgres version, dedicated or shared Redis, Docker, disk encryption
- [ ] DNS for `write.financial` (the domain is in hand) and email provider (SPF/DKIM/DMARC) — before staging
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
- [x] Better Auth: email/password, Google, 2FA (TOTP, backup codes, passkey), lockout, device list
- [x] Encrypted object storage (`integrations/objectstore`) + safe image upload
- [x] Design tokens, dark/light theme, desktop app shell + tablet rail, `<Money>` + privacy mode
- [x] i18n: Paraglide, Bahasa Indonesia + English messages, language switcher, locale-aware number/date formatting, missing-key check in CI
- [x] Domain `money`, `period`, `ledger` + golden tests
- [x] Worker skeleton (job schedulers, Bull Board, maintenance, D14 guard)
- [x] Docker image + self-host compose + first-run setup wizard
- [x] SECURITY.md, CONTRIBUTING.md, TRADEMARK.md
- [x] Encrypted backup + restore of DB and objects (age), restore proven in CI
- [x] Install proof in CI: fresh self-host stack through Caddy → setup wizard → admin sign-in with 2FA in ≤ 15 minutes
- [x] API tenant isolation: every server function called as user B against A's data, with a guard that fails on uncovered server functions; no `_enc` fields or secrets in responses
- [ ] Cloud staging: VPS, Caddy TLS, encrypted volumes, off-site backup copy — **deferred, not blocking M0**: the VPS and the domain are in hand; still needs the VPS details and DNS above and the off-site bucket
- [x] M0 unit tests: 100% per-file coverage gate green

## M1 — Ledger

- [x] 5-step onboarding
- [x] Accounts + balance reconciliation
- [x] Categories + tags
- [x] Record Transaction (sheet + Quick Add bar), transfers with exchange rates
- [x] Transactions page: filters, views, bulk actions, detail, split, delete + undo
- [x] ⌘K command palette
- [x] M1 unit tests: 100% per-file coverage gate green

## M2 — Periods, budget, dashboard

- [x] Payday periods 1–28, transition periods, recalculation
- [x] Versioned budgets, moving leftovers, rollover, alerts
- [x] Week/Month/Year dashboard + custom range
- [x] M2 unit tests: 100% per-file coverage gate green

## M3 — Scheduling, Review queue, subscriptions, calendar, notifications

- [x] Recurring transactions + scheduling engine in the worker (incl. the per-minute `dispatch` scanner)
- [x] Review queue page
- [x] Automatic period close + confirmed proposals
- [x] Subscriptions, calendar, notifications (popover, page, email)
- [x] M3 unit tests: 100% per-file coverage gate green

## M4 — Savings goals, debts, credit cards, receivables

- [x] Savings goals + sinking funds
- [x] Credit cards, installments, payment priority
- [x] Receivables: record, receive payments, write off
- [x] M4 unit tests: 100% per-file coverage gate green

## M5 — Investments & market data

- [x] Assets, investment transactions, valuation, allocation, rebalancing
- [x] Built-in, BYOK, and manual price sources + exchange rate & market API screen
- [x] M5 unit tests: 100% per-file coverage gate green

## M6 — Reports, export, import

- [x] Final monthly reports + quarterly/yearly/custom
- [x] PDF/Excel/CSV export, CSV/XLSX import
- [x] Full data export + account deletion
- [x] M6 unit tests: 100% per-file coverage gate green

## M7 — Automation & AI

- [x] Auto rules (suggestions) — M7.1: pure ordered evaluator, Settings editor/preview, form/import/review suggestions, confirmed version-pinned backfill, and a proposal-only `rules-backfill` worker job
- [x] AI Assistant + receipt reading (BYOK)
- [x] Gmail (feature flag) + Gmail log
- [x] M7 unit tests: 100% per-file coverage gate green — M7 phase-exit run (#81)

## M8 — Tablet & quality

- [x] Tablet polish on every page — M8.1 (rail, touch, ⋯ header actions, long-press) and M8.6 (visual review of every main page at 1440/1024/768, both themes, against Section 19)
- [x] Dashboard customization — M8.2: "Atur dashboard" reorders (drag or keyboard), hides, and sizes cards (⅓/⅔/full), adds Investasi ringkas, Tujuan tabungan, Pengingat tagihan; saved to the account with Reset ke default and Urungkan
- [x] App lock PIN — M8.3: optional per-device PIN (IndexedDB PBKDF2 hash), idle auto-lock 1/5/15/30 min, lock screen instead of the app, 5 wrong PINs or "Lupa PIN?" → sign out and remove the PIN
- [x] Accessibility and performance audit — M8.4: axe (WCAG 2.1 A/AA) with 0 serious violations on every main page at 1440/1024/768 and in the light theme, token contrast guard in `check:tokens`; M8.5: `pnpm test:perf`, p95 TTFB < 300 ms on every main page with 10,000 transactions
- [x] M8 unit tests: 100% per-file coverage gate green — M8.6 phase-exit run with `full-ci`

## M9a — Open-source v1.0 release

- [ ] Complete self-host guide
- [ ] Admin & instance status pages
- [ ] Cross-version upgrade tests in CI
- [ ] Code security audit
- [ ] M9a unit tests: 100% per-file coverage gate green

## M9b — Cloud launch

- [ ] Penetration test
- [ ] Google verification (login; Gmail later)
- [ ] M9b unit tests: 100% per-file coverage gate green
