// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate } from '@wf/domain/period';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_JOB_OPTIONS, JOBS, jobIds, QUEUE_PREFIX, type JobQueue, type QueueName } from './queues.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const OTHER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7e';
const DAY = parseLocalDate('2026-10-18');

describe('JOBS', () => {
  it('lists only the queues that have a processor', () => {
    expect(Object.keys(JOBS)).toEqual([
      'maintenance',
      'fx',
      'dispatch',
      'occurrences',
      'reminders',
      'budget-alerts',
      'balance-checks',
      'period-close',
      'notify',
      'detect-recurring',
    ]);
    expectTypeOf<JobQueue>().toExtend<QueueName>();
    expectTypeOf<'market-server'>().not.toExtend<JobQueue>();
  });

  it.each(['maintenance', 'fx', 'dispatch'] as const)('accepts an empty %s payload and rejects any key', (queue) => {
    expect(JOBS[queue].parse({})).toEqual({});
    expect(JOBS[queue].safeParse({ userId: USER }).success).toBe(false);
  });

  it.each(['occurrences', 'budget-alerts', 'balance-checks', 'period-close', 'detect-recurring'] as const)(
    'accepts { userId } for %s and nothing else',
    (queue) => {
      expect(JOBS[queue].parse({ userId: USER })).toEqual({ userId: USER });
      expect(JOBS[queue].safeParse({}).success).toBe(false);
      expect(JOBS[queue].safeParse({ userId: 'u1' }).success).toBe(false);
      expect(JOBS[queue].safeParse({ userId: USER, amountMinor: '1' }).success).toBe(false);
    },
  );

  it('carries ids only for reminders and notify', () => {
    expect(JOBS.reminders.parse({ userId: USER, occurrenceId: OTHER })).toEqual({ userId: USER, occurrenceId: OTHER });
    expect(JOBS.reminders.safeParse({ userId: USER }).success).toBe(false);
    expect(JOBS.notify.parse({ userId: USER, outboxId: OTHER })).toEqual({ userId: USER, outboxId: OTHER });
    expect(JOBS.notify.safeParse({ userId: USER, outboxId: OTHER, to: 'a@b.c' }).success).toBe(false);
  });
});

describe('jobIds', () => {
  it('builds the deterministic ids mt.{date} and fx.{date}, which BullMQ accepts as custom ids (no `:`)', () => {
    expect(jobIds.maintenance(DAY)).toBe('mt.2026-10-18');
    expect(jobIds.fx(DAY)).toBe('fx.2026-10-18');
    // @ts-expect-error a plain string is not a validated LocalDate
    jobIds.maintenance('2026-13-45');
  });

  it('builds the per-user daily (hourly for budget alerts) and per-row ids of plan §6', () => {
    expect(jobIds.dispatch(new Date('2026-10-18T20:30:59Z'))).toBe('dsp.2026-10-18T2030');
    expect(jobIds.occurrences(USER, DAY)).toBe(`occ.${USER}.2026-10-18`);
    expect(jobIds.reminders(OTHER)).toBe(`rem.${OTHER}`);
    expect(jobIds['budget-alerts'](USER, DAY, 9)).toBe(`bud.${USER}.2026-10-18.09`);
    expect(jobIds['budget-alerts'](USER, DAY, 23)).toBe(`bud.${USER}.2026-10-18.23`);
    expect(jobIds['balance-checks'](USER, DAY)).toBe(`bal.${USER}.2026-10-18`);
    expect(jobIds['period-close'](USER, DAY)).toBe(`close.${USER}.2026-10-18`);
    expect(jobIds.notify(OTHER)).toBe(`ntf.${OTHER}`);
    expect(jobIds['detect-recurring'](USER, DAY)).toBe(`det.${USER}.2026-10-18`);
    const all = [
      jobIds.dispatch(new Date()),
      jobIds.occurrences(USER, DAY),
      jobIds['budget-alerts'](USER, DAY, 9),
      jobIds.notify(OTHER),
    ];
    for (const id of all) expect(id).not.toContain(':');
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
