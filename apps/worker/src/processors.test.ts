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

  it('runs the instance-wide jobs one at a time and per-user jobs a few at a time', () => {
    expect(
      Object.fromEntries(Object.entries(PROCESSORS).map(([queue, { concurrency }]) => [queue, concurrency])),
    ).toEqual({
      maintenance: 1,
      fx: 1,
      dispatch: 1,
      occurrences: 2,
      reminders: 4,
      'budget-alerts': 2,
      'balance-checks': 2,
      'period-close': 2,
      reports: 2,
      notify: 2,
      'detect-recurring': 1,
      'market-server': 1,
      'market-byok': 2,
      snapshots: 2,
    });
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
    ['market-server', { source: 'crypto' }],
    ['market-byok', { userId: USER }],
    ['snapshots', { userId: USER }],
  ] as const)('creates the %s processor with the shared deps', async (queue, data) => {
    const run = PROCESSORS[queue].create(fakeDeps());
    expect(await run({ id: 'x', data, attemptsMade: 0 })).toEqual(expect.any(Object));
  });
});
