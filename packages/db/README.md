# @wf/db

Drizzle schema, SQL migrations (with roles, grants, and Row-Level Security), the user-scoped transaction, and the
repositories. The only package that opens Postgres connections (plan §3).

## Commands

```sh
pnpm --filter @wf/db generate          # drizzle-kit: diff src/schema.ts against migrations/meta, write the next SQL file
pnpm --filter @wf/db db:bootstrap      # create/update the roles (superuser, idempotent)
pnpm --filter @wf/db db:migrate        # apply pending migrations as wf_migrate
pnpm --filter @wf/db db:rewrap-keys    # after adding a KEK version to KEK_FILE: re-wrap every DEK (as wf_migrate)
pnpm db:seed --email <user>            # dev/E2E: load the design persona into that existing user's empty ledger

The `db:*` scripts read the repository `.env` (`DATABASE_URL_*`, see `.env.example`). `generate` uses
[`drizzle.config.ts`](drizzle.config.ts). Tables come from `generate`; everything drizzle-kit does not model (functions,
RLS, policies, grants, triggers, seed rows) goes into a hand-written migration created with
`pnpm --filter @wf/db generate --custom --name <name>`. A unit test fails when the schema and the latest snapshot differ.

## API

| Export                                          | What                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `./db`                                          | `createDb(url, { max?, statementTimeoutMs? })`, `withUser(db, userId, fn)`, `firstRow`, `isUuid`, types |
| `./schema`                                      | Drizzle tables and enums (pass to Better Auth's Drizzle adapter)                                        |
| `./roles`                                       | `ROLES`, `bootstrapRoles(superuserUrl, passwords)`                                                      |
| `./migrate`                                     | `migrate(migrateUrl)` (advisory-locked, one transaction)                                                |
| `./user-keys`                                   | `createUserKeys(db, keyring)` → `getOrCreateDek(userId)`, `rewrapAll()`                                 |
| `./security-events`                             | `createSecurityEvents(db)` → `append(userId, event)`, `list(userId, { limit, before? })`, `signInHistory(userId, device)`                |
| `./preferences`                                 | `createPreferences(db)` → `get(userId)`, `update(userId, patch)`                                        |
| `./profiles`                                    | `createProfiles(db)` → `get(userId)`, `update(userId, { name?, nickname?, locale?, timezone? })`, `isTimeZone` |
| `./instance-settings`                           | `createInstanceSettings(db, keyring)` → `get()`, `updateSetup(adminUserId, input)`, `smtpPassword()`    |
| `./entitlements`                                | `createEntitlements(db)` → `can(userId, feature)`                                                       |
| `./invitations` | `createInvitations(db)` → `create(adminUserId, …)` (`wf_app`), `isUsable`, `claim`, `claimForEmail` (`wf_auth`) |
| `./testing` | Test-only: PGlite helpers (`startMigrated`, `insertUser`, …) for other packages' unit tests |
| `./ledger-errors` | `LedgerError` with a stable `code` (`LEDGER_ERROR_CODES`) for every expected ledger refusal |
| `./ledger-core` | In-transaction building blocks: `recordTransactionIn`, `planTransactionIn`, `writeLinesIn`, `valuationIn`, `builtInCategoryIn`, `resolveTagsIn` |
| `./accounts` | `createAccounts(db)` → balances + available balance, CRUD with FR-R2/R3 rules, archive/restore/delete, reorder, `reconcile`, `flows`, `series`; an investment account's balance is its cash, `holdingsValueBaseMinor` the value of its holdings |
| `./categories` | `createCategories(db, { getDek })` → built-ins on first use, CRUD, move, merge, archive, delete (→ uncategorized + one `category_deleted` Review item per transaction) |
| `./tags` | `createTags(db)` → usage counts, create/rename, merge (old slug becomes an alias), `similar` |
| `./transactions` | `createTransactions(db, { getDek })` → create (idempotent per `client_id`), get, update, soft delete + restore, duplicate, split/unsplit, bulk edits, attachments |
| `./transaction-query` | `createTransactionQuery(db, { getDek })` → Transactions page list, by-day/by-category groups, summary |
| `./fx-rates` | `createFxRates(db)` → manual rates, `referenceRate`; worker: `upsertGlobal`, `latestGlobal`, `currenciesInUse` |
| `./drafts`, `./recent-items`, `./activity` | Encrypted form drafts, ⌘K recently opened, per-entity timeline |
| `./goals` | `createGoals(db)` → savings goals and sinking funds (FR-G1–G4, FR-B6): account funding sources (whole or fixed amount) and asset sources (whole or a percentage of the units, `setAssetSources`), recurring contributions as plans on recurrences, deposit/withdraw (labeled transfers), pay from goal, complete/reopen, allocations per account |
| `./debts` | `createDebts(db)` → debts and installment plans (FR-U1–U6): schedules computed by `@wf/domain/debt`, card installments from card expenses, card payment allocation + recalculation (FR-U4), installment payments; non-card installments reach the Review queue as occurrences |
| `./receivables` | `createReceivables(db, { getDek })` → receivables (FR-U7): record (`receivable_out`), receive payment (`receivable_in`), write off (`writeoff` expense), H-1 reminder; the person and note are encrypted |
| `./onboarding` | `createOnboarding(db, { now? })` → FR-A4 progress: `progress`, `completeStep` (resume step moves forward only), `finish` ("Ke Ringkasan"), `setBaseCurrency` (refused once an account exists) |
| `./periods` | `createPeriods(db)` → materialized periods (FR-P1–P3): `list`, `get`, `covering`, `previewStartDay`/`changeStartDay` (FR-P2 (a) next period with a transition, (b) recalculate), `lock` (period close, worker) |
| `./budgets` | `createBudgets(db)` → versioned budgets (FR-B1–B5): `status` of a period, `history`, `saveVersion` (without `lines`: only the expected income), `setLine`, `removeLine`, `fillFromAverage`, `moveLeftover`/`undoMove`, `dismissAlert`/`restoreAlert` |
| `./dashboard` | `createDashboard(db)` → `get` for a week, period, year, or custom range (FR-D1/D2, FR-S7): KPIs + comparison, money flow, categories, trend, calendar, account flows, budget card |
| `./occurrences` | Shared schedule core (app + worker, no ledger writes): `MATERIALIZE_DAYS` (90), `userClockIn`, `materializeIn` (idempotent per source + due date; 09.00-local `remind_at`), `pruneFutureIn` (app only), `recordPastChargeIn`, `RecurrenceTemplate` + `encodeTemplate`/`decodeTemplate`, `recurrenceDueDates`/`subscriptionDueDates` |
| `./schedules` | `createSchedules(db)` → recurrences (FR-T6/L8: create/update/stop/undo, 3-date preview), subscriptions (FR-SUB1–SUB6: overview, CRUD, change account, pause, cancel, reactivate, usage rating, billing history), detected candidates (FR-SUB4), calendar `listScheduled` (FR-C2) |
| `./review-items` | Shared Review queue producer (app + worker): `ReviewPayload` (transaction draft, category, rollover, leftover; encrypted with the user's DEK), `insertReviewItemIn` (idempotent per `dedupe_key`), `readReviewPayload`, `occurrenceReviewItemIn` |
| `./review` | `createReview(db, { getDek })` → Review queue (FR-L7): `list`, `counts` (badge), `confirm` (the only place a proposal is applied; item id = transaction `client_id`), `confirmBulk`, `ignore`, `markUnpaid`, `confirmOccurrence` |
| `./notifications` | `createNotifications(db)` → `list` (filters, search, cursor), `counts`, `markRead`, `nextReminder`; shared `insertNotificationIn` (idempotent per `ref`) |
| `./investments` | `createInvestments(db)` → assets on platforms, "Daftar saya" categories, allocation targets, trades (FR-I2: buy/pending buy, sell to cash or a bank, dividends, cash top-up, adjust holdings, settle, remove) with their cash legs in the ledger (managed `investment`/`dividend` transactions), `portfolio` (holdings derived from the trades, valuation, allocation), snapshots |
| `./market-data` | `createMarketData(db)` → the effective quote per asset with source, time, and stale flag (`@wf/domain/market` `resolveQuote`), manual prices, the API log; worker writes of built-in quotes (global) and BYOK results (per user) |
| `./market-credentials` | `createMarketCredentials(db, { getDek })` → BYOK market keys encrypted with the user's DEK (last 4 only; 2FA required), status/quota/retry-after, `apiKey` for the worker, `remove` (also the provider's BYOK results) |
| `./portfolio` | In-transaction valuation of every asset now (`assetValuesIn`, `holdingsValueByAccount`) for accounts, goals, and investments |
| `./seed` | `seedLedger(db, userId, { getDek })`: the design persona (`DESIGN_SEED`, closed September + October, budget, goals with their account and asset sources, the investments (assets, opening holdings, DCA buys, the pending RDPU buy, targets, a snapshot), 11 subscriptions, 4 recurring transfers with their paid bills and goal shares, 5 receivables recorded without ledger transactions) through the repositories; `seedAutomation(workerDb, userId, { getDek })` (as `wf_worker`): what the jobs would have created by now (overdue bills, September close proposal) |
| `./maintenance`                                 | `createMaintenance(db)` → `purgeExpiredAuth(now)`, `purgeNotifications(now)` (90 days) (worker only, via `wf_maintenance_purge_auth` / `wf_maintenance_purge_notifications`) |
| `./dispatch` | Worker: `createDispatch(db)` → `users()`, `dueReminders(now, limit)`, `pendingOutbox(now, limit)` (SECURITY DEFINER `wf_worker_users`, `wf_due_reminders`, `wf_pending_outbox`: ids and time zones only) |
| `./occurrence-jobs` | Worker: `createOccurrenceJobs(db, { getDek })` → `advance(userId, now)` (materialize, due → Review queue, overdue → unconfirmed, trial/pause reminders), `remind(userId, occurrenceId, now)` (notification + email outbox, once) |
| `./period-close` | Worker: `createPeriodClose(db, { getDek })` → `endedPeriods`, `propose` (FR-P4 rollover + leftover proposals as review items, `period_closed` notification); the lock is `periods.lock` |
| `./budget-alerts`, `./balance-checks`, `./detect-recurring` | Worker: threshold notifications (once per period/category/threshold), low balance / unchecked / insufficient paying account, FR-SUB4 candidates (suggestions only) |
| `./outbox` | Worker: `createOutbox(db)` → `get`, `markSent`, `markFailed` (the `notify` job) |
| `./backup`                                      | Self-host backup/restore: `bundledMigrations()`, `migrationLevel(url)`, `inspectRestoreTarget(superuserUrl)`, `resetAppSchema(superuserUrl, passwords)` |

Repositories take `userId` from the caller's session or job, never from request input, and run every query through
`withUser`, which sets `app.user_id` with `set_config(…, true)` (transaction-local) and rejects non-UUID ids. Methods are
plain functions, so `getDek: userKeys.getOrCreateDek` can be handed to other packages.

**Better Auth** (auth module): Drizzle adapter with this schema; model names `users`, `sessions`, `accounts_auth`,
`verifications`, `two_factors`, `passkeys`; `advanced.database.generateId: 'uuid'` (ids default to `uuidv7()`); the extra
`users` columns as `additionalFields` (`role`, `onboardingCompletedAt`, `deletionRequestedAt` with `input: false`);
connection `DATABASE_URL_AUTH`.

## Roles and privileges

All roles are LOGIN roles without SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, or REPLICATION. `wf_migrate` runs the
migrations and owns every table; Row-Level Security is ENABLEd and FORCEd on every table except `plans` and
`entitlements`, so not even the owner sees rows without a policy. `app_user_id()` is `NULL` outside `withUser`, so a query
without a user context matches no user-owned row. `U(…)` = column-level UPDATE, `S(…)` = column-level SELECT.

| Table                                                      | `wf_app`                       | `wf_worker`  | `wf_auth`         | `wf_readonly_ops`        | Rows (policies)                                          |
| ---------------------------------------------------------- | ------------------------------ | ------------ | ----------------- | ------------------------ | -------------------------------------------------------- |
| `users`                                                    | S, U(profile columns¹)         | S            | S I U D           | –                        | app/worker: own row; auth: all                           |
| `sessions`, `accounts_auth`, `verifications`, `two_factors`, `passkeys` | –                 | –            | S I U D           | –                        | auth: all                                                |
| `user_preferences`                                         | S I U                          | S            | –                 | –                        | own rows                                                 |
| `user_keys`                                                | S I                            | S I          | –                 | –                        | own rows; `wf_migrate`: all (KEK rotation)               |
| `security_events` (append-only trigger)                    | S I                            | S I          | S I               | S                        | own rows; ops: all                                       |
| `user_plans`                                               | S                              | S            | –                 | S                        | own rows; ops: all                                       |
| `instance_settings` (one row)                              | S, U(setup columns²)           | S            | S                 | S(all but secrets³)      | read: all; update: admins only; `wf_migrate`: all        |
| `invitations`                                              | S I U D                        | –            | S, U(`used_at`)   | –                        | app: admins only; auth: all                              |
| `plans`, `entitlements` (no RLS)                           | S                              | S            | –                 | S                        | –                                                        |
| ledger: `accounts`, `categories`, `tags`, `tag_aliases`, `transaction_tags`, `transactions`, `postings`, `transfer_meta`, `balance_adjustments`, `attachments`, `goals` | S I U D | S (D14) | – | – | own rows |
| `drafts`, `recent_items`                                   | S I U D                        | –            | –                 | –                        | own rows                                                 |
| `activity_log`                                             | S I                            | –            | –                 | –                        | own rows                                                 |
| `fx_rates`                                                 | S I U D (own manual rows)      | S I U (global rows) | –          | –                        | read: global + own; worker writes only `user_id IS NULL` |
| `periods`                                                  | S I U D                        | S I, U(`status`, `closed_at`, `updated_at`) | – | –                | own rows (worker: `periods.lock` only)                   |
| `budget_versions`, `budget_lines`, `budget_period_overrides`, `budget_alert_dismissals` | S I U D | S (D14)  | –                 | –                        | own rows                                                 |
| `recurrences`, `subscriptions`                             | S I U D                        | S (D14)      | –                 | –                        | own rows                                                 |
| `goal_funding_sources`, `goal_contribution_plans`, `debts`, `debt_installments`, `card_payment_allocations`, `receivables`, `receivable_payments` | S I U D | S (D14) | – | – | own rows |
| `assets`, `asset_categories`, `allocation_targets`, `investment_trades` (+ view `holdings`, security_invoker) | S I U D | S (D14) | – | – | own rows |
| `market_credentials` | S I U D | S, U(`status`, `quota_used`, `quota_limit`, `quota_reset_at`, `retry_after`, `last_tested_at`, `updated_at`) | – | – | own rows; INSERT only with `users.two_factor_enabled` |
| `user_quotes` | S D | S I U D | – | – | own rows (BYOK results never shared) |
| `market_quotes` (view `market_quotes_latest`: S for `wf_app`, `wf_worker`) | – | S I U | – | – | built-in sources only, global; `wf_migrate` reads it for the view |
| `market_api_logs` | S I | S I | – | – | own rows + built-in fetches (`user_id` null) |
| `portfolio_snapshots` | S I U | S I U | – | – | own rows |
| `scheduled_occurrences`                                    | S I U D                        | S I, U(`status`, `remind_at`, `reminded_at`, `expected_minor`, `updated_at`) | – | – | own rows; `wf_migrate`: dispatch scan (S)        |
| `detected_recurring`                                       | S I U D                        | S I U        | –                 | –                        | own rows                                                 |
| `review_items`                                             | S I U D                        | S I (D14: no UPDATE) | –         | –                        | own rows                                                 |
| `notifications`                                            | S, U(`read_at`), D             | S I          | –                 | –                        | own rows; `wf_migrate`: retention purge                  |
| `notification_outbox`                                      | –                              | S I, U(`sent_at`, `attempts`, `last_error`) | – | –               | own rows                                                 |

¹ `name, image, nickname, timezone, locale, base_currency, onboarding_completed_at, onboarding_step, deletion_requested_at, updated_at`
(not `role`, `email`, `email_verified`, `two_factor_enabled`). ² Everything the setup wizard (FR-OP1) writes, including
`smtp_password_enc` and `instance_dek_wrapped`; the wizard runs as the admin it just created. ³ No `smtp_password_enc`,
no `instance_dek_wrapped`.

Database level: CONNECT for every role; CREATE on the database and on schema `public` for `wf_migrate` only.
`wf_readonly_ops` has `default_transaction_read_only = on` and `log_statement = 'all'`, and cannot log in unless
`DATABASE_URL_READONLY_OPS` gives it a password. `bootstrapRoles` sends SCRAM-SHA-256 verifiers, never plaintext
passwords. Any change to this matrix must update `src/migrate.test.ts` (it asserts the exact grants).

Triggers (as the invoker, so RLS applies): `receivable_payments_within_principal` (Σ payments ≤ principal),
`goal_funding_sources_asset_within_100` (Σ goal percentages per asset ≤ 100%, a whole asset 100%), and the deferred
constraint trigger `allocation_targets_sum_100` (a user's targets total exactly 100%, or there are none).

Functions: the SECURITY DEFINER functions are `wf_maintenance_purge_auth(timestamptz) → jsonb` and
`fx_currencies_in_use() → SETOF char(3)` (owner `wf_migrate`, `search_path = pg_catalog, public`, EXECUTE for
`wf_worker` only, not PUBLIC). The purge deletes expired `verifications` and `sessions` and `invitations` that expired
or were used more than 30 days ago, as of the given time capped at the server's `now()`, and returns the counts per
table. `wf_migrate` has SELECT and DELETE policies on those three tables that match only such dead rows, so even the
function cannot remove a live session. `fx_currencies_in_use` returns only the currency codes in use (accounts, base
currencies, the "Mata uang tambahan" in `user_preferences.extra_currencies`, manual rates) for the fx job; `wf_migrate`
has SELECT policies on `accounts`, `users`, `user_preferences`, and `fx_rates` for it.
M3 adds four for the worker's scanners: `wf_worker_users() → (user_id, time_zone)` (users not being deleted),
`wf_due_reminders(now, limit) → (user_id, occurrence_id)` (reminders due and not sent), `wf_pending_outbox(now, limit)
→ (user_id, outbox_id)` (unsent emails with fewer than 5 attempts), and `wf_maintenance_purge_notifications(now) →
bigint` (FR-S5 90-day retention, `now` capped like the auth purge; outbox rows cascade). They return ids and time zones
only; `wf_migrate` has SELECT policies on `scheduled_occurrences`, `notification_outbox`, and `notifications` (plus
DELETE on `notifications`) for them.

Ledger rows reference their parents with composite `(user_id, id)` foreign keys, so a row can never point at another
user's account, category, transaction, or tag (foreign-key checks bypass RLS). A trigger limits a transaction to five
tags; another keeps the payments of a receivable within its principal (FR-U7), also against raw SQL. `pg_trgm` backs
the merchant/description/goal-name search indexes.

## Tests

- **Unit (`*.test.ts`, 100% coverage):** against [PGlite](https://pglite.dev) 0.5 — PostgreSQL 18.6 compiled to WASM, so
  `uuidv7()`, roles, `SET ROLE`, grants, RLS, and triggers behave as in production — served over
  `@electric-sql/pglite-socket`, so the code under test uses postgres.js and Drizzle exactly as in production, and the
  migrations run as `wf_migrate`. Repositories are tested under the role that uses them (`SET ROLE wf_app`, …), so
  their tests also prove the grants and policies. Limits (see [`test/pglite.ts`](test/pglite.ts)): one connection at a
  time, startup parameters ignored, no password authentication.
- **Integration (`*.integration.test.ts`, `pnpm test:integration`):** Testcontainers `postgres:18.6` with real logins
  per role: bootstrap → concurrent migrate → two users; cross-tenant read/update/delete through `withUser`, raw queries
  without `app.user_id` on every user-owned table (found from foreign keys to `users`), auth tables closed to
  `wf_app`/`wf_worker`, append-only security events, no plaintext in a dump, concurrent DEK creation, KEK rotation.
