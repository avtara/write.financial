# TODO

Details and exit criteria for each milestone are in the [implementation plan](docs/IMPLEMENTATION_PLAN.md) §8. FR/D numbers refer to the [PRD](docs/PRD.md).

## Preparation

- [x] PRD v1.1 and implementation plan
- [x] Complete design, including additional screens (Section 19) and write.financial brand (Section 20)
- [x] Free + BYOK market data research
- [x] Public repo, AGPL-3.0 license, secret scanning + push protection, Dependabot
- [x] Google Cloud project `write-financial`: OAuth client, Gmail API, Pub/Sub topic `gmail-push`
- [ ] Confirm runtime versions: Node 22 + pnpm 10
- [ ] VPS details: specs, Postgres version, dedicated or shared Redis, Docker, disk encryption
- [ ] DNS for `write.financial` and email provider (SPF/DKIM/DMARC) — before staging
- [ ] Off-site backup bucket (Backblaze B2 / Cloudflare R2)
- [ ] Offline backup location for the master encryption key (KEK)
- [ ] Export logo to `images/brand/`

## M0 — Secure foundation

- [ ] pnpm + Turborepo monorepo, SPDX headers, `.nvmrc`, `.env.example`
- [ ] CI: lint, typecheck, test, gitleaks, DCO check
- [ ] Branch protection on `main` (PR required + CI passing)
- [ ] Dev `docker-compose`: Postgres, Redis, SeaweedFS, Mailpit
- [ ] Drizzle + initial migrations with RLS and separate DB roles
- [ ] `packages/crypto`: per-user KEK/DEK, log redaction
- [ ] Better Auth: email/password, Google, 2FA (TOTP, backup codes, passkey), lockout, device list
- [ ] Encrypted object storage (`integrations/objectstore`) + safe image upload
- [ ] Design tokens, dark/light theme, desktop app shell + tablet rail, `<Money>` + privacy mode
- [ ] Domain `money`, `period`, `ledger` + golden tests
- [ ] Worker skeleton (dispatcher, Bull Board, maintenance)
- [ ] Docker image + self-host compose + first-run setup wizard
- [ ] SECURITY.md, CONTRIBUTING.md, TRADEMARK.md
- [ ] Cloud staging with encrypted backups

## M1 — Ledger

- [ ] 5-step onboarding
- [ ] Accounts + balance reconciliation
- [ ] Categories + tags
- [ ] Record Transaction (sheet + Quick Add bar), transfers with exchange rates
- [ ] Transactions page: filters, views, bulk actions, detail, split, delete + undo
- [ ] ⌘K command palette

## M2 — Periods, budget, dashboard

- [ ] Payday periods 1–28, transition periods, recalculation
- [ ] Versioned budgets, moving leftovers, rollover, alerts
- [ ] Week/Month/Year dashboard + custom range

## M3 — Scheduling, Review queue, subscriptions, calendar, notifications

- [ ] Recurring transactions + scheduling engine in the worker
- [ ] Review queue page
- [ ] Automatic period close + confirmed proposals
- [ ] Subscriptions, calendar, notifications (popover, page, email)

## M4 — Savings goals, debts, credit cards, receivables

- [ ] Savings goals + sinking funds
- [ ] Credit cards, installments, payment priority
- [ ] Receivables: record, receive payments, write off

## M5 — Investments & market data

- [ ] Assets, investment transactions, valuation, allocation, rebalancing
- [ ] Built-in, BYOK, and manual price sources + exchange rate & market API screen

## M6 — Reports, export, import

- [ ] Final monthly reports + quarterly/yearly/custom
- [ ] PDF/Excel/CSV export, CSV/XLSX import
- [ ] Full data export + account deletion

## M7 — Automation & AI

- [ ] Auto rules (suggestions)
- [ ] AI Assistant + receipt reading (BYOK)
- [ ] Gmail (feature flag) + Gmail log

## M8 — Tablet & quality

- [ ] Tablet polish on every page
- [ ] Dashboard customization, app lock PIN
- [ ] Accessibility and performance audit

## M9a — Open-source v1.0 release

- [ ] Complete self-host guide
- [ ] Admin & instance status pages
- [ ] Cross-version upgrade tests in CI
- [ ] Code security audit

## M9b — Cloud launch

- [ ] PT Perorangan + NIB + PSE registration
- [ ] Privacy policy & terms of service
- [ ] Penetration test
- [ ] Google verification (login; Gmail later)
