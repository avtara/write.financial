// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { createGoalSnapshots } from '@wf/db/goal-snapshots';
import { createGoals } from '@wf/db/goals';
import { createPortfolioSnapshots } from '@wf/db/portfolio-snapshots';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  insertUser,
  PGLITE_HOOK_TIMEOUT,
  startMigrated,
  type TestDatabase,
} from '../../../../packages/db/test/pglite.ts';
import { createSnapshotsProcessor } from './snapshots.ts';

let test: TestDatabase;
beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});

it(
  'records cash-only goals even without a portfolio, using one local-day cutoff across midnight',
  async () => {
    const owner = await insertUser(test, 'cash-only-snapshot@example.test');
    const [account] = await test.query<{ id: string }>(
      `INSERT INTO accounts
    (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
    VALUES ($1, 'bank', 'Bank', 'Bank', 'IDR', 1000, '2026-10-01', 'blue') RETURNING id`,
      [owner],
    );
    if (account === undefined) throw new Error('account missing');
    const goals = createGoals(test.db, {
      getDek: () => Promise.resolve(generateDek()),
      now: () => new Date('2026-10-15T10:00:00Z'),
    });
    await test.as('wf_app', () =>
      goals.create(owner, {
        name: 'Reserve',
        icon: 'house',
        color: 'blue',
        targetMinor: 1000n,
        currency: 'IDR',
        deadlineMonth: null,
        tag: null,
        sources: [{ accountId: account.id, mode: 'fixed', amountMinor: 600n }],
      }),
    );
    const before = await test.query(`SELECT to_jsonb(g) AS goal FROM goals g WHERE user_id = $1`, [owner]);
    let clockReads = 0;
    const process = createSnapshotsProcessor({
      db: { portfolioSnapshots: createPortfolioSnapshots(test.db), goalSnapshots: createGoalSnapshots(test.db) },
      now: () => new Date(clockReads++ === 0 ? '2026-10-15T16:59:59Z' : '2026-10-15T17:00:01Z'),
    });
    const result = await test.as('wf_worker', () => process({ id: 'snap', data: { userId: owner }, attemptsMade: 0 }));
    expect(result).toEqual({ snapshot: null });
    const points = await test.query<{ snapshot_date: string; goals: { savedMinor: string; valuation: string }[] }>(
      `SELECT snapshot_date::text, goals FROM goal_snapshots WHERE user_id = $1`,
      [owner],
    );
    expect(points).toEqual([
      { snapshot_date: '2026-10-15', goals: [expect.objectContaining({ savedMinor: '600', valuation: 'cash' })] },
    ]);
    expect(await test.query(`SELECT to_jsonb(g) AS goal FROM goals g WHERE user_id = $1`, [owner])).toEqual(before);
  },
  PGLITE_HOOK_TIMEOUT,
);
