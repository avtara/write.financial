// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { createReports } from '@wf/db/reports';
import { seedLedger } from '@wf/db/seed';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  insertUser,
  PGLITE_HOOK_TIMEOUT,
  startMigrated,
  type TestDatabase,
} from '../../../../packages/db/test/pglite.ts';
import { createReportsProcessor, type ReportsProcessorDeps } from './reports.ts';

let test: TestDatabase;
const at = new Date('2026-10-15T10:00:00Z');
const now = () => at;
const dek = generateDek();
const getDek = () => Promise.resolve(dek);

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});

it(
  'resumes after a partial failure without replacing an already-published month',
  async () => {
    const userId = await insertUser(test, 'report-job-retry@example.test');
    await test.as('wf_app', () => seedLedger(test.db, userId, { getDek }));
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days, status, closed_at)
    VALUES ($1, '2026-08', '2026-08-01', '2026-08-31', 31, 'closed', '2026-09-01T00:00:00Z')`,
      [userId],
    );
    const repo = createReports(test.db);
    const pending = await test.as('wf_worker', () => repo.pendingMonthly(userId));
    const september = pending.find((period) => period.label === '2026-09');
    let fail = true;
    const deps: ReportsProcessorDeps = {
      now,
      db: {
        reports: {
          pendingMonthly: repo.pendingMonthly,
          generate: async (owner, request, generatedAt) => {
            if (fail && request.kind === 'monthly' && request.periodId === september?.id) {
              fail = false;
              throw new Error('Temporary database interruption');
            }
            return repo.generate(owner, request, generatedAt);
          },
        },
      },
    };
    const run = createReportsProcessor(deps);
    const job = { id: 'report-retry', data: { userId }, attemptsMade: 0 };
    await expect(test.as('wf_worker', () => run(job))).rejects.toThrow('Temporary database interruption');
    const published = await test.as('wf_app', () => repo.list(userId));
    expect(published.map((report) => report.range)).toEqual([{ from: '2026-08-01', to: '2026-08-31' }]);
    const august = published[0];
    if (august === undefined) throw new Error('August report was not published');
    expect(await test.as('wf_worker', () => run({ ...job, attemptsMade: 1 }))).toEqual({ generated: 1 });
    const final = await test.as('wf_app', () => repo.latestFinal(userId));
    expect(final?.totals).toMatchObject({
      incomeMinor: 25_800_000n,
      expenseMinor: 18_300_000n,
      savedMinor: 7_500_000n,
    });
    expect(await test.as('wf_app', () => repo.get(userId, august.id))).toMatchObject(august);
    expect(await test.as('wf_worker', () => run({ ...job, attemptsMade: 2 }))).toEqual({ generated: 0 });
  },
  PGLITE_HOOK_TIMEOUT,
);
