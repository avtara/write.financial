// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate } from '@wf/domain/period';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_JOB_OPTIONS, JOBS, jobIds, QUEUE_PREFIX, type JobQueue, type QueueName } from './queues.ts';

describe('JOBS', () => {
  it('lists only the queues that have a processor', () => {
    expect(Object.keys(JOBS)).toEqual(['maintenance', 'fx']);
    expectTypeOf<JobQueue>().toEqualTypeOf<'maintenance' | 'fx'>();
    expectTypeOf<JobQueue>().toExtend<QueueName>();
    expectTypeOf<'market-server'>().not.toExtend<JobQueue>();
  });

  it.each(['maintenance', 'fx'] as const)('accepts an empty %s payload and rejects any key', (queue) => {
    expect(JOBS[queue].parse({})).toEqual({});
    expect(JOBS[queue].safeParse({ userId: 'x' }).success).toBe(false);
  });
});

describe('jobIds', () => {
  it('builds the deterministic ids mt.{date} and fx.{date}, which BullMQ accepts as custom ids (no `:`)', () => {
    expect(jobIds.maintenance(parseLocalDate('2026-10-18'))).toBe('mt.2026-10-18');
    expect(jobIds.fx(parseLocalDate('2026-10-18'))).toBe('fx.2026-10-18');
    // @ts-expect-error a plain string is not a validated LocalDate
    jobIds.maintenance('2026-13-45');
  });
});

describe('defaults', () => {
  it('retries five times with exponential backoff and bounds what Redis keeps', () => {
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 604_800, count: 1000 },
      removeOnFail: { age: 2_592_000 },
    });
    expect(QUEUE_PREFIX).toBe('wf');
  });
});
