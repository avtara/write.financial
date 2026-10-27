// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS, type JobQueue } from '@wf/jobs/queues';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { fakeDeps } from '../test/fakes.ts';
import { PROCESSORS } from './processors.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const ROW = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7e';

describe('PROCESSORS', () => {
  it('has one processor per enqueueable queue', () => {
    expect(Object.keys(PROCESSORS)).toEqual(Object.keys(JOBS));
    expectTypeOf<keyof typeof PROCESSORS>().toEqualTypeOf<JobQueue>();
  });

  it('runs fx over the built-in sources', async () => {
    const run = PROCESSORS.fx.create(fakeDeps());
    // The payload is validated before any request, so this never reaches the network.
    await expect(run({ id: 'x', data: { userId: 'u1' }, attemptsMade: 0 })).rejects.toThrow();
    // Offline: every source fails, and each failed request is logged as a built-in fetch.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    try {
      const deps = fakeDeps();
      await expect(PROCESSORS.fx.create(deps)({ id: 'x', data: {}, attemptsMade: 0 })).rejects.toThrow(
        /No FX reference rate available/,
      );
      expect(deps.db.calls.filter((call) => call.method === 'marketData.logRequest').length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('builds rules-backfill proposals for the scoped rules only', async () => {
    const deps = fakeDeps();
    const result = await PROCESSORS['rules-backfill'].create(deps)({
      id: 'x',
      data: { userId: USER, requestId: ROW, ruleIds: [ROW] },
      attemptsMade: 0,
    });
    expect(result).toMatchObject({ proposals: [], version: 'rules-version' });
    expect(deps.db.calls).toContainEqual({ method: 'ruleBackfill.preview', args: [USER, [ROW]] });
  });

  it.each([
    ['maintenance', {}],
    ['dispatch', {}],
    ['occurrences', { userId: USER }],
    ['reminders', { userId: USER, occurrenceId: ROW }],
    ['budget-alerts', { userId: USER }],
    ['balance-checks', { userId: USER }],
    ['period-close', { userId: USER }],
    ['notify', { userId: USER, outboxId: ROW }],
    ['detect-recurring', { userId: USER }],
    ['rules-backfill', { userId: USER, requestId: ROW }],
    ['market-server', { source: 'crypto' }],
    ['market-byok', { userId: USER }],
    ['snapshots', { userId: USER }],
    ['gmail', { userId: USER }],
    [
      'report-export',
      {
        userId: USER,
        reportId: ROW,
        format: 'pdf',
        email: false,
        options: { sections: ['summary'], theme: 'light', paper: 'a4', maskAccountNumbers: false },
      },
    ],
  ] as const)('creates the %s processor with the shared deps', async (queue, data) => {
    const run = PROCESSORS[queue].create(fakeDeps());
    expect(await run({ id: 'x', data, attemptsMade: 0 })).toEqual(expect.any(Object));
  });
});
