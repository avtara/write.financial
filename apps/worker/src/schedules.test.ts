// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_JOB_OPTIONS } from '@wf/jobs/queues';
import { describe, expect, it } from 'vitest';
import { captureLog, fakeBroker, NEXT_RUN } from '../test/fakes.ts';
import { createLogger } from './logger.ts';
import { registerSchedules, SCHEDULES } from './schedules.ts';

describe('SCHEDULES', () => {
  it('runs maintenance daily at 03:30 and FX at 17:00 with a 08:00 retry, Jakarta time (WIB)', () => {
    expect(SCHEDULES).toEqual([
      { id: 'maintenance-daily', queue: 'maintenance', pattern: '30 3 * * *', tz: 'Asia/Jakarta', data: {} },
      { id: 'fx-daily', queue: 'fx', pattern: '0 17 * * *', tz: 'Asia/Jakarta', data: {} },
      { id: 'fx-retry', queue: 'fx', pattern: '0 8 * * *', tz: 'Asia/Jakarta', data: {} },
    ]);
  });
});

describe('registerSchedules', () => {
  it('upserts each scheduler on its queue with the default job options and logs its next run', async () => {
    const broker = fakeBroker();
    const queues = {
      maintenance: broker.createQueue('maintenance', () => undefined),
      fx: broker.createQueue('fx', () => undefined),
    };
    const log = captureLog();
    await registerSchedules((name) => queues[name], createLogger('info', log));
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
    expect(log.lines.map((line) => line['scheduler'])).toEqual(['maintenance-daily', 'fx-daily', 'fx-retry']);
  });

  it('falls back to the delay when the next job carries no slot time', async () => {
    const queue = fakeBroker({ ...NEXT_RUN, opts: {} }).createQueue('maintenance', () => undefined);
    const log = captureLog();
    await registerSchedules(() => queue, createLogger('info', log));
    expect(log.lines[0]).toMatchObject({ nextRunAt: '2026-10-18T19:30:00.012Z' });
  });
});
