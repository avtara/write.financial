// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant isolation against a real PostgreSQL 18.6 (Testcontainers), with every role logging in with its own password:
 * bootstrap → migrate → two users → cross-tenant reads/writes, raw queries without a user context, append-only
 * security events, ciphertext at rest, and KEK rotation. The user-owned tables are discovered from the catalog
 * (foreign keys to `users`), so a new table is covered without touching this file.
 */
import { randomUUID } from 'node:crypto';
import { decryptText, encrypt } from '@wf/crypto/cipher';
import { generateDek, UnknownKeyVersionError, unwrapDek } from '@wf/crypto/envelope';
import { addKeyVersion, parseKeyring } from '@wf/crypto/keyring';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyFileText } from '../test/keys.ts';
import { createBudgets } from './budgets.ts';
import { createDb, firstRow, withUser, type Database } from './db.ts';
import { createFxRates } from './fx-rates.ts';
import { createInstanceSettings } from './instance-settings.ts';
import { createInvestments } from './investments.ts';
import { builtInCategoryIn, recordTransactionIn } from './ledger-core.ts';
import { migrate } from './migrate.ts';
import { createMarketCredentials } from './market-credentials.ts';
import { createMarketData } from './market-data.ts';
import { insertNotificationIn } from './notifications.ts';
import { materializeIn } from './occurrences.ts';
import { createPeriods } from './periods.ts';
import { createPreferences } from './preferences.ts';
import { insertReviewItemIn } from './review-items.ts';
import { bootstrapRoles, ROLES, type RoleName } from './roles.ts';
import { createSchedules } from './schedules.ts';
import {
  accounts,
  accountsAuth,
  attachments,
  autoRuleCorrections,
  autoRules,
  autoRuleSuggestionDismissals,
  balanceAdjustments,
  drafts,
  goals,
  goalSnapshots,
  passkeys,
  recentItems,
  reportFiles,
  reports,
  sessions,
  tagAliases,
  tags,
  twoFactors,
  users,
  verifications,
} from './schema.ts';
import { createSecurityEvents } from './security-events.ts';
import { createUserKeys, KeyRotationRoleError } from './user-keys.ts';

/** Tables without Row-Level Security: global catalog, read-only grants. */
const GLOBAL_TABLES = ['entitlements', 'plans'];
/** Tables with global rows (`user_id` null) every role may read; only their user rows are tenant data. */
const SHARED_ROWS: Record<string, string> = {
  fx_rates: 'user_id IS NOT NULL',
  // Built-in fetches (no user) are logged without a user; only the user's own requests are tenant data.
  market_api_logs: 'user_id IS NOT NULL',
};
const TODAY = '2026-10-15' as LocalDate;

const INSUFFICIENT_PRIVILEGE = '42501';
const READ_ONLY_TRANSACTION = '25006';

/** Built at runtime so no fixture looks like a committed secret. */
const password = (role: string) => `${role}-${Date.now().toString(36)}-pw`;
const PASSWORDS = {
  app: password('app'),
  worker: password('worker'),
  migrate: password('migrate'),
  auth: password('auth'),
  readonlyOps: password('ops'),
};
const SMTP_PASSWORD = password('smtp');

const v1Text = keyFileText();
const v1 = parseKeyring(v1Text);
const v2 = parseKeyring(addKeyVersion(v1Text));

type Dbs = Readonly<Record<'app' | 'worker' | 'auth' | 'migrate' | 'ops', Database>>;

let container: StartedPostgreSqlContainer;
let superuser: postgres.Sql;
let dbs: Dbs;
let alice: string;
let bob: string;
let owned: { table: string; column: string }[];

function urlAs(role: RoleName, rolePassword: string): string {
  const url = new URL(container.getConnectionUri());
  url.username = role;
  url.password = rolePassword;
  return url.href;
}

/** SQLSTATE of the Postgres error behind a (Drizzle) query error; `undefined` if the query succeeded. */
async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof postgres.PostgresError ? error.cause : error;
    return cause instanceof postgres.PostgresError ? cause.code : String(error);
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.6').start();
  superuser = postgres(container.getConnectionUri(), { max: 1, onnotice: () => undefined });

  await bootstrapRoles(container.getConnectionUri(), PASSWORDS);
  // Two instances starting at once: the advisory lock makes the second one a no-op.
  const migrateUrl = urlAs(ROLES.migrate, PASSWORDS.migrate);
  await Promise.all([migrate(migrateUrl), migrate(migrateUrl)]);

  dbs = {
    app: createDb(urlAs(ROLES.app, PASSWORDS.app)),
    worker: createDb(urlAs(ROLES.worker, PASSWORDS.worker)),
    auth: createDb(urlAs(ROLES.auth, PASSWORDS.auth)),
    migrate: createDb(migrateUrl),
    ops: createDb(urlAs(ROLES.readonlyOps, PASSWORDS.readonlyOps)),
  };

  // The auth module creates users and their Better Auth rows without a user context.
  const [a, b] = await dbs.auth
    .insert(users)
    .values([
      { name: 'Alice', email: 'alice@example.test', role: 'admin' },
      { name: 'Bob', email: 'bob@example.test' },
    ])
    .returning({ id: users.id });
  if (a === undefined || b === undefined) throw new Error('users were not created');
  alice = a.id;
  bob = b.id;
  const expiresAt = new Date(Date.now() + 86_400_000);
  for (const userId of [alice, bob]) {
    await dbs.auth.insert(sessions).values({ userId, token: `token-${userId}`, expiresAt });
    await dbs.auth.insert(accountsAuth).values({ userId, accountId: userId, providerId: 'credential' });
    await dbs.auth.insert(twoFactors).values({ userId, secret: 'enc-secret', backupCodes: 'hashed-codes' });
    await dbs.auth.insert(passkeys).values({
      userId,
      publicKey: 'pk',
      credentialID: `cred-${userId}`,
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    });
  }
  await dbs.auth.insert(verifications).values({ identifier: 'alice@example.test', value: 'v', expiresAt });

  // The app writes every user-owned table it can, each user in their own context.
  const keys = createUserKeys(dbs.app, v1);
  const events = createSecurityEvents(dbs.app);
  const preferences = createPreferences(dbs.app);
  for (const userId of [alice, bob]) {
    await keys.getOrCreateDek(userId);
    await events.append(userId, { type: 'sign_in', ipHash: null, userAgent: 'vitest' });
    await preferences.update(userId, { theme: 'light' });
    await superuser`INSERT INTO user_plans (user_id, plan_code) VALUES (${userId}, 'personal')`;
  }
  await withUser(dbs.app, alice, (tx) =>
    tx.execute(sql`INSERT INTO invitations (email, token_hash, expires_at, invited_by)
                   VALUES ('carol@example.test', ${'a'.repeat(64)}, now() + interval '7 days', ${alice})`),
  );
  await createInstanceSettings(dbs.app, v1).updateSetup(alice, {
    instanceName: 'Isolation',
    publicUrl: 'https://isolation.example.test/',
    defaultLocale: 'id',
    defaultTimezone: 'Asia/Jakarta',
    registrationMode: 'closed',
    smtp: {
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      username: 'u',
      from: 'a@example.test',
      password: SMTP_PASSWORD,
    },
  });

  // Ledger (M1): every ledger table gets rows of both users, written by the app in each user's context.
  const fx = createFxRates(dbs.app);
  await createFxRates(dbs.worker).upsertGlobal([
    { base: 'SGD', quote: 'IDR', rate: '12500', provider: 'frankfurter', rateType: 'bi_transaction', asOf: TODAY },
  ]);
  for (const userId of [alice, bob]) {
    await fx.upsertManual(userId, { base: 'USD', quote: 'IDR', rate: '16350.0275', asOf: TODAY });
    await withUser(dbs.app, userId, async (tx) => {
      const account = async (name: string, currency: string) =>
        firstRow(
          await tx
            .insert(accounts)
            .values({
              userId,
              type: 'bank',
              providerName: name,
              displayName: name,
              currency,
              openingBalanceMinor: 1_000_000n,
              openingDate: TODAY,
              color: 'blue',
            })
            .returning({ id: accounts.id }),
          'accounts',
        ).id;
      const bca = await account('BCA', 'IDR');
      const gotrade = await account('Gotrade', 'USD');
      const food = await builtInCategoryIn(tx, userId, 'system:food');
      const fee = await builtInCategoryIn(tx, userId, 'system:bank_fee');
      const occurredAt = new Date('2026-10-14T12:30:00Z');
      const { id: expenseId } = await recordTransactionIn(
        tx,
        userId,
        {
          type: 'expense',
          clientId: randomUUID(),
          occurredAt,
          accountId: bca,
          amountMinor: 85_000n,
          categoryId: food,
          tags: ['makan'],
        },
        null,
        occurredAt,
      );
      await recordTransactionIn(
        tx,
        userId,
        {
          type: 'transfer',
          clientId: randomUUID(),
          occurredAt,
          fromAccountId: bca,
          toAccountId: gotrade,
          sentMinor: 3_000_000n,
          receivedMinor: 18_210n,
          fee: { minor: 2_500n, categoryId: fee },
        },
        null,
        occurredAt,
      );
      const tag = firstRow(await tx.select({ id: tags.id }).from(tags), 'tags');
      await tx.insert(tagAliases).values({ userId, tagId: tag.id, slug: 'makan-siang' });
      await tx
        .insert(balanceAdjustments)
        .values({ userId, accountId: bca, amountMinor: -500n, actualBalanceMinor: 1n });
      await tx.insert(attachments).values({
        userId,
        transactionId: expenseId,
        bucket: 'wf',
        objectKey: `u/${userId}/${randomUUID()}`,
        mime: 'image/jpeg',
        size: 1024,
        sha256: 'a'.repeat(64),
        kind: 'receipt',
      });
      await tx.insert(drafts).values({ userId, kind: 'transaction', payloadEnc: Uint8Array.of(1, 2, 3) });
      await tx.insert(recentItems).values({ userId, kind: 'transaction', ref: expenseId });
      // FR-LP1: a stored report snapshot is tenant data (the worker writes it, the user reads it); its exported
      // file (M6.3) is too — the bytes live in the object store, the meta row here.
      const [storedReport] = await tx
        .insert(reports)
        .values({
          userId,
          kind: 'custom',
          status: 'provisional',
          label: '2026-10-01/2026-10-15',
          rangeStart: '2026-10-01' as LocalDate,
          rangeEnd: '2026-10-15' as LocalDate,
          txCount: 1,
          incomeMinor: 0n,
          expenseMinor: 1n,
          savedMinor: -1n,
          sections: {},
        })
        .returning({ id: reports.id });
      if (storedReport === undefined) throw new Error('the seeded report row is missing');
      await tx.insert(reportFiles).values({
        userId,
        reportId: storedReport.id,
        format: 'csv',
        options: { sections: ['summary'], theme: 'light', paper: 'a4', maskAccountNumbers: false },
        fileKey: `u/${userId}/00000000-0000-7000-8000-00000000000a`,
        sizeBytes: 3,
      });
      await tx
        .insert(goalSnapshots)
        .values({ userId, snapshotDate: TODAY, recordedAt: new Date('2026-10-15T10:00:00Z'), goals: [] });
      // Auto rules (M7.1): a rule, the manual-correction evidence behind a suggestion, and its dismissal.
      await tx.insert(autoRules).values({
        userId,
        name: 'Kopi',
        position: 0,
        conditions: [{ field: 'description', op: 'containsAny', values: ['kopi'] }],
        actions: [{ type: 'setCategory', categoryId: food }],
      });
      await tx.insert(autoRuleCorrections).values({
        userId,
        transactionId: expenseId,
        pattern: 'kopi kenangan',
        label: 'Kopi Kenangan',
        fromCategoryId: fee,
        toCategoryId: food,
      });
      await tx.insert(autoRuleSuggestionDismissals).values({ userId, key: `dismissed-${userId}` });
      await tx.insert(goals).values({
        userId,
        name: 'Dana Darurat',
        icon: 'shield',
        color: 'green',
        targetMinor: 54_000_000n,
        currency: 'IDR',
      });
    });
    // Periods and budgets (M2): September (closed) and October, a budget, a moved leftover, a dismissed warning.
    const at = (iso: string) => ({ now: () => new Date(iso) });
    await withUser(dbs.app, userId, (tx) =>
      tx.execute(sql`INSERT INTO periods (user_id, label, start_date, end_date, days)
                     VALUES (${userId}, '2026-09', '2026-09-01', '2026-09-30', 30)`),
    );
    const [september] = await withUser(dbs.app, userId, (tx) =>
      tx.execute<{ id: string }>(sql`SELECT id FROM periods WHERE start_date = '2026-09-01'`),
    );
    await createPeriods(dbs.worker, at('2026-10-01T00:05:00+07:00')).lock(userId, september?.id as string);
    const budgets = createBudgets(dbs.app, at('2026-10-15T09:00:00Z'));
    const { current } = await createPeriods(dbs.app, at('2026-10-15T09:00:00Z')).list(userId);
    const [food, fee] = await withUser(dbs.app, userId, async (tx) => [
      await builtInCategoryIn(tx, userId, 'system:food'),
      await builtInCategoryIn(tx, userId, 'system:bank_fee'),
    ]);
    await budgets.saveVersion(userId, {
      effectiveFrom: '2026-10' as YearMonth,
      lines: [
        { categoryId: food, limitMinor: 3_500_000n },
        { categoryId: fee, limitMinor: 100_000n },
      ],
    });
    await budgets.moveLeftover(userId, current.id as string, {
      targetCategoryId: food,
      sources: [{ categoryId: fee, amountMinor: 50_000n }],
    });
    await budgets.dismissAlert(userId, current.id as string, food);
    // Review queue and notifications (M3): produced by the worker (D14), as the daily jobs do.
    await withUser(dbs.worker, userId, async (tx) => {
      await insertReviewItemIn(tx, userId, generateDek(), {
        reason: 'period_close_proposal',
        source: 'period_close',
        dedupeKey: `close.${september?.id as string}.leftover`,
        periodId: september?.id as string,
        payload: {
          kind: 'leftover',
          periodId: september?.id as string,
          amountMinor: 1_150_000n,
          goalId: null,
          fromAccountId: null,
          toAccountId: null,
        },
      });
      const { id: notificationId } = await insertNotificationIn(tx, userId, {
        type: 'period_closed',
        category: 'system',
        titleKey: 'notification_period_closed_title',
        bodyKey: 'notification_period_closed_body',
        params: { label: '2026-09' },
        ref: `close.${september?.id as string}`,
      });
      await tx.execute(sql`INSERT INTO notification_outbox (user_id, notification_id, payload)
                           VALUES (${userId}, ${notificationId}, '{}'::jsonb)`);
    });
    // Schedules and subscriptions (M3): the app creates them and materializes their occurrences; the worker records
    // a detected subscription candidate (FR-SUB4).
    const schedules = createSchedules(dbs.app, at('2026-10-15T03:00:00Z'));
    const [bca] = await withUser(dbs.app, userId, (tx) =>
      tx.execute<{ id: string }>(sql`SELECT id FROM accounts WHERE provider_name = 'BCA'`),
    );
    const bcaId = bca?.id as string;
    await schedules.createRecurrence(userId, {
      template: { type: 'expense', accountId: bcaId, amountMinor: 3_500_000n, categoryId: food },
      freq: 'monthly',
      startOn: '2026-11-01' as LocalDate,
      end: { type: 'never' },
      remindOffsetDays: 1,
    });
    await schedules.createSubscription(userId, {
      name: 'Netflix',
      priceMinor: 186_000n,
      currency: 'IDR',
      cycle: 'monthly',
      nextBillingDate: '2026-10-18' as LocalDate,
      payFromAccountId: bcaId,
      categoryId: food,
      startedOn: '2024-01-18' as LocalDate,
    });
    await withUser(dbs.worker, userId, (tx) =>
      tx.execute(sql`INSERT INTO detected_recurring
                       (user_id, merchant_key, merchant, day_of_month, amount_minor, currency, occurrences, last_seen_on, account_id)
                     VALUES (${userId}, 'spotify', 'Spotify', 20, 86900, 'IDR', 3, '2026-09-20', ${bcaId})`),
    );
    // Goals, debts, card payments, receivables (M4): user actions through wf_app, rows of every new table.
    await withUser(dbs.app, userId, async (tx) => {
      const [goal] = await tx.execute<{ id: string }>(sql`SELECT id FROM goals`);
      const [recurrence] = await tx.execute<{ id: string }>(sql`SELECT id FROM recurrences`);
      const [transfer] = await tx.execute<{ id: string }>(sql`SELECT id FROM transactions WHERE type = 'transfer'`);
      const goalId = goal?.id as string;
      await tx.execute(sql`INSERT INTO goal_funding_sources (user_id, goal_id, account_id, mode, amount_minor)
                           VALUES (${userId}, ${goalId}, ${bcaId}, 'fixed', 500000)`);
      await tx.execute(sql`INSERT INTO goal_contribution_plans (user_id, goal_id, recurrence_id, amount_minor, start_month)
                           VALUES (${userId}, ${goalId}, ${recurrence?.id as string}, 500000, '2026-10-01')`);
      const [debt] = await tx.execute<{ id: string }>(sql`INSERT INTO debts
          (user_id, kind, name, pay_from_account_id, principal_minor, currency, tenor_months, first_due_date)
        VALUES (${userId}, 'paylater', 'MacBook Air M4', ${bcaId}, 18999000, 'IDR', 12, '2026-11-25') RETURNING id`);
      await tx.execute(sql`INSERT INTO debt_installments (user_id, debt_id, seq, due_date, principal_minor)
                           VALUES (${userId}, ${debt?.id as string}, 1, '2026-11-25', 1583250)`);
      await tx.execute(sql`INSERT INTO card_payment_allocations (user_id, transaction_id, bucket, amount_minor)
                           VALUES (${userId}, ${transfer?.id as string}, 'spending', 1000000)`);
      const [receivable] = await tx.execute<{ id: string }>(sql`INSERT INTO receivables
          (user_id, counterparty_enc, principal_minor, currency, from_account_id, source, lent_on)
        VALUES (${userId}, decode('010203', 'hex'), 400000, 'IDR', ${bcaId}, 'loan', '2026-10-02') RETURNING id`);
      await tx.execute(sql`INSERT INTO receivable_payments (user_id, receivable_id, account_id, amount_minor, received_on)
                           VALUES (${userId}, ${receivable?.id as string}, ${bcaId}, 100000, '2026-10-10')`);
    });
  }

  // Investments and market data (M5): every new table gets rows of both users. Saving a market key needs 2FA, which
  // only the auth module turns on.
  await dbs.auth.update(users).set({ twoFactorEnabled: true });
  const dek = generateDek();
  const credentials = createMarketCredentials(dbs.app, { getDek: () => Promise.resolve(dek) });
  const at15 = { now: () => new Date('2026-10-15T09:00:00Z') };
  const investments = createInvestments(dbs.app, at15);
  for (const userId of [alice, bob]) {
    const [platform] = await withUser(dbs.app, userId, (tx) =>
      tx.execute<{ id: string }>(sql`INSERT INTO accounts
          (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color, include_in_available)
        VALUES (${userId}, 'investment', 'Gotrade', 'Gotrade USD', 'USD', 100000, ${TODAY}, 'cyan', false) RETURNING id`),
    );
    const category = await investments.createCategory(userId, { name: 'Inti', assetClass: 'us_stocks' });
    const spy = await investments.createAsset(userId, {
      accountId: platform?.id as string,
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF',
      assetClass: 'us_stocks',
      market: 'us_equity',
      categoryId: category.id,
      priceMode: 'byok',
    });
    await investments.recordTrade(userId, {
      kind: 'buy',
      clientId: randomUUID(),
      assetId: spy.id,
      occurredAt: new Date('2026-10-14T12:30:00Z'),
      units: '0.1',
      amountMinor: 6_900n,
    });
    await investments.setTargets(userId, { us_stocks: 10_000 });
    await investments.recordSnapshot(userId, {
      date: TODAY,
      valueBaseMinor: 1_128_000n,
      costBaseMinor: 1_128_000n,
      contributionsBaseMinor: 0n,
    });
    await withUser(dbs.app, userId, (tx) =>
      tx.execute(sql`INSERT INTO goal_funding_sources (user_id, goal_id, asset_id, mode, pct_bps)
                     SELECT ${userId}, id, ${spy.id}, 'percent', 6000 FROM goals`),
    );
    await credentials.save(userId, { provider: 'tiingo', apiKey: `tiingo-key-of-${userId.slice(-6)}` });
    await createMarketData(dbs.worker).logRequest(userId, {
      provider: 'tiingo',
      endpoint: 'https://api.tiingo.com/iex/?tickers=spy&token=***',
      httpStatus: 200,
      ok: true,
      durationMs: 120,
      at: new Date('2026-10-15T09:00:00Z'),
    });
  }
  // Only Alice's key has fetched yet: her result, for her alone.
  await createMarketData(dbs.worker).recordUserQuotes(
    alice,
    [
      {
        provider: 'tiingo',
        symbol: 'SPY',
        quoteCurrency: 'USD',
        bucketTs: new Date('2026-10-15T08:45:00Z'),
        price: '690.10',
        prevClose: '686.20',
      },
    ],
    new Date('2026-10-15T08:46:00Z'),
  );
  await createMarketData(dbs.worker).recordUserQuotes(
    bob,
    [
      {
        provider: 'tiingo',
        symbol: 'QQQ',
        quoteCurrency: 'USD',
        bucketTs: new Date('2026-10-15T08:45:00Z'),
        price: '605.30',
        prevClose: null,
      },
    ],
    new Date('2026-10-15T08:46:00Z'),
  );

  owned = [
    { table: 'users', column: 'id' },
    ...(await superuser<{ table: string; column: string }[]>`
      SELECT c.conrelid::regclass::text AS table, a.attname AS column
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
      ORDER BY 1`),
  ];
});

afterAll(async () => {
  await Promise.all(Object.values(dbs).map((db) => db.$client.end()));
  await superuser.end();
  await container.stop();
});

describe('roles', () => {
  it('logs every role in with its own password, none superuser or BYPASSRLS', async () => {
    const rows = await superuser<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'wf\\_%' ORDER BY rolname`;
    expect(rows.map((row) => row.rolname)).toEqual(Object.values(ROLES).toSorted());
    expect(rows.every((row) => !row.rolsuper && !row.rolbypassrls)).toBe(true);
    for (const db of Object.values(dbs)) expect(await db.execute(sql`select 1 as ok`)).toEqual([{ ok: 1 }]);
  });

  it('configures pool sessions with a statement timeout', async () => {
    expect(await dbs.app.execute(sql`show statement_timeout`)).toEqual([{ statement_timeout: '30s' }]);
  });
});

describe('Row-Level Security', () => {
  it('protects every user-owned table (found via foreign keys to users) and every non-global table', async () => {
    expect(owned.map((o) => o.table)).toEqual(
      expect.arrayContaining(['users', 'sessions', 'user_keys', 'security_events', 'user_preferences']) as string[],
    );
    const unprotected = await superuser<{ name: string }[]>`
      SELECT relname AS name FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT (relrowsecurity AND relforcerowsecurity)
      ORDER BY relname`;
    expect(unprotected.map((row) => row.name)).toEqual(GLOBAL_TABLES);
  });

  it('has rows of both users in every user-owned table, so the checks below are not vacuous', async () => {
    for (const { table, column } of owned) {
      const [row] = await superuser<{ n: number }[]>`
        SELECT count(DISTINCT ${superuser(column)})::int AS n FROM ${superuser(table)}`;
      // Only admins invite: Alice's invitation is the one row there.
      expect({ table, owners: row?.n }).toEqual({ table, owners: table === 'invitations' ? 1 : 2 });
    }
  });

  it.each([
    [ROLES.app, PASSWORDS.app],
    [ROLES.worker, PASSWORDS.worker],
  ])('a raw query as %s without app.user_id returns no rows from any user-owned table', async (role, rolePassword) => {
    const raw = postgres(urlAs(role, rolePassword), { max: 1 });
    try {
      for (const { table } of owned) {
        const [privilege] = await raw<{ allowed: boolean }[]>`
          SELECT has_table_privilege(current_user, ${table}, 'SELECT') AS allowed`;
        const query = raw`SELECT * FROM ${raw(table)} WHERE ${raw.unsafe(SHARED_ROWS[table] ?? 'true')}`;
        if (privilege?.allowed) expect({ table, rows: (await query).length }).toEqual({ table, rows: 0 });
        else expect({ table, code: await pgErrorCode(query) }).toEqual({ table, code: INSUFFICIENT_PRIVILEGE });
      }
    } finally {
      await raw.end();
    }
  });

  it('user B can neither read, update, nor delete user A’s rows through withUser', async () => {
    for (const { table, column } of owned) {
      const t = sql.identifier(table);
      const owner = sql`${t}.${sql.identifier(column)} = ${alice}`;
      const privileges = firstRow(
        await superuser<{ select: boolean; delete: boolean; update_column: string | null }[]>`
          SELECT has_table_privilege('wf_app', ${table}, 'SELECT') AS select,
                 has_table_privilege('wf_app', ${table}, 'DELETE') AS delete,
                 (SELECT attname FROM pg_attribute
                  WHERE attrelid = ${table}::regclass AND attnum > 0 AND NOT attisdropped
                    AND has_column_privilege('wf_app', ${table}, attname, 'UPDATE')
                  ORDER BY attnum LIMIT 1) AS update_column`,
        table,
      );

      const read = withUser(dbs.app, bob, (tx) => tx.execute(sql`SELECT 1 FROM ${t} WHERE ${owner}`));
      if (privileges.select) expect({ table, rows: (await read).length }).toEqual({ table, rows: 0 });
      else expect({ table, code: await pgErrorCode(read) }).toEqual({ table, code: INSUFFICIENT_PRIVILEGE });

      // Update a column wf_app may update, so a 0 comes from RLS rather than from a missing privilege.
      const target = sql.identifier(privileges.update_column ?? column);
      const update = withUser(dbs.app, bob, (tx) =>
        tx.execute(sql`UPDATE ${t} SET ${target} = ${target} WHERE ${owner}`),
      );
      if (privileges.update_column !== null)
        expect({ table, updated: (await update).count }).toEqual({ table, updated: 0 });
      else expect({ table, code: await pgErrorCode(update) }).toEqual({ table, code: INSUFFICIENT_PRIVILEGE });

      const remove = withUser(dbs.app, bob, (tx) => tx.execute(sql`DELETE FROM ${t} WHERE ${owner}`));
      if (privileges.delete) expect({ table, deleted: (await remove).count }).toEqual({ table, deleted: 0 });
      else expect({ table, code: await pgErrorCode(remove) }).toEqual({ table, code: INSUFFICIENT_PRIVILEGE });

      // Positive control: wherever wf_app may read, the owner does see the row.
      if (privileges.select) {
        const own = await withUser(dbs.app, alice, (tx) => tx.execute(sql`SELECT 1 FROM ${t} WHERE ${owner}`));
        expect({ table, visible: own.length > 0 }).toEqual({ table, visible: true });
      }
    }
  });

  it('does not leak app.user_id to the next use of a pooled connection', async () => {
    const app = createDb(urlAs(ROLES.app, PASSWORDS.app), { max: 1 });
    try {
      await withUser(app, alice, (tx) => tx.execute(sql`SELECT 1`));
      expect(await app.execute(sql`SELECT count(*)::int AS n FROM user_preferences`)).toEqual([{ n: 0 }]);
    } finally {
      await app.$client.end();
    }
  });

  it('keeps sessions and 2FA secrets away from wf_app and wf_worker, even with a user context', async () => {
    for (const db of [dbs.app, dbs.worker]) {
      for (const table of ['sessions', 'two_factors', 'accounts_auth', 'passkeys', 'verifications']) {
        const read = withUser(db, alice, (tx) => tx.execute(sql`SELECT * FROM ${sql.identifier(table)}`));
        expect({ table, code: await pgErrorCode(read) }).toEqual({ table, code: INSUFFICIENT_PRIVILEGE });
      }
    }
  });

  it('lets wf_auth find sessions without a user context', async () => {
    expect(await dbs.auth.execute(sql`SELECT count(*)::int AS n FROM sessions`)).toEqual([{ n: 2 }]);
  });

  it('gives operators read-only access without secrets', async () => {
    expect(await dbs.ops.execute(sql`SELECT count(*)::int AS n FROM security_events`)).toEqual([{ n: 2 }]);
    expect(await pgErrorCode(dbs.ops.execute(sql`SELECT smtp_password_enc FROM instance_settings`))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await pgErrorCode(dbs.ops.execute(sql`SELECT * FROM user_keys`))).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await pgErrorCode(dbs.ops.execute(sql`CREATE TEMP TABLE t (x int)`))).toBe(READ_ONLY_TRANSACTION);
  });
});

describe('security_events', () => {
  it('rejects UPDATE and DELETE for the app (no privilege) and the superuser (trigger)', async () => {
    for (const statement of [sql`UPDATE security_events SET user_agent = 'x'`, sql`DELETE FROM security_events`]) {
      expect(await pgErrorCode(withUser(dbs.app, alice, (tx) => tx.execute(statement)))).toBe(INSUFFICIENT_PRIVILEGE);
    }
    for (const statement of ['UPDATE security_events SET user_agent = NULL', 'DELETE FROM security_events']) {
      await expect(superuser.unsafe(statement)).rejects.toThrow(/security_events is append-only/);
    }
  });
});

describe('encryption at rest', () => {
  it('a dump of user_keys and instance_settings contains neither the SMTP password nor the KEK', async () => {
    const lines = await superuser<{ line: string }[]>`
      SELECT row_to_json(k)::text AS line FROM user_keys k
      UNION ALL SELECT row_to_json(s)::text FROM instance_settings s`;
    const dump = lines.map((row) => row.line).join('\n');
    expect(dump).toContain('dek_wrapped');
    expect(dump).toContain('smtp_password_enc');
    expect(dump).not.toContain(SMTP_PASSWORD);
    expect(dump).not.toContain(Buffer.from(SMTP_PASSWORD).toString('hex'));
    const kek = Buffer.from(v1Text.trim().slice('v1:'.length), 'base64');
    expect(dump).not.toContain(kek.toString('hex'));
    expect(dump).not.toContain(kek.toString('base64'));
  });

  it('wrapped DEKs are useless without the KEK', async () => {
    const { dek_wrapped: wrapped } = firstRow(
      await superuser<{ dek_wrapped: Uint8Array }[]>`SELECT dek_wrapped FROM user_keys WHERE user_id = ${alice}`,
      'user_keys',
    );
    expect(() => unwrapDek(wrapped, parseKeyring(keyFileText()), alice)).toThrow();
    expect(() => unwrapDek(wrapped, v1, bob)).toThrow();
    expect(() => unwrapDek(wrapped, v1, alice)).not.toThrow();
  });
});

describe('userKeys', () => {
  it('creates exactly one DEK under concurrent first use', async () => {
    const { id: carol } = firstRow(
      await dbs.auth.insert(users).values({ name: 'Carol', email: 'carol@example.test' }).returning({ id: users.id }),
      'users',
    );
    const keys = createUserKeys(dbs.app, v1);
    const [first, ...rest] = await Promise.all(Array.from({ length: 8 }, () => keys.getOrCreateDek(carol)));
    const aad = { userId: carol, purpose: 'race' };
    if (first === undefined) throw new Error('no DEK');
    const ciphertext = encrypt(first, 'same key', aad);
    for (const dek of rest) expect(decryptText(dek, ciphertext, aad)).toBe('same key');
    expect(await superuser`SELECT 1 FROM user_keys WHERE user_id = ${carol}`).toHaveLength(1);
  });

  it('KEK rotation re-wraps every DEK and keeps the data readable', async () => {
    const before = createUserKeys(dbs.app, v1);
    const notes = await Promise.all(
      [alice, bob].map(async (userId) => ({
        userId,
        ciphertext: encrypt(await before.getOrCreateDek(userId), `note of ${userId}`, { userId, purpose: 'n' }),
      })),
    );

    await expect(createUserKeys(dbs.app, v2).rewrapAll()).rejects.toThrow(new KeyRotationRoleError('wf_app'));
    // Alice, Bob, Carol (previous test) and the instance DEK of the SMTP password.
    expect(await createUserKeys(dbs.migrate, v2).rewrapAll()).toEqual({ users: 3, instance: true });
    expect(await superuser`SELECT DISTINCT kek_version FROM user_keys`).toEqual([{ kek_version: 2 }]);

    const after = createUserKeys(dbs.app, v2);
    for (const { userId, ciphertext } of notes) {
      const dek = await after.getOrCreateDek(userId);
      expect(decryptText(dek, ciphertext, { userId, purpose: 'n' })).toBe(`note of ${userId}`);
    }
    expect(await createInstanceSettings(dbs.worker, v2).smtpPassword()).toBe(SMTP_PASSWORD);
    // A keyring without v2 cannot open the re-wrapped keys.
    await expect(createUserKeys(dbs.app, v1).getOrCreateDek(alice)).rejects.toBeInstanceOf(UnknownKeyVersionError);
  });
});

describe('ledger roles', () => {
  it('lets the worker read but never write transactions or postings (D14)', async () => {
    const [row] = await withUser(dbs.worker, alice, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM postings`));
    // An expense (1), a cross-currency transfer with a fee (2 + fee + fx_diff), and a buy's cash leg (1, M5).
    expect(row).toEqual({ n: 6 });
    for (const statement of [
      sql`INSERT INTO transactions (user_id, type, occurred_at, local_date, client_id, confirmed_by_user_at)
          VALUES (${alice}, 'expense', now(), current_date, ${randomUUID()}, now())`,
      sql`UPDATE transactions SET deleted_at = now()`,
      sql`UPDATE postings SET amount_minor = 0`,
      sql`DELETE FROM postings`,
    ]) {
      expect(await pgErrorCode(withUser(dbs.worker, alice, (tx) => tx.execute(statement)))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it('lets the worker lock periods but never write budgets (D14, `periods.lock`)', async () => {
    const [row] = await withUser(dbs.worker, alice, (tx) =>
      tx.execute(sql`SELECT count(*)::int AS n FROM periods WHERE status = 'closed'`),
    );
    expect(row).toEqual({ n: 1 });
    for (const statement of [
      sql`INSERT INTO budget_versions (user_id, effective_from) VALUES (${alice}, '2027-01')`,
      sql`UPDATE budget_lines SET limit_minor = 0`,
      sql`DELETE FROM budget_period_overrides`,
      sql`DELETE FROM budget_alert_dismissals`,
      sql`UPDATE periods SET end_date = end_date`,
      sql`DELETE FROM periods`,
    ]) {
      expect(await pgErrorCode(withUser(dbs.worker, alice, (tx) => tx.execute(statement)))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it('lets the worker propose review items and notify, but never resolve or delete (D14)', async () => {
    const [row] = await withUser(dbs.worker, alice, (tx) =>
      tx.execute(sql`SELECT (SELECT count(*) FROM review_items)::int AS items,
                            (SELECT count(*) FROM notifications)::int AS notifications,
                            (SELECT count(*) FROM notification_outbox)::int AS outbox`),
    );
    expect(row).toEqual({ items: 1, notifications: 1, outbox: 1 });
    for (const statement of [
      sql`UPDATE review_items SET status = 'ignored', resolved_at = now()`,
      sql`DELETE FROM review_items`,
      sql`UPDATE notifications SET read_at = now()`,
      sql`DELETE FROM notifications`,
      sql`DELETE FROM notification_outbox`,
    ]) {
      expect(await pgErrorCode(withUser(dbs.worker, alice, (tx) => tx.execute(statement)))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
    for (const statement of [
      sql`INSERT INTO notifications (user_id, type, category, title_key, body_key, ref)
          VALUES (${alice}, 'system', 'system', 't', 'b', ${randomUUID()})`,
      sql`SELECT * FROM notification_outbox`,
      sql`UPDATE notifications SET params = '{}'::jsonb`,
    ]) {
      expect(await pgErrorCode(withUser(dbs.app, alice, (tx) => tx.execute(statement)))).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('lets the worker materialize occurrences but never change schedules or delete occurrences (D14)', async () => {
    const { created } = await withUser(dbs.worker, alice, (tx) =>
      materializeIn(tx, alice, { now: new Date('2026-10-15T03:00:00Z') }),
    );
    // The paylater installment inserted with raw SQL (25 Nov) had no occurrence yet (FR-U6).
    expect(created).toBe(1);
    const [row] = await withUser(dbs.worker, alice, (tx) =>
      tx.execute(sql`SELECT count(*)::int AS n FROM scheduled_occurrences`),
    );
    // Netflix 18 Okt, 18 Nov, 18 Des, the recurrence on 1 Nov, 1 Des, 1 Jan, and the installment on 25 Nov.
    expect(row).toEqual({ n: 7 });
    for (const statement of [
      sql`UPDATE recurrences SET status = 'stopped', stopped_at = now()`,
      sql`DELETE FROM recurrences`,
      sql`UPDATE subscriptions SET price_minor = 1`,
      sql`DELETE FROM subscriptions`,
      sql`UPDATE scheduled_occurrences SET transaction_id = null`,
      sql`DELETE FROM scheduled_occurrences`,
      sql`DELETE FROM detected_recurring`,
    ]) {
      expect(await pgErrorCode(withUser(dbs.worker, alice, (tx) => tx.execute(statement)))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it('lets the worker read goals, debts, card payments, and receivables but never write them (D14)', async () => {
    const [row] = await withUser(dbs.worker, alice, (tx) =>
      tx.execute(sql`SELECT (SELECT count(*) FROM goal_funding_sources)::int AS sources,
                            (SELECT count(*) FROM goal_contribution_plans)::int AS plans,
                            (SELECT count(*) FROM debt_installments)::int AS installments,
                            (SELECT count(*) FROM card_payment_allocations)::int AS allocations,
                            (SELECT count(*) FROM receivable_payments)::int AS payments`),
    );
    // An account source (M4) and an asset source (M5).
    expect(row).toEqual({ sources: 2, plans: 1, installments: 1, allocations: 1, payments: 1 });
    for (const statement of [
      sql`UPDATE goals SET status = 'completed', completed_at = now()`,
      sql`UPDATE goal_funding_sources SET amount_minor = 1`,
      sql`DELETE FROM goal_contribution_plans`,
      sql`UPDATE debts SET status = 'paid_off', paid_off_at = now()`,
      sql`UPDATE debt_installments SET status = 'paid', paid_at = now()`,
      sql`DELETE FROM card_payment_allocations`,
      sql`UPDATE receivables SET status = 'settled', settled_at = now()`,
      sql`INSERT INTO receivable_payments (user_id, receivable_id, account_id, amount_minor, received_on)
          SELECT user_id, receivable_id, account_id, 1, received_on FROM receivable_payments`,
    ]) {
      expect(await pgErrorCode(withUser(dbs.worker, alice, (tx) => tx.execute(statement)))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it('never lets receivable payments exceed the principal, even with raw SQL (FR-U7)', async () => {
    const repay = (amountMinor: bigint) =>
      withUser(dbs.app, alice, (tx) =>
        tx.execute(sql`INSERT INTO receivable_payments (user_id, receivable_id, account_id, amount_minor, received_on)
                       SELECT user_id, receivable_id, account_id, ${amountMinor}, received_on FROM receivable_payments`),
      );
    // 400.000 lent, 100.000 back: 300.001 more is one rupiah too many, as is lowering the principal below 100.000.
    expect(await pgErrorCode(repay(300_001n))).toBe('23514');
    expect(
      await pgErrorCode(
        withUser(dbs.app, alice, (tx) => tx.execute(sql`UPDATE receivables SET principal_minor = 99999`)),
      ),
    ).toBe('23514');
    expect(await pgErrorCode(repay(300_000n))).toBeUndefined();
    await withUser(dbs.app, alice, (tx) =>
      tx.execute(sql`DELETE FROM receivable_payments WHERE amount_minor = 300000`),
    );
  });

  it('refuses transaction writes dated inside a closed period (FR-P3)', async () => {
    const { id: account } = firstRow(
      await superuser<{ id: string }[]>`SELECT id FROM accounts WHERE user_id = ${alice} AND currency = 'IDR' LIMIT 1`,
      'accounts',
    );
    const occurredAt = new Date('2026-09-20T05:00:00Z');
    const draft = {
      type: 'expense',
      clientId: randomUUID(),
      occurredAt,
      accountId: account,
      amountMinor: 1_000n,
      categoryId: null,
    } as const;
    await expect(
      withUser(dbs.app, alice, (tx) => recordTransactionIn(tx, alice, draft, null, occurredAt)),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
  });

  it('gives the worker the currencies in use across users, and only the worker', async () => {
    expect(await createFxRates(dbs.worker).currenciesInUse()).toEqual(['IDR', 'USD']);
    expect(await pgErrorCode(createFxRates(dbs.app).currenciesInUse())).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('shares built-in rates with everyone and keeps manual rates per user', async () => {
    const fx = createFxRates(dbs.app);
    expect(await fx.referenceRate(bob, 'SGD', 'IDR')).toMatchObject({ rate: '12500', manual: false });
    await fx.upsertManual(alice, { base: 'SGD', quote: 'IDR', rate: '12600', asOf: TODAY });
    expect(await fx.referenceRate(alice, 'SGD', 'IDR')).toMatchObject({ rate: '12600', manual: true });
    expect(await fx.referenceRate(bob, 'SGD', 'IDR')).toMatchObject({ rate: '12500', manual: false });
    const updated = await withUser(dbs.app, alice, (tx) =>
      tx.execute(sql`UPDATE fx_rates SET rate = 1 WHERE user_id IS NULL`),
    );
    expect(updated.count).toBe(0);
    expect(await createFxRates(dbs.worker).latestGlobal('SGD', 'IDR')).toMatchObject({ rate: '12500' });
  });

  it('cannot point a row at another user’s account, even with raw SQL (composite foreign keys)', async () => {
    const { id: accountOfAlice } = firstRow(
      await superuser<{ id: string }[]>`SELECT id FROM accounts WHERE user_id = ${alice} LIMIT 1`,
      'accounts',
    );
    const occurredAt = new Date();
    const draft = {
      type: 'expense',
      clientId: randomUUID(),
      occurredAt,
      accountId: accountOfAlice,
      amountMinor: 1n,
      categoryId: null,
    } as const;
    await expect(
      withUser(dbs.app, bob, (tx) => recordTransactionIn(tx, bob, draft, null, occurredAt)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const raw = withUser(dbs.app, bob, async (tx) => {
      const [created] = await tx.execute<{ id: string }>(
        sql`INSERT INTO transactions (user_id, type, occurred_at, local_date, client_id, confirmed_by_user_at)
            VALUES (${bob}, 'expense', now(), current_date, ${randomUUID()}, now()) RETURNING id`,
      );
      await tx.execute(
        sql`INSERT INTO postings (user_id, transaction_id, account_id, amount_minor, currency, amount_base_minor)
            VALUES (${bob}, ${created?.id}, ${accountOfAlice}, -1, 'IDR', -1)`,
      );
    });
    expect(await pgErrorCode(raw)).toBe('23503');
  });
});

describe('investments and market data (M5)', () => {
  const now = () => new Date('2026-10-15T09:00:00Z');

  it('never prices user B’s assets with user A’s BYOK results, nor shows them to B in any way', async () => {
    const quotes = createMarketData(dbs.app, { now });
    const spyOf = async (userId: string) =>
      firstRow(
        await withUser(dbs.app, userId, (tx) =>
          tx.execute<{ id: string }>(sql`SELECT id FROM assets WHERE symbol = 'SPY'`),
        ),
        'assets',
      ).id;
    // Both have a Tiingo key and SPY; only Alice's key fetched SPY.
    expect((await quotes.quotes(alice)).get(await spyOf(alice))).toMatchObject({
      source: 'byok',
      provider: 'tiingo',
      price: '690.1',
    });
    expect((await quotes.quotes(bob)).get(await spyOf(bob))).toBeNull();
    const bobsView = await withUser(dbs.app, bob, (tx) =>
      tx.execute<{ symbol: string }>(sql`SELECT symbol FROM user_quotes ORDER BY symbol`),
    );
    expect(bobsView.map((row) => row.symbol)).toEqual(['QQQ']);
    // The worker, in Bob's job, cannot see Alice's results either; without a user context nobody sees any.
    const workerView = await withUser(dbs.worker, bob, (tx) =>
      tx.execute(sql`SELECT 1 FROM user_quotes WHERE symbol = 'SPY'`),
    );
    expect(workerView).toHaveLength(0);
    // The shared cache holds built-in sources only and is readable only through its view.
    expect(await pgErrorCode(withUser(dbs.app, bob, (tx) => tx.execute(sql`SELECT * FROM market_quotes`)))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await withUser(dbs.app, bob, (tx) => tx.execute(sql`SELECT * FROM market_quotes_latest`))).toEqual([]);
    // Bob cannot write a quote for Alice, nor read her key's ciphertext or last 4.
    expect(
      await pgErrorCode(
        withUser(dbs.worker, bob, (tx) =>
          tx.execute(sql`INSERT INTO user_quotes (user_id, provider, symbol, quote_currency, bucket_ts, price)
                         VALUES (${alice}, 'tiingo', 'SPY', 'USD', now(), 1)`),
        ),
      ),
    ).toBe('42501');
    expect(
      await withUser(dbs.app, bob, (tx) => tx.execute(sql`SELECT 1 FROM market_credentials WHERE user_id = ${alice}`)),
    ).toHaveLength(0);
  });

  it('deleting a key deletes that provider’s results of that user only (FR-ST4)', async () => {
    const dek = generateDek();
    const credentials = createMarketCredentials(dbs.app, { getDek: () => Promise.resolve(dek), now });
    await createMarketData(dbs.worker).recordUserQuotes(
      alice,
      [
        {
          provider: 'tiingo',
          symbol: 'QQQ',
          quoteCurrency: 'USD',
          bucketTs: new Date('2026-10-15T08:45:00Z'),
          price: '605',
          prevClose: null,
        },
      ],
      now(),
    );
    expect(await credentials.remove(alice, 'tiingo')).toEqual({ quotesDeleted: 2 });
    const left = await superuser<
      { user_id: string; symbol: string }[]
    >`SELECT user_id, symbol FROM user_quotes ORDER BY symbol`;
    expect(left).toEqual([{ user_id: bob, symbol: 'QQQ' }]);
    expect(await credentials.list(alice)).toEqual([]);
    expect((await credentials.list(bob)).map((key) => key.provider)).toEqual(['tiingo']);
  });

  it('refuses to store a market key without active 2FA, even with raw SQL', async () => {
    await dbs.auth
      .update(users)
      .set({ twoFactorEnabled: false })
      .where(sql`${users.id} = ${bob}`);
    try {
      const raw = withUser(dbs.app, bob, (tx) =>
        tx.execute(sql`INSERT INTO market_credentials (user_id, provider, api_key_enc, last4)
                       VALUES (${bob}, 'finnhub', decode('010203', 'hex'), 'abcd')`),
      );
      expect(await pgErrorCode(raw)).toBe(INSUFFICIENT_PRIVILEGE);
      const credentials = createMarketCredentials(dbs.app, { getDek: () => Promise.resolve(generateDek()) });
      await expect(credentials.save(bob, { provider: 'finnhub', apiKey: 'finnhub-key-123' })).rejects.toMatchObject({
        code: 'TWO_FACTOR_REQUIRED',
      });
    } finally {
      await dbs.auth
        .update(users)
        .set({ twoFactorEnabled: true })
        .where(sql`${users.id} = ${bob}`);
    }
  });

  it('keeps Σ goal percentages per asset ≤ 100% and targets at exactly 100%, even with raw SQL (FR-G2, FR-I3)', async () => {
    const over = withUser(dbs.app, alice, (tx) =>
      tx.execute(sql`UPDATE goal_funding_sources SET pct_bps = 10001 WHERE asset_id IS NOT NULL`),
    );
    expect(await pgErrorCode(over)).toBe('23514');
    const second = withUser(dbs.app, alice, async (tx) => {
      const [goal] = await tx.execute<{
        id: string;
      }>(sql`INSERT INTO goals (user_id, name, icon, color, target_minor, currency)
          VALUES (${alice}, 'Pensiun', 'sunset', 'violet', 1000, 'IDR') RETURNING id`);
      await tx.execute(sql`INSERT INTO goal_funding_sources (user_id, goal_id, asset_id, mode, pct_bps)
                           SELECT ${alice}, ${goal?.id as string}, asset_id, 'percent', 4001 FROM goal_funding_sources
                           WHERE asset_id IS NOT NULL`);
    });
    expect(await pgErrorCode(second)).toBe('23514');
    const targets = withUser(dbs.app, alice, (tx) => tx.execute(sql`UPDATE allocation_targets SET target_bps = 9000`));
    expect(await pgErrorCode(targets)).toBe('23514');
  });

  it('lets the worker read the portfolio and write market data and snapshots, never assets or trades (D14)', async () => {
    const [row] = await withUser(dbs.worker, alice, (tx) =>
      tx.execute(sql`SELECT (SELECT count(*) FROM assets)::int AS assets,
                            (SELECT count(*) FROM investment_trades)::int AS trades,
                            (SELECT units FROM holdings) AS units`),
    );
    expect(row).toEqual({ assets: 1, trades: 1, units: '0.100000000000000000' });
    for (const statement of [
      sql`UPDATE assets SET name = 'x'`,
      sql`DELETE FROM investment_trades`,
      sql`INSERT INTO asset_categories (user_id, name, asset_class) VALUES (${alice}, 'x', 'cash')`,
      sql`UPDATE allocation_targets SET target_bps = 10000`,
      sql`UPDATE market_credentials SET api_key_enc = decode('00', 'hex')`,
      sql`DELETE FROM market_credentials`,
    ]) {
      expect(await pgErrorCode(withUser(dbs.worker, alice, (tx) => tx.execute(statement)))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
    await createMarketData(dbs.worker).recordServerQuotes(
      [
        {
          provider: 'coinmarketcap',
          symbol: 'BTC',
          quoteCurrency: 'IDR',
          bucketTs: now(),
          price: '1460000000',
          prevClose: null,
        },
      ],
      now(),
    );
    // Everyone reads built-in quotes through the view.
    expect(await withUser(dbs.app, bob, (tx) => tx.execute(sql`SELECT symbol FROM market_quotes_latest`))).toEqual([
      { symbol: 'BTC' },
    ]);
  });
});
