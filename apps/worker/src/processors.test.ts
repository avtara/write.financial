// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS, type JobQueue } from '@wf/jobs/queues';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { fakeDb } from '../test/fakes.ts';
import { PROCESSORS } from './processors.ts';

describe('PROCESSORS', () => {
  it('has one processor per enqueueable queue', () => {
    expect(Object.keys(PROCESSORS)).toEqual(Object.keys(JOBS));
    expectTypeOf<keyof typeof PROCESSORS>().toEqualTypeOf<JobQueue>();
  });

  it('runs maintenance one job at a time', async () => {
    expect(PROCESSORS.maintenance.concurrency).toBe(1);
    const run = PROCESSORS.maintenance.create({ db: fakeDb(), now: () => new Date() });
    expect(await run({ id: 'x', data: {}, attemptsMade: 0 })).toHaveProperty('purged');
  });

  it('runs fx one job at a time over the built-in sources', async () => {
    expect(PROCESSORS.fx.concurrency).toBe(1);
    const run = PROCESSORS.fx.create({ db: fakeDb(), now: () => new Date() });
    // The payload is validated before any request, so this never reaches the network.
    await expect(run({ id: 'x', data: { userId: 'u1' }, attemptsMade: 0 })).rejects.toThrow();
  });
});
