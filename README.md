# write.financial

An open-source web app for **tracking personal finances and assets**, available in **Bahasa Indonesia and English**, with IDR as the primary currency. Run it yourself (self-host) or use the managed service at [write.financial](https://write.financial) if you don't have time to maintain a server.

> **Status: planning.** The PRD, design, and implementation plan are done; there is no application code yet. Progress is tracked in [TODO.md](TODO.md).

## Principles

- **Manual entry, no bank login.** No connections to banks, brokers, or open banking.
- **Nothing changes your financial data automatically without confirmation.** Due subscriptions, recurring contributions, AI results, Gmail emails, statement imports, rule-based backfills, and period-close proposals all land in a **Review queue** (or an explicit confirmation) first.
- **Your data is yours.** Each user's financial data is isolated (Row-Level Security), secrets and files are encrypted per user, and there is no telemetry.
- **One codebase for everyone.** No features are locked to the cloud version.

## Features (planned for v1)

- **Ledger:** accounts (bank, e-wallet, cash, credit card, investment platform; multi-currency), transactions, transfers with fees and FX differences, split transactions, tags, receipt attachments, balance reconciliation.
- **Payday periods:** period start day 1–28, immutable final monthly reports.
- **Budget:** per-category limits (Needs/Wants), safe daily limit, projection, moving leftovers, sinking funds.
- **Subscriptions & calendar:** bill reminders, subscription detection from transactions, spending and schedule calendar.
- **Savings goals:** goals linked to account balances and shares of investment units.
- **Debts, installments, receivables:** credit cards, installment splits, payment priority, receivables from split bills.
- **Investments:** multi-platform IDR/USD holdings, gains/losses, allocation vs target. Prices from free sources, your own API keys (BYOK), or manual entry.
- **Auto rules:** your own ordered conditions (description, weekday, local time, account, direction, subscription) suggest categories and tags in new, imported, and review drafts; manage and preview them in the Settings popup, with trial controls stacked at tablet widths. The current-period preview explains every condition, and past transactions change only after you select and confirm them.
- **Reports:** PDF/Excel/CSV, CSV/XLSX statement import.
- **AI provider settings (implemented):** the Settings popup supports encrypted BYOK credentials for OpenRouter, ZenMux, and operator-approved OpenAI-compatible endpoints; explicit inference tests, per-user monthly USD accounting, and 30-day metadata logs/CSV. Unknown charges stay estimated, never falsely free.
- **AI Assistant (implemented):** `⌘J` answers from your own data (budget, spending, largest transactions, balances) with the cards behind every number, and proposes transaction drafts that stay unsaved until you confirm them. The assistant never writes the ledger itself.
- **Receipt OCR (implemented):** Record Transaction and Assistant accept one JPG/PNG/PDF up to 2 MiB. A queued vision request produces an editable review proposal with line items, uncertainty, rules suggestions and same-currency duplicate detection across your accounts. Only explicit Save or duplicate-attach changes the ledger or its attachments; saved receipts and original extraction evidence are encrypted. Unreadable receipts support a new billed retry or manual entry. PDFs use Poppler, are limited to four unencrypted pages, and are rasterized before vision.
- **Optional Gmail (restricted, operator-enabled):** separate read-only consent requires 2FA and fresh authentication. Authenticated push and ten-minute fallback polling stage filtered email evidence for BYOK extraction; every confidence remains an editable Review proposal. Only explicit confirmation records `source=gmail`. Includes dry runs, monthly statistics, encrypted evidence, replay-safe billing, manual duplicate suppression, CSV and disconnect. Public Gmail stays disabled until Google's restricted-scope verification and security assessment; see [operator setup](docs/self-host/install.md#optional-gmail-restricted-scope).
- **Security:** two-step verification (TOTP, passkey, backup codes), privacy mode to hide amounts.
- **Devices:** desktop and tablet. Phones come later.

## Stack

| Part | Technology |
|---|---|
| Runtime | Node.js 24 LTS, pnpm 12, TypeScript 6 |
| Web | TanStack Start (React 19, Vite 8), TanStack Router/Query/Form/Table, Tailwind CSS v4, shadcn/ui |
| Data | PostgreSQL 18 (Drizzle ORM, RLS), Valkey (Redis-compatible) |
| Worker & scheduling | BullMQ (separate process) |
| Files & images | SeaweedFS (S3 API, replaceable with any S3) |
| Auth | Better Auth (Google, email/password, 2FA, passkey) |
| Deploy | Docker Compose (self-host); one image for both self-host and cloud |

## Self-host

Not available yet. Target for the open-source v1.0 release (milestone M9a): run `docker compose up` and follow the setup wizard, in under 15 minutes. The full guide will live in `docs/self-host/`.

## Documentation

- [PRD](docs/PRD.md): product requirements, calculation rules, security, and decisions (D1–D26)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): architecture, data model, worker, milestones M0–M9b
- [Market data research](docs/research/market-data.md): free APIs, BYOK, and what is not allowed
- [Design analysis](docs/design-analysis/) and [screen digests](design/digest/) (the digests contain the original Indonesian UI copy)

## Contributing

Contributions are welcome once the foundation (M0) is in place. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: every change ships with unit tests at 100% per-file coverage (D27), and every commit is signed off under the DCO (`git commit -s`).

## Security

Report vulnerabilities privately to **security@write.financial** or through GitHub private vulnerability reporting, never in public issues. See [SECURITY.md](SECURITY.md) for the disclosure policy.

## License

[AGPL-3.0-only](LICENSE). The write.financial name and logo are not covered by the code license; see [TRADEMARK.md](TRADEMARK.md). Bank, e-wallet, and asset logos in `images/logos/` are trademarks of their respective owners and are used only to identify accounts.
