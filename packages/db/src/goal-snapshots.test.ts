// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { createGoalSnapshots, goalSnapshotIn } from './goal-snapshots.ts';
import { createGoals } from './goals.ts';
import { createReports } from './reports.ts';
import { seedLedger } from './seed.ts';

let test: TestDatabase;
const at = new Date('2026-10-15T10:00:00Z');
const dek = generateDek();
const options = { getDek: () => Promise.resolve(dek), now: () => at };
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const record = (owner: string, when: Date) =>
  test.as('wf_worker', () => createGoalSnapshots(test.db).record(owner, when));
const load = (owner: string, to: string) =>
  asApp(() => withUser(test.db, owner, (tx) => goalSnapshotIn(tx, owner, to as LocalDate)));

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});

it('distinguishes absent history from an observed empty day and replaces only the current local day', async () => {
  const owner = await insertUser(test, 'empty-goal-history@example.test');
  await test.query(`UPDATE users SET timezone = 'America/Los_Angeles' WHERE id = $1`, [owner]);
  expect(await load(owner, '2026-10-14')).toBeNull();
  await record(owner, new Date('2026-10-15T06:30:00Z'));
  expect(await load(owner, '2026-10-14')).toEqual({
    date: '2026-10-14',
    recordedAt: new Date('2026-10-15T06:30:00Z'),
    goals: [],
  });
  await record(owner, new Date('2026-10-15T06:35:00Z'));
  await record(owner, new Date('2026-10-15T07:30:00Z'));
  expect((await load(owner, '2026-10-14'))?.recordedAt).toEqual(new Date('2026-10-15T06:35:00Z'));
  const rows = await test.query<{ snapshot_date: string }>(
    `SELECT snapshot_date::text FROM goal_snapshots WHERE user_id = $1 ORDER BY snapshot_date`,
    [owner],
  );
  expect(rows).toEqual([{ snapshot_date: '2026-10-14' }, { snapshot_date: '2026-10-15' }]);
});

it('never substitutes future or current allocations, names, targets, or currency for a historical observation', async () => {
  const owner = await insertUser(test, 'dated-goal-history@example.test');
  await test.query(`UPDATE users SET timezone = 'America/Los_Angeles' WHERE id = $1`, [owner]);
  const [account] = await test.query<{ id: string }>(
    `INSERT INTO accounts
    (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
    VALUES ($1, 'bank', 'Euro', 'Euro', 'EUR', 1000, '2026-10-01', 'blue') RETURNING id`,
    [owner],
  );
  if (account === undefined) throw new Error('account missing');
  let goalClock = new Date('2026-10-15T06:00:00Z');
  const goals = createGoals(test.db, { ...options, now: () => goalClock });
  const goal = await asApp(() =>
    goals.create(owner, {
      name: 'Original goal',
      icon: 'house',
      color: 'blue',
      targetMinor: 1000n,
      currency: 'EUR',
      deadlineMonth: null,
      tag: null,
      sources: [{ accountId: account.id, mode: 'fixed', amountMinor: 600n }],
    }),
  );
  const reports = createReports(test.db);
  const absent = await asApp(() =>
    reports.generate(owner, { kind: 'custom', from: '2026-10-13' as LocalDate, to: '2026-10-13' as LocalDate }, at),
  );
  expect(absent.sections.goalsAsOf).toBeNull();
  expect(absent.sections.goals).toEqual([]);
  await record(owner, new Date('2026-10-15T06:30:00Z')); // 14 Oct locally.
  goalClock = new Date('2026-10-15T07:00:00Z');
  await asApp(() => goals.update(owner, goal.id, { name: 'Later name', targetMinor: 2500n }));
  await asApp(() => goals.setSources(owner, goal.id, [{ accountId: account.id, mode: 'fixed', amountMinor: 700n }]));
  await record(owner, new Date('2026-10-15T07:30:00Z')); // Future to the report's cutoff.
  await test.query(`DELETE FROM goals WHERE id = $1 AND user_id = $2`, [goal.id, owner]);
  const historical = await asApp(() =>
    reports.generate(owner, { kind: 'custom', from: '2026-10-14' as LocalDate, to: '2026-10-14' as LocalDate }, at),
  );
  expect(historical.sections.goalsAsOf).toBe('2026-10-14');
  expect(historical.sections.goals).toEqual([
    {
      goalId: goal.id,
      name: 'Original goal',
      currency: 'EUR',
      valuation: 'cash',
      openingMinor: null,
      savedMinor: 600n,
      targetMinor: 1000n,
      progressBps: 6000,
    },
  ]);
  expect((await load(owner, '2026-10-15'))?.goals).toEqual([
    {
      goalId: goal.id,
      name: 'Later name',
      currency: 'EUR',
      valuation: 'cash',
      savedMinor: 700n,
      targetMinor: 2500n,
    },
  ]);
});

it(
  'marks a cost fallback and missing FX explicitly instead of persisting a partial goal total as zero',
  async () => {
    const owner = await insertUser(test, 'goal-valuation-history@example.test');
    await asApp(() => seedLedger(test.db, owner, options));
    await record(owner, at);
    const priced = (await load(owner, '2026-10-15'))?.goals.find((goal) => goal.name === 'DP Rumah');
    expect(priced).toMatchObject({ valuation: 'market', savedMinor: 14_100_000n });
    await test.query(
      `UPDATE assets SET price_mode = 'byok', manual_price = NULL, manual_price_at = NULL WHERE user_id = $1 AND symbol = 'SPY'`,
      [owner],
    );
    await record(owner, new Date('2026-10-15T10:01:00Z'));
    expect((await load(owner, '2026-10-15'))?.goals.find((goal) => goal.name === 'DP Rumah')?.valuation).toBe('cost');
    await test.query(`DELETE FROM fx_rates WHERE user_id = $1 AND base = 'USD'`, [owner]);
    await record(owner, new Date('2026-10-15T10:02:00Z'));
    expect((await load(owner, '2026-10-15'))?.goals.find((goal) => goal.name === 'DP Rumah')).toMatchObject({
      valuation: 'unavailable',
      savedMinor: null,
    });
    const report = await asApp(() =>
      createReports(test.db).generate(
        owner,
        { kind: 'custom', from: '2026-10-15' as LocalDate, to: '2026-10-15' as LocalDate },
        at,
      ),
    );
    expect(report.sections.goals.find((goal) => goal.name === 'DP Rumah')).toMatchObject({
      valuation: 'unavailable',
      savedMinor: null,
      progressBps: null,
    });
  },
  PGLITE_HOOK_TIMEOUT,
);
