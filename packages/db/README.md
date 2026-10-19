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
| `./accounts` | `createAccounts(db)` → balances + available balance, CRUD with FR-R2/R3 rules, archive/restore/delete, reorder, `reconcile`, `flows`, `series` |
| `./categories` | `createCategories(db)` → built-ins on first use, CRUD, move, merge, archive, delete (→ uncategorized) |
| `./tags` | `createTags(db)` → usage counts, create/rename, merge (old slug becomes an alias), `similar` |
| `./transactions` | `createTransactions(db, { getDek })` → create (idempotent per `client_id`), get, update, soft delete + restore, duplicate, split/unsplit, bulk edits, attachments |
| `./transaction-query` | `createTransactionQuery(db, { getDek })` → Transactions page list, by-day/by-category groups, summary |
| `./fx-rates` | `createFxRates(db)` → manual rates, `referenceRate`; worker: `upsertGlobal`, `latestGlobal`, `currenciesInUse` |
| `./drafts`, `./recent-items`, `./goals`, `./activity` | Encrypted form drafts, ⌘K recently opened, minimal goals, per-entity timeline |
| `./periods` | `createPeriods(db)` → materialized periods (FR-P1–P3): `list`, `get`, `covering`, `previewStartDay`/`changeStartDay` (FR-P2 (a) next period with a transition, (b) recalculate), `lock` (period close, worker) |
| `./budgets` | `createBudgets(db)` → versioned budgets (FR-B1–B5): `status` of a period, `history`, `saveVersion`, `setLine`, `removeLine`, `fillFromAverage`, `moveLeftover`/`undoMove`, `dismissAlert`/`restoreAlert` |
| `./dashboard` | `createDashboard(db)` → `get` for a week, period, year, or custom range (FR-D1/D2, FR-S7): KPIs + comparison, money flow, categories, trend, calendar, account flows, budget card |
| `./seed` | `seedLedger(db, userId, { getDek })`: the design persona (`DESIGN_SEED`, closed September + October, budget) through the repositories |
| `./maintenance`                                 | `createMaintenance(db)` → `purgeExpiredAuth(now)` (worker only, via `wf_maintenance_purge_auth`)       |
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

¹ `name, image, nickname, timezone, locale, base_currency, onboarding_completed_at, deletion_requested_at, updated_at`
(not `role`, `email`, `email_verified`, `two_factor_enabled`). ² Everything the setup wizard (FR-OP1) writes, including
`smtp_password_enc` and `instance_dek_wrapped`; the wizard runs as the admin it just created. ³ No `smtp_password_enc`,
no `instance_dek_wrapped`.

Database level: CONNECT for every role; CREATE on the database and on schema `public` for `wf_migrate` only.
`wf_readonly_ops` has `default_transaction_read_only = on` and `log_statement = 'all'`, and cannot log in unless
`DATABASE_URL_READONLY_OPS` gives it a password. `bootstrapRoles` sends SCRAM-SHA-256 verifiers, never plaintext
passwords. Any change to this matrix must update `src/migrate.test.ts` (it asserts the exact grants).

Functions: the SECURITY DEFINER functions are `wf_maintenance_purge_auth(timestamptz) → jsonb` and
`fx_currencies_in_use() → SETOF char(3)` (owner `wf_migrate`, `search_path = pg_catalog, public`, EXECUTE for
`wf_worker` only, not PUBLIC). The purge deletes expired `verifications` and `sessions` and `invitations` that expired
or were used more than 30 days ago, as of the given time capped at the server's `now()`, and returns the counts per
table. `wf_migrate` has SELECT and DELETE policies on those three tables that match only such dead rows, so even the
function cannot remove a live session. `fx_currencies_in_use` returns only the currency codes in use (accounts, base
currencies, manual rates) for the fx job; `wf_migrate` has SELECT policies on `accounts`, `users`, and `fx_rates` for it.

Ledger rows reference their parents with composite `(user_id, id)` foreign keys, so a row can never point at another
user's account, category, transaction, or tag (foreign-key checks bypass RLS). A trigger limits a transaction to five
tags. `pg_trgm` backs the merchant/description/goal-name search indexes.

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
