// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser, startMigrated, PGLITE_HOOK_TIMEOUT, type TestDatabase } from '../test/pglite.ts';
import { migrate, MIGRATIONS_FOLDER } from './migrate.ts';
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
  'base_currency,deletion_requested_at,image,locale,name,nickname,onboarding_completed_at,timezone,updated_at';

/** Ledger tables (M1): the app reads and writes them, the worker only reads them (D14). */
const LEDGER = { wf_app: ALL, wf_worker: 'SELECT' };

/** Privileges per table and role (the owner wf_migrate aside); `PRIV(cols)` = column-level grant. See README. */
const GRANTS = {
  accounts: LEDGER,
  accounts_auth: { wf_auth: ALL },
  activity_log: { wf_app: 'INSERT,SELECT' },
  attachments: LEDGER,
  balance_adjustments: LEDGER,
  budget_alert_dismissals: LEDGER,
  budget_lines: LEDGER,
  budget_period_overrides: LEDGER,
  budget_versions: LEDGER,
  categories: LEDGER,
  drafts: { wf_app: ALL },
  entitlements: { wf_app: 'SELECT', wf_readonly_ops: 'SELECT', wf_worker: 'SELECT' },
  fx_rates: { wf_app: ALL, wf_worker: 'INSERT,SELECT,UPDATE' },
  goals: LEDGER,
  instance_settings: {
    wf_app: `SELECT,UPDATE(${SETUP_COLUMNS})`,
    wf_auth: 'SELECT',
    wf_readonly_ops: `SELECT(${OPS_SETTINGS_COLUMNS})`,
    wf_worker: 'SELECT',
  },
  invitations: { wf_app: ALL, wf_auth: 'SELECT,UPDATE(used_at)' },
  passkeys: { wf_auth: ALL },
  // D14: the worker's only write is the period lock (close an ended period, create the next one).
  periods: { wf_app: ALL, wf_worker: 'INSERT,SELECT,UPDATE(closed_at,status,updated_at)' },
  plans: { wf_app: 'SELECT', wf_readonly_ops: 'SELECT', wf_worker: 'SELECT' },
  postings: LEDGER,
  recent_items: { wf_app: ALL },
  security_events: {
    wf_app: 'INSERT,SELECT',
    wf_auth: 'INSERT,SELECT',
    wf_readonly_ops: 'SELECT',
    wf_worker: 'INSERT,SELECT',
  },
  sessions: { wf_auth: ALL },
  tag_aliases: LEDGER,
  tags: LEDGER,
  transaction_tags: LEDGER,
  transactions: LEDGER,
  transfer_meta: LEDGER,
  two_factors: { wf_auth: ALL },
  user_keys: { wf_app: 'INSERT,SELECT', wf_worker: 'INSERT,SELECT' },
  user_plans: { wf_app: 'SELECT', wf_readonly_ops: 'SELECT', wf_worker: 'SELECT' },
  user_preferences: { wf_app: 'INSERT,SELECT,UPDATE', wf_worker: 'SELECT' },
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
      ['fx_currencies_in_use', 'wf_maintenance_purge_auth'].map((name) => ({
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
