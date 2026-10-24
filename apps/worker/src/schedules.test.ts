// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_JOB_OPTIONS } from '@wf/jobs/queues';
import { describe, expect, it } from 'vitest';
import { captureLog, fakeBroker, NEXT_RUN } from '../test/fakes.ts';
import { createLogger } from './logger.ts';
import { registerSchedules, SCHEDULES } from './schedules.ts';

describe('SCHEDULES', () => {
  it('runs maintenance daily at 03:30, FX at 17:00 with a 08:00 retry (WIB), and the dispatch every minute', () => {
    expect(SCHEDULES).toEqual([
      { id: 'maintenance-daily', queue: 'maintenance', pattern: '30 3 * * *', tz: 'Asia/Jakarta', data: {} },
      {
        id: 'account-deletion-daily',
        queue: 'account-deletion',
        pattern: '40 3 * * *',
        tz: 'Asia/Jakarta',
        data: {},
      },
      { id: 'fx-daily', queue: 'fx', pattern: '0 17 * * *', tz: 'Asia/Jakarta', data: {} },
      { id: 'fx-retry', queue: 'fx', pattern: '0 8 * * *', tz: 'Asia/Jakarta', data: {} },
      { id: 'dispatch-minute', queue: 'dispatch', pattern: '* * * * *', tz: 'Asia/Jakarta', data: {} },
      {
        id: 'market-crypto',
        queue: 'market-server',
        pattern: '*/5 * * * *',
        tz: 'Asia/Jakarta',
        data: { source: 'crypto' },
      },
      {
        id: 'market-gold',
        queue: 'market-server',
        pattern: '0 9,17 * * *',
        tz: 'Asia/Jakarta',
        data: { source: 'gold' },
      },
    ]);
  });
});

describe('registerSchedules', () => {
  it('upserts each scheduler on its queue with the default job options and logs its next run', async () => {
    const broker = fakeBroker();
    const queues = {
      maintenance: broker.createQueue('maintenance', () => undefined),
      'account-deletion': broker.createQueue('account-deletion', () => undefined),
      fx: broker.createQueue('fx', () => undefined),
      dispatch: broker.createQueue('dispatch', () => undefined),
      'market-server': broker.createQueue('market-server', () => undefined),
    };
    const log = captureLog();
    await registerSchedules((name) => queues[name as keyof typeof queues], createLogger('info', log));
    expect(broker.queues.get('dispatch')?.schedulers).toEqual(
      new Map([
        [
          'dispatch-minute',
          {
            repeat: { pattern: '* * * * *', tz: 'Asia/Jakarta' },
            template: { name: 'dispatch', data: {}, opts: DEFAULT_JOB_OPTIONS },
          },
        ],
      ]),
    );
    expect(broker.queues.get('maintenance')?.schedulers).toEqual(
      new Map([
        [
          'maintenance-daily',
          {
            repeat: { pattern: '30 3 * * *', tz: 'Asia/Jakarta' },
            template: { name: 'maintenance', data: {}, opts: DEFAULT_JOB_OPTIONS },
          },
        ],
      ]),
    );
    expect(broker.queues.get('account-deletion')?.schedulers).toEqual(
      new Map([
        [
          'account-deletion-daily',
          {
            repeat: { pattern: '40 3 * * *', tz: 'Asia/Jakarta' },
            template: { name: 'account-deletion', data: {}, opts: DEFAULT_JOB_OPTIONS },
          },
        ],
      ]),
    );
    expect(broker.queues.get('fx')?.schedulers).toEqual(
      new Map([
        [
          'fx-daily',
          {
            repeat: { pattern: '0 17 * * *', tz: 'Asia/Jakarta' },
            template: { name: 'fx', data: {}, opts: DEFAULT_JOB_OPTIONS },
          },
        ],
        [
          'fx-retry',
          {
            repeat: { pattern: '0 8 * * *', tz: 'Asia/Jakarta' },
            template: { name: 'fx', data: {}, opts: DEFAULT_JOB_OPTIONS },
          },
        ],
      ]),
    );
    expect(log.lines[0]).toEqual(
      expect.objectContaining({
        msg: 'job scheduler registered',
        scheduler: 'maintenance-daily',
        queue: 'maintenance',
        pattern: '30 3 * * *',
        tz: 'Asia/Jakarta',
        nextRunAt: '2026-10-18T19:30:00.000Z',
      }),
    );
    expect(log.lines.map((line) => line['scheduler'])).toEqual([
      'maintenance-daily',
      'account-deletion-daily',
      'fx-daily',
      'fx-retry',
      'dispatch-minute',
      'market-crypto',
      'market-gold',
    ]);
    expect([...(broker.queues.get('market-server')?.schedulers.keys() ?? [])]).toEqual([
      'market-crypto',
      'market-gold',
    ]);
  });

  it('falls back to the delay when the next job carries no slot time', async () => {
    const queue = fakeBroker({ ...NEXT_RUN, opts: {} }).createQueue('maintenance', () => undefined);
    const log = captureLog();
    await registerSchedules(() => queue, createLogger('info', log));
    expect(log.lines[0]).toMatchObject({ nextRunAt: '2026-10-18T19:30:00.012Z' });
  });
});
