// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { DEFAULT_REPORT_EXPORT_OPTIONS } from '@wf/domain/report';
import { createPreferences } from '@wf/db/preferences';
import { jobIds } from '@wf/jobs/queues';
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
      enqueue: async () => Promise.resolve(),
      db: {
        reports: {
          pendingMonthly: repo.pendingMonthly,
          get: (owner, id) => repo.get(owner, id),
          generate: async (owner, request, generatedAt) => {
            if (fail && request.kind === 'monthly' && request.periodId === september?.id) {
              fail = false;
              throw new Error('Temporary database interruption');
            }
            return repo.generate(owner, request, generatedAt);
          },
        },
        preferences: createPreferences(test.db),
      },
    };
    const run = createReportsProcessor(deps);
    const job = { id: 'report-retry', data: { userId }, attemptsMade: 0 };
    await expect(test.as('wf_worker', () => run(job))).rejects.toThrow('Temporary database interruption');
    const published = await test.as('wf_app', () => repo.list(userId));
    expect(published.map((report) => report.range)).toEqual([{ from: '2026-08-01', to: '2026-08-31' }]);
    const august = published[0];
    if (august === undefined) throw new Error('August report was not published');
    expect(await test.as('wf_worker', () => run({ ...job, attemptsMade: 1 }))).toEqual({ generated: 1, autoSent: 0 });
    const final = await test.as('wf_app', () => repo.latestFinal(userId));
    expect(final?.totals).toMatchObject({
      incomeMinor: 25_800_000n,
      expenseMinor: 18_300_000n,
      savedMinor: 7_500_000n,
    });
    expect(await test.as('wf_app', () => repo.get(userId, august.id))).toMatchObject(august);
    expect(await test.as('wf_worker', () => run({ ...job, attemptsMade: 2 }))).toEqual({ generated: 0, autoSent: 0 });
  },
  PGLITE_HOOK_TIMEOUT,
);

it(
  'queues the PDF auto-send of a newly generated final monthly report only with the opt-in on (FR-LP4)',
  async () => {
    const userId = await insertUser(test, 'report-auto-send@example.test');
    await test.as('wf_app', () => seedLedger(test.db, userId, { getDek }));
    // seedLedger already closed the September period; it is the pending monthly report of the first run.
    const enqueued: { readonly jobId: string; readonly payload: object }[] = [];
    const deps = (autoSend: boolean): ReportsProcessorDeps => ({
      now,
      enqueue: async (_queue, payload, { jobId }) => {
        enqueued.push({ jobId, payload });
        return Promise.resolve();
      },
      db: {
        reports: {
          pendingMonthly: createReports(test.db).pendingMonthly,
          get: (owner, id) => createReports(test.db).get(owner, id),
          generate: (owner, request, at) => createReports(test.db).generate(owner, request, at),
        },
        // wf_worker may not write user_preferences; the processor only reads the opt-in.
        preferences: { get: async () => Promise.resolve({ reportAutoSend: autoSend } as never) },
      },
    });
    const job = { id: 'report-auto', data: { userId }, attemptsMade: 0 };
    // Opt-in off (the default): the report is generated, nothing is queued.
    await expect(test.as('wf_worker', () => createReportsProcessor(deps(false))(job))).resolves.toEqual({
      generated: 1,
      autoSent: 0,
    });
    expect(enqueued).toEqual([]);
    // Opt-in on, but the stored report is never rewritten: a rerun generates nothing and queues nothing again.
    await expect(test.as('wf_worker', () => createReportsProcessor(deps(true))(job))).resolves.toEqual({
      generated: 0,
      autoSent: 0,
    });
    expect(enqueued).toEqual([]);
    // A new final monthly report (the row is gone again, as right after a period close) is queued once.
    await test.query(`DELETE FROM reports WHERE user_id = $1`, [userId]);
    await expect(test.as('wf_worker', () => createReportsProcessor(deps(true))(job))).resolves.toEqual({
      generated: 1,
      autoSent: 1,
    });
    expect(enqueued).toHaveLength(1);
    const queued = enqueued[0] as { jobId: string; payload: { reportId: string } };
    expect(queued.jobId).toMatch(/^rep\.[0-9a-f-]{36}\.pdf$/);
    expect(queued.payload).toMatchObject({
      userId,
      reportId: queued.payload.reportId,
      format: 'pdf',
      email: true,
      options: DEFAULT_REPORT_EXPORT_OPTIONS,
    });
    // The export job id is deterministic: a retry of the same report deduplicates.
    expect(queued.jobId).toBe(jobIds['report-export'](queued.payload.reportId, 'pdf'));
  },
  PGLITE_HOOK_TIMEOUT,
);
