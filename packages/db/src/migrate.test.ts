// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate as runMigrations } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertUser,
  startMigrated,
  startPglite,
  PGLITE_HOOK_TIMEOUT,
  TEST_PASSWORDS,
  type PgliteServer,
  type TestDatabase,
} from '../test/pglite.ts';
import { createDb } from './db.ts';
import { migrate, MIGRATIONS_FOLDER } from './migrate.ts';
import { bootstrapRoles } from './roles.ts';
import { FEATURES } from './schema.ts';

/** Global tables without Row-Level Security; every other table must have it (see the security migration). */
const GLOBAL_TABLES = ['entitlements', 'plans'];

const ALL = 'DELETE,INSERT,SELECT,UPDATE';
const SETUP_COLUMNS =
  'default_locale,default_timezone,instance_dek_wrapped,instance_name,public_url,registration_mode,setup_completed_at,' +
  'smtp_from,smtp_host,smtp_password_enc,smtp_port,smtp_secure,smtp_username,updated_at';
const OPS_SETTINGS_COLUMNS =
  'default_locale,default_timezone,instance_name,public_url,registration_mode,setup_completed_at,singleton,smtp_from,' +
  'smtp_host,smtp_port,smtp_secure,smtp_username,updated_at';
const PROFILE_COLUMNS =
  'base_currency,deletion_requested_at,image,locale,name,nickname,onboarding_completed_at,onboarding_step,timezone,updated_at';

/** Ledger tables (M1): the app reads and writes them, the worker only reads them (D14). */
const LEDGER = { wf_app: ALL, wf_worker: 'SELECT' };

/** Privileges per table and role (the owner wf_migrate aside); `PRIV(cols)` = column-level grant. See README. */
const GRANTS = {
  accounts: LEDGER,
  accounts_auth: { wf_auth: ALL },
  activity_log: { wf_app: 'INSERT,SELECT' },
  // M7.2: no direct log/month deletion; only the worker's retention definer can purge logs.
  ai_connections: LEDGER,
  ai_logs: { wf_app: 'INSERT,SELECT,UPDATE', wf_worker: 'INSERT,SELECT,UPDATE' },
  ai_settings: LEDGER,
  ai_usage_months: { wf_app: 'INSERT,SELECT,UPDATE', wf_worker: 'INSERT,SELECT,UPDATE' },
  // M5: the user's portfolio (the worker only reads it, D14).
  allocation_targets: LEDGER,
  asset_categories: LEDGER,
  assets: LEDGER,
  attachments: LEDGER,
  // M7.1: rules and their evidence are user-owned; the worker only reads them to build proposals.
  auto_rule_corrections: { wf_app: ALL, wf_worker: 'SELECT' },
  auto_rule_suggestion_dismissals: { wf_app: ALL, wf_worker: 'SELECT' },
  auto_rules: { wf_app: ALL, wf_worker: 'SELECT' },
  balance_adjustments: LEDGER,
  budget_alert_dismissals: LEDGER,
  budget_lines: LEDGER,
  budget_period_overrides: LEDGER,
  budget_versions: LEDGER,
  categories: LEDGER,
  // M4: user-managed; the worker reads them for installment occurrences and reminders (D14).
  card_payment_allocations: LEDGER,
  debt_installments: LEDGER,
  debts: LEDGER,
  // M3: the worker suggests subscriptions (upsert) and the app acts on them.
  detected_recurring: { wf_app: ALL, wf_worker: 'INSERT,SELECT,UPDATE' },
  drafts: { wf_app: ALL },
  entitlements: { wf_app: 'SELECT', wf_readonly_ops: 'SELECT', wf_worker: 'SELECT' },
  fx_rates: { wf_app: ALL, wf_worker: 'INSERT,SELECT,UPDATE' },
  goal_contribution_plans: LEDGER,
  goal_funding_sources: LEDGER,
  goals: LEDGER,
  investment_trades: LEDGER,
  instance_settings: {
    wf_app: `SELECT,UPDATE(${SETUP_COLUMNS})`,
    wf_auth: 'SELECT',
    wf_readonly_ops: `SELECT(${OPS_SETTINGS_COLUMNS})`,
    wf_worker: 'SELECT',
  },
  invitations: { wf_app: ALL, wf_auth: 'SELECT,UPDATE(used_at)' },
  // M5 market data: request log (both write it), the user's keys (the worker records test/quota outcomes), the
  // global built-in quote cache (worker only; the app reads market_quotes_latest), BYOK results per user.
  market_api_logs: { wf_app: 'INSERT,SELECT', wf_worker: 'INSERT,SELECT' },
  market_credentials: {
    wf_app: ALL,
    wf_worker: 'SELECT,UPDATE(last_tested_at,quota_limit,quota_reset_at,quota_used,retry_after,status,updated_at)',
  },
  market_quotes: { wf_worker: 'INSERT,SELECT,UPDATE' },
  // The built-in sources' state (pause, CoinMarketCap credits): the worker keeps it, the app shows it.
  market_provider_state: { wf_app: 'SELECT', wf_worker: 'INSERT,SELECT,UPDATE' },
  // Only the worker creates and delivers emails; notifications are created by it and read/marked by the app.
  notification_outbox: { wf_worker: 'INSERT,SELECT,UPDATE(attempts,last_error,sent_at)' },
  notifications: { wf_app: 'DELETE,SELECT,UPDATE(read_at)', wf_worker: 'INSERT,SELECT' },
  passkeys: { wf_auth: ALL },
  // D14: the worker's only write is the period lock (close an ended period, create the next one).
  periods: { wf_app: ALL, wf_worker: 'INSERT,SELECT,UPDATE(closed_at,status,updated_at)' },
  plans: { wf_app: 'SELECT', wf_readonly_ops: 'SELECT', wf_worker: 'SELECT' },
  // The daily snapshot job (worker) and the seed (app).
  portfolio_snapshots: { wf_app: 'INSERT,SELECT,UPDATE', wf_worker: 'INSERT,SELECT,UPDATE' },
  goal_snapshots: { wf_app: ALL, wf_worker: 'INSERT,SELECT,UPDATE' },
  postings: LEDGER,
  receipt_uploads: {
    wf_app: ALL,
    wf_worker: 'SELECT,UPDATE(error_code,payload_enc,review_item_id,status,updated_at)',
  },
  receivable_payments: LEDGER,
  receivables: LEDGER,
  recent_items: { wf_app: ALL },
  // FR-LP1 / D10: app may refresh its provisional aggregates; RLS refuses final UPDATE. Worker only reads/inserts.
  report_files: { wf_app: ALL, wf_worker: 'INSERT,SELECT,UPDATE' },
  reports: { wf_app: ALL, wf_worker: 'INSERT,SELECT' },
  recurrences: { wf_app: ALL, wf_worker: 'SELECT' },
  // D14: the worker creates review items but cannot resolve them (no UPDATE); only confirmReview (wf_app) does.
  review_items: { wf_app: ALL, wf_worker: 'INSERT,SELECT' },
  scheduled_occurrences: {
    wf_app: ALL,
    wf_worker: 'INSERT,SELECT,UPDATE(expected_minor,remind_at,reminded_at,status,updated_at)',
  },
  security_events: {
    wf_app: 'INSERT,SELECT',
    wf_auth: 'INSERT,SELECT',
    wf_readonly_ops: 'SELECT',
    wf_worker: 'INSERT,SELECT',
  },
  sessions: { wf_auth: ALL },
  subscriptions: { wf_app: ALL, wf_worker: 'SELECT' },
  tag_aliases: LEDGER,
  tags: LEDGER,
  transaction_tags: LEDGER,
  transactions: LEDGER,
  transfer_meta: LEDGER,
  two_factors: { wf_auth: ALL },
  user_keys: { wf_app: 'INSERT,SELECT', wf_worker: 'INSERT,SELECT' },
  user_plans: { wf_app: 'SELECT', wf_readonly_ops: 'SELECT', wf_worker: 'SELECT' },
  user_preferences: { wf_app: 'INSERT,SELECT,UPDATE', wf_worker: 'SELECT' },
  // Deleted with the provider's key (app); written by the BYOK polling (worker).
  user_quotes: { wf_app: ALL, wf_worker: ALL },
  users: { wf_app: `SELECT,UPDATE(${PROFILE_COLUMNS})`, wf_auth: ALL, wf_worker: 'SELECT' },
  verifications: { wf_auth: ALL },
};

let test: TestDatabase;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

const tables = async () =>
  test.query<{ name: string; owner: string; rls: boolean; forced: boolean }>(
    `SELECT relname AS name, pg_get_userbyid(relowner) AS owner, relrowsecurity AS rls, relforcerowsecurity AS forced
     FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname`,
  );

describe('migrate', () => {
  it('applies every migration file once; running it again changes nothing', async () => {
    const files = readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith('.sql'));
    const applied = async () => (await test.query('SELECT hash FROM drizzle.__drizzle_migrations')).length;
    expect(await applied()).toBe(files.length);
    await test.as('wf_migrate', () => migrate(test.url));
    expect(await applied()).toBe(files.length);
  });

  it('leaves wf_migrate owning every table', async () => {
    expect(new Set((await tables()).map((table) => table.owner))).toEqual(new Set(['wf_migrate']));
  });

  it('enables and forces Row-Level Security on every table except the global catalog', async () => {
    const all = await tables();
    expect(all.filter((table) => !table.rls || !table.forced).map((table) => table.name)).toEqual(GLOBAL_TABLES);
  });

  it('grants exactly the documented privileges', async () => {
    const rows = await test.query<{ table: string; role: string; privileges: string }>(
      `WITH acl AS (
         SELECT c.relname AS tbl, a.grantee, a.privilege_type AS priv, NULL::text AS col
         FROM pg_class c, aclexplode(c.relacl) a
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         UNION ALL
         SELECT c.relname, a.grantee, a.privilege_type, att.attname
         FROM pg_class c JOIN pg_attribute att ON att.attrelid = c.oid, aclexplode(att.attacl) a
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND att.attacl IS NOT NULL
       ), per_priv AS (
         SELECT tbl, pg_get_userbyid(grantee) AS role, priv,
                CASE WHEN bool_or(col IS NULL) THEN priv ELSE priv || '(' || string_agg(col, ',' ORDER BY col) || ')' END AS p
         FROM acl GROUP BY tbl, grantee, priv
       )
       SELECT tbl AS table, role, string_agg(p, ',' ORDER BY priv) AS privileges
       FROM per_priv WHERE role <> 'wf_migrate' GROUP BY tbl, role ORDER BY tbl, role`,
    );
    const actual: Record<string, Record<string, string>> = {};
    for (const { table, role, privileges } of rows) (actual[table] ??= {})[role] = privileges;
    expect(actual).toEqual(GRANTS);
  });

  it('has only the documented SECURITY DEFINER functions: owned by wf_migrate, pinned search_path, wf_worker only', async () => {
    expect(
      await test.query(
        `SELECT p.proname AS name, pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config,
                (SELECT string_agg(a.grantee::regrole::text, ',' ORDER BY a.grantee::regrole::text)
                 FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) AS execute
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef ORDER BY p.proname`,
      ),
    ).toEqual(
      [
        'fx_currencies_in_use',
        'wf_account_delete_user',
        'wf_due_deletions',
        'wf_due_reminders',
        'wf_maintenance_purge_ai_logs',
        'wf_maintenance_purge_auth',
        'wf_maintenance_purge_notifications',
        'wf_market_byok_users',
        'wf_market_purge_logs',
        'wf_market_server_targets',
        'wf_pending_outbox',
        'wf_worker_users',
      ].map((name) => ({
        name,
        owner: 'wf_migrate',
        config: ['search_path=pg_catalog, public'],
        execute: 'wf_worker',
      })),
    );
  });

  it('seeds the instance settings row and the personal plan with every feature', async () => {
    expect(
      await test.query('SELECT registration_mode, setup_completed_at, default_locale FROM instance_settings'),
    ).toEqual([{ registration_mode: 'closed', setup_completed_at: null, default_locale: 'id' }]);
    expect(await test.query('SELECT code FROM plans')).toEqual([{ code: 'personal' }]);
    const features = await test.query<{ feature: string; limit: null }>(
      `SELECT feature, "limit" FROM entitlements WHERE plan_code = 'personal' ORDER BY feature`,
    );
    // Enum values sort in declaration order.
    expect(features).toEqual(FEATURES.map((feature) => ({ feature, limit: null })));
  });

  it('keeps a single instance settings row', async () => {
    await expect(test.query('INSERT INTO instance_settings (singleton) VALUES (false)')).rejects.toThrow(
      /instance_settings_singleton_check/,
    );
    await expect(test.query('INSERT INTO instance_settings DEFAULT VALUES')).rejects.toThrow(/duplicate key/);
  });

  it('app_user_id() is NULL without a user context, also after a transaction that had one', async () => {
    expect(await test.query('SELECT app_user_id() AS id')).toEqual([{ id: null }]);
    await test.pg.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.user_id', '0199f0a1-0000-7000-8000-000000000001', true)`);
      expect((await tx.query('SELECT app_user_id() AS id')).rows).toEqual([
        { id: '0199f0a1-0000-7000-8000-000000000001' },
      ]);
    });
    expect(await test.query('SELECT app_user_id() AS id')).toEqual([{ id: null }]);
  });
});

describe('security_events', () => {
  it('rejects UPDATE, DELETE, and TRUNCATE, even for the superuser', async () => {
    const userId = await insertUser(test, 'append-only@example.test');
    await test.query(`INSERT INTO security_events (user_id, type) VALUES ($1, 'sign_in')`, [userId]);
    await expect(test.query(`UPDATE security_events SET type = 'sign_out'`)).rejects.toThrow(
      'security_events is append-only: UPDATE is not allowed',
    );
    await expect(test.query('DELETE FROM security_events')).rejects.toThrow(
      'security_events is append-only: DELETE is not allowed',
    );
    await expect(test.query('TRUNCATE security_events')).rejects.toThrow(
      'security_events is append-only: TRUNCATE is not allowed',
    );
  });

  it('loses a user’s events only when the user is deleted', async () => {
    const userId = await insertUser(test, 'deleted@example.test');
    await test.query(`INSERT INTO security_events (user_id, type) VALUES ($1, 'sign_in')`, [userId]);
    await test.query('DELETE FROM users WHERE id = $1', [userId]);
    expect(await test.query('SELECT 1 FROM security_events WHERE user_id = $1', [userId])).toEqual([]);
  });

  it('stores only hashed IPs', async () => {
    const userId = await insertUser(test, 'ip@example.test');
    await expect(
      test.query(`INSERT INTO security_events (user_id, type, ip_hash) VALUES ($1, 'sign_in', '203.0.113.7')`, [
        userId,
      ]),
    ).rejects.toThrow(/security_events_ip_hash_check/);
  });
});

/** A database migrated up to (not including) migration `tag`, as an instance of that time has it. */
async function migratedBefore(tag: string): Promise<{ base: PgliteServer; folder: string }> {
  const base = await startPglite();
  const folder = await mkdtemp(path.join(tmpdir(), 'wf-migrations-'));
  await bootstrapRoles(base.url, TEST_PASSWORDS);
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8')) as { entries: { tag: string }[] };
  await writeFile(
    journalFile,
    JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.tag < tag) }),
  );
  await base.pg.exec('SET ROLE wf_migrate');
  const db = createDb(base.url, { max: 1 });
  await runMigrations(db, { migrationsFolder: folder });
  await db.$client.end();
  await base.pg.exec('RESET ROLE');
  return { base, folder };
}

/** Applies the remaining migrations as wf_migrate. */
async function migrateRest(base: PgliteServer): Promise<void> {
  await base.pg.exec('SET ROLE wf_migrate');
  await migrate(base.url);
  await base.pg.exec('RESET ROLE');
}

describe('0010_goals_debts_receivables', () => {
  it('turns the goal splits of recurring transfers (M3 template allocations) into contribution plans', async () => {
    // The migrations up to 0009, as an M3 instance has them.
    const { base, folder } = await migratedBefore('0010');
    try {
      const userId = await insertUser(base, 'm3@example.test');
      const [account] = await base.query<{ id: string }>(
        `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
         VALUES ($1, 'bank', 'BCA', 'BCA', 'IDR', '2026-01-01', 'blue') RETURNING id`,
        [userId],
      );
      const goal = async (name: string) =>
        (
          await base.query<{ id: string }>(
            `INSERT INTO goals (user_id, name, icon, color, target_minor, currency) VALUES ($1, $2, 'x', 'x', 1, 'IDR')
             RETURNING id`,
            [userId, name],
          )
        )[0]?.id as string;
      const [liburan, servis] = [await goal('Liburan Bali'), await goal('Servis motor')];
      const template = (allocations?: unknown) =>
        JSON.stringify({ type: 'transfer', fromAccountId: account?.id, sentMinor: '1107000', allocations });
      await base.query(
        `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
         VALUES ($1, $2::jsonb, 'monthly', '2026-10-25', 25), ($1, $3::jsonb, 'monthly', '2026-10-01', 1)`,
        [
          userId,
          template([
            { goalId: liburan, amountMinor: '867000' },
            { goalId: servis, amountMinor: '240000' },
          ]),
          template(),
        ],
      );

      await migrateRest(base);

      expect(
        await base.query(
          `SELECT g.name, p.amount_minor::text AS amount, p.active FROM goal_contribution_plans p
           JOIN goals g ON g.id = p.goal_id ORDER BY g.name`,
        ),
      ).toEqual([
        { name: 'Liburan Bali', amount: '867000', active: true },
        { name: 'Servis motor', amount: '240000', active: true },
      ]);
      expect(await base.query(`SELECT count(*)::int AS n FROM recurrences WHERE template ? 'allocations'`)).toEqual([
        { n: 0 },
      ]);
      expect(
        await base.query(`SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'recurrences'`),
      ).toEqual([{ forced: true }]);
    } finally {
      await base.close();
      await rm(folder, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('0011_plan_months', () => {
  it('starts existing contribution plans in their recurrence’s first month, without an end', async () => {
    const { base, folder } = await migratedBefore('0011');
    try {
      const userId = await insertUser(base, 'm4@example.test');
      const [goal] = await base.query<{ id: string }>(
        `INSERT INTO goals (user_id, name, icon, color, target_minor, currency) VALUES ($1, 'Liburan Bali', 'x', 'x', 1, 'IDR')
         RETURNING id`,
        [userId],
      );
      const [recurrence] = await base.query<{ id: string }>(
        `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
         VALUES ($1, '{"type":"transfer"}'::jsonb, 'monthly', '2026-10-25', 25) RETURNING id`,
        [userId],
      );
      await base.query(
        `INSERT INTO goal_contribution_plans (user_id, goal_id, recurrence_id, amount_minor) VALUES ($1, $2, $3, 867000)`,
        [userId, goal?.id, recurrence?.id],
      );

      await migrateRest(base);

      expect(
        await base.query(
          `SELECT to_char(start_month, 'YYYY-MM-DD') AS start, end_month AS "end" FROM goal_contribution_plans`,
        ),
      ).toEqual([{ start: '2026-10-01', end: null }]);
      expect(
        await base.query(
          `SELECT relname AS name, relforcerowsecurity AS forced FROM pg_class
           WHERE relname IN ('goal_contribution_plans', 'recurrences') ORDER BY relname`,
        ),
      ).toEqual([
        { name: 'goal_contribution_plans', forced: true },
        { name: 'recurrences', forced: true },
      ]);
      await expect(base.query(`UPDATE goal_contribution_plans SET end_month = '2026-09-01'`)).rejects.toThrow(
        /goal_contribution_plans_months_check/,
      );
    } finally {
      await base.close();
      await rm(folder, { recursive: true, force: true });
    }
  }, 60_000);
});
