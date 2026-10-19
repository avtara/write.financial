// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { DESIGN_SEED, seedClosingBalances, type DesignSeed, type SeedTransaction } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { SeedMismatchError, seedLedger, SeedTargetNotEmptyError } from './seed.ts';

let test: TestDatabase;
let userId: string;
const dek = generateDek();
const options = { getDek: () => Promise.resolve(dek), now: () => new Date('2026-10-15T10:00:00Z') };
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

/** A one-account seed for the failure cases. */
const tiny = (overrides: Partial<DesignSeed>): DesignSeed => ({
  ...DESIGN_SEED,
  accounts: DESIGN_SEED.accounts.slice(0, 1),
  transactions: [],
  septemberTransactions: [],
  closedPeriods: [],
  budgets: [],
  goals: [],
  fxRates: [],
  ...overrides,
});

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'avtara@example.test');
});

// Seeding 128 transactions through the repositories on PGlite takes several seconds on a loaded CI runner.
describe('seedLedger', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('reproduces the design balances and the Rp55.023.000 available balance', async () => {
    // A category of the user's own is left alone.
    await test.query(
      `INSERT INTO categories (user_id, kind, "group", name, icon, color) VALUES ($1, 'expense', 'wants', 'Kopi', 'coffee', 'brown')`,
      [userId],
    );
    const result = await asApp(() => seedLedger(test.db, userId, { getDek: options.getDek }));
    expect(result).toEqual({
      balances: seedClosingBalances(DESIGN_SEED),
      transactions: 249,
      closedPeriods: 1,
      goals: DESIGN_SEED.goals.length,
      availableMinor: 55_023_000n,
    });
    expect(
      await test.query(
        `SELECT type, count(*)::int AS n FROM transactions WHERE deleted_at IS NULL GROUP BY type ORDER BY type`,
      ),
    ).toEqual([
      { type: 'expense', n: 235 },
      { type: 'income', n: 8 },
      { type: 'transfer', n: 6 },
    ]);
    // September is the first period row and closed; October follows, open.
    expect(
      await test.query(
        `SELECT label, start_date::text AS start, end_date::text AS end, status, closed_at FROM periods ORDER BY start_date`,
      ),
    ).toEqual([
      {
        label: '2026-09',
        start: '2026-09-01',
        end: '2026-09-30',
        status: 'closed',
        closed_at: new Date('2026-10-01T00:05:00+07:00'),
      },
      { label: '2026-10', start: '2026-10-01', end: '2026-10-31', status: 'open', closed_at: null },
    ]);
    expect(
      await test.query(
        `SELECT v.effective_from, count(l.id)::int AS lines, sum(l.limit_minor)::text AS total
         FROM budget_versions v JOIN budget_lines l ON l.version_id = v.id GROUP BY v.effective_from`,
      ),
    ).toEqual([{ effective_from: '2026-09', lines: 10, total: '18750000' }]);
    expect(await test.query('SELECT period_start_day FROM user_preferences')).toEqual([{ period_start_day: 1 }]);
    expect(await test.query('SELECT base_currency, timezone FROM users')).toEqual([
      { base_currency: 'IDR', timezone: 'Asia/Jakarta' },
    ]);
    expect(await test.query('SELECT count(*)::int AS n FROM users WHERE onboarding_completed_at IS NOT NULL')).toEqual([
      { n: 1 },
    ]);
  });

  it('only fills an empty ledger', async () => {
    await asApp(() => seedLedger(test.db, userId, { ...options, seed: tiny({}) }));
    await expect(asApp(() => seedLedger(test.db, userId, options))).rejects.toBeInstanceOf(SeedTargetNotEmptyError);
  });

  it('fails on a fixture that references a missing category or account', async () => {
    const [account] = DESIGN_SEED.accounts;
    const expense = DESIGN_SEED.transactions.find(
      (entry): entry is Exclude<SeedTransaction, { kind: 'transfer' }> => entry.kind === 'expense',
    );
    if (account === undefined || expense === undefined) throw new Error('fixture changed');
    await expect(
      asApp(() =>
        seedLedger(test.db, userId, { ...options, seed: tiny({ transactions: [{ ...expense, accountKey: 'nope' }] }) }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);

    const other = await insertUser(test, 'other@example.test');
    // A user who deleted a built-in category does not get it back from the seed.
    await test.query(
      `INSERT INTO categories (user_id, kind, "group", name, icon, color, deleted_at)
       VALUES ($1, 'expense', 'needs', 'system:food', 'utensils', 'orange', now())`,
      [other],
    );
    const food = { ...expense, accountKey: account.key, categoryKey: 'system:food' as const };
    await expect(
      asApp(() => seedLedger(test.db, other, { ...options, seed: tiny({ transactions: [food] }) })),
    ).rejects.toBeInstanceOf(SeedMismatchError);
  });

  it('fails on a closed period that is not a period of the ledger', async () => {
    const closedAt = '2026-10-01T00:05:00+07:00';
    // Not on the start day: the period row containing 30 Sep starts on the 1st.
    await expect(
      asApp(() =>
        seedLedger(test.db, userId, {
          ...options,
          seed: tiny({ closedPeriods: [{ start: '2026-09-02', end: '2026-09-30', closedAt }] }),
        }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);
    // Before the first period row (September): a computed period, without a row to lock.
    const other = await insertUser(test, 'other@example.test');
    await expect(
      asApp(() =>
        seedLedger(test.db, other, {
          ...options,
          seed: tiny({
            closedPeriods: [
              { start: '2026-09-01', end: '2026-09-30', closedAt },
              { start: '2026-08-01', end: '2026-08-31', closedAt },
            ],
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);
  });
});
