# write.financial

An open-source web app for **tracking personal finances and assets**, available in **Bahasa Indonesia and English**, with IDR as the primary currency. Run it yourself (self-host) or use the managed service at [write.financial](https://write.financial) if you don't have time to maintain a server.

> **Status: planning.** The PRD, design, and implementation plan are done; there is no application code yet. Progress is tracked in [TODO.md](TODO.md).

## Principles

- **Manual entry, no bank login.** No connections to banks, brokers, or open banking.
- **Nothing changes your financial data automatically without confirmation.** Due subscriptions, recurring contributions, AI results, Gmail emails, statement imports, and period-close proposals all land in a **Review queue** first.
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
- **Reports:** PDF/Excel/CSV, CSV/XLSX statement import.
- **Optional:** AI Assistant and receipt reading (BYOK: OpenRouter/OpenAI-compatible), reading transaction emails from Gmail.
- **Security:** two-step verification (TOTP, passkey, backup codes), privacy mode to hide amounts.
- **Devices:** desktop and tablet. Phones come later.

## Stack

| Part | Technology |
|---|---|
| Web | TanStack Start (React), TanStack Router/Query/Form/Table, Tailwind CSS v4, shadcn/ui |
| Data | PostgreSQL (Drizzle ORM, RLS), Redis |
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

Contributions are welcome once the foundation (M0) is in place. Every commit must be signed off under the DCO (`git commit -s`).

## Security

Report vulnerabilities privately to **security@write.financial**. Please do not open public issues for security problems.

## License

[AGPL-3.0-only](LICENSE). The write.financial name and logo are not covered by the code license. Bank, e-wallet, and asset logos in `images/logos/` are trademarks of their respective owners and are used only to identify accounts.
