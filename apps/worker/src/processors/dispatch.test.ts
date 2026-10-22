// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { BUDGET_ALERTS_FROM, DAILY_AT, DISPATCH_LIMIT, createDispatchProcessor, localClock } from './dispatch.ts';

const JAKARTA = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c71';
const LONDON = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c72';
const OCCURRENCE = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c73';
const OUTBOX = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c74';
const job = { id: 'repeat:dispatch-minute:1', data: {}, attemptsMade: 0 };

function deps(now: Date) {
  const db = fakeDb();
  return fakeDeps(
    {
      db: {
        ...db,
        dispatch: {
          users: () =>
            Promise.resolve([
              { userId: JAKARTA, timeZone: 'Asia/Jakarta' },
              { userId: LONDON, timeZone: 'Europe/London' },
            ]),
          dueReminders: async (...args) => {
            db.calls.push({ method: 'dispatch.dueReminders', args });
            return Promise.resolve([{ userId: JAKARTA, occurrenceId: OCCURRENCE }]);
          },
          pendingOutbox: async (...args) => {
            db.calls.push({ method: 'dispatch.pendingOutbox', args });
            return Promise.resolve([{ userId: JAKARTA, outboxId: OUTBOX }]);
          },
        },
        marketJobs: {
          ...db.marketJobs,
          byokUsers: () => Promise.resolve([{ userId: LONDON, timeZone: 'Europe/London' }]),
        },
      },
    },
    now,
  );
}

describe('localClock', () => {
  it('is the date, time, and hour in the time zone', () => {
    const at = new Date('2026-10-18T17:05:00Z');
    expect(localClock(at, 'Asia/Jakarta')).toEqual({ date: '2026-10-19', time: '00:05', hour: 0 });
    expect(localClock(at, 'Europe/London')).toEqual({ date: '2026-10-18', time: '18:05', hour: 18 });
  });
});

describe('dispatch processor', () => {
  it('runs the daily jobs from their local times and budget alerts hourly from 09.00', () => {
    expect(DAILY_AT).toEqual({
      occurrences: '00:05',
      'period-close': '00:05',
      'detect-recurring': '03:00',
      'balance-checks': '07:00',
      snapshots: '23:55',
    });
    expect(BUDGET_ALERTS_FROM).toBe('09:00');
  });

  it("enqueues each user's due jobs keyed by their local date, then reminders and emails", async () => {
    // 09.30 WIB on 18 Oct, 03.30 BST in London.
    const d = deps(new Date('2026-10-18T02:30:00Z'));
    const result = await createDispatchProcessor(d)(job);
    expect(d.enqueued).toEqual([
      { queue: 'occurrences', payload: { userId: JAKARTA }, jobId: `occ.${JAKARTA}.2026-10-18` },
      { queue: 'period-close', payload: { userId: JAKARTA }, jobId: `close.${JAKARTA}.2026-10-18` },
      { queue: 'detect-recurring', payload: { userId: JAKARTA }, jobId: `det.${JAKARTA}.2026-10-18` },
      { queue: 'balance-checks', payload: { userId: JAKARTA }, jobId: `bal.${JAKARTA}.2026-10-18` },
      { queue: 'budget-alerts', payload: { userId: JAKARTA }, jobId: `bud.${JAKARTA}.2026-10-18.09` },
      { queue: 'occurrences', payload: { userId: LONDON }, jobId: `occ.${LONDON}.2026-10-18` },
      { queue: 'period-close', payload: { userId: LONDON }, jobId: `close.${LONDON}.2026-10-18` },
      { queue: 'detect-recurring', payload: { userId: LONDON }, jobId: `det.${LONDON}.2026-10-18` },
      {
        queue: 'reminders',
        payload: { userId: JAKARTA, occurrenceId: OCCURRENCE },
        jobId: `rem.${OCCURRENCE}`,
      },
      { queue: 'notify', payload: { userId: JAKARTA, outboxId: OUTBOX }, jobId: `ntf.${OUTBOX}` },
      // Own-key prices of users with a key, one per 5-minute slot.
      { queue: 'market-byok', payload: { userId: LONDON }, jobId: `mkb.${LONDON}.2026-10-18T0230` },
    ]);
    expect(result).toEqual({
      users: 2,
      enqueued: {
        occurrences: 2,
        'period-close': 2,
        'detect-recurring': 2,
        'balance-checks': 1,
        'budget-alerts': 1,
        reminders: 1,
        notify: 1,
        'market-byok': 1,
      },
    });
    expect(d.db.calls).toEqual([
      { method: 'dispatch.dueReminders', args: [d.now(), DISPATCH_LIMIT] },
      { method: 'dispatch.pendingOutbox', args: [d.now(), DISPATCH_LIMIT] },
    ]);
  });

  it('enqueues nothing daily before 00.05 local', async () => {
    // 00.04 WIB: Jakarta waits; London (18.04 the day before) gets the jobs of its own date.
    const d = deps(new Date('2026-10-18T17:04:00Z'));
    await createDispatchProcessor(d)(job);
    expect(d.enqueued.filter(({ payload }) => 'userId' in payload && payload.userId === JAKARTA)).toEqual([
      { queue: 'reminders', payload: { userId: JAKARTA, occurrenceId: OCCURRENCE }, jobId: `rem.${OCCURRENCE}` },
      { queue: 'notify', payload: { userId: JAKARTA, outboxId: OUTBOX }, jobId: `ntf.${OUTBOX}` },
    ]);
    expect(d.enqueued.map(({ jobId }) => jobId)).toContain(`bud.${LONDON}.2026-10-18.18`);
  });

  it('takes the day’s portfolio snapshot from 23.55 local', async () => {
    // 23.55 WIB on 18 Oct.
    const d = deps(new Date('2026-10-18T16:55:00Z'));
    await createDispatchProcessor(d)(job);
    expect(d.enqueued).toContainEqual({
      queue: 'snapshots',
      payload: { userId: JAKARTA },
      jobId: `snap.${JAKARTA}.2026-10-18`,
    });
    expect(d.enqueued.map(({ jobId }) => jobId)).not.toContain(`snap.${LONDON}.2026-10-18`);
  });

  it('rejects a non-empty payload and needs no user to succeed', async () => {
    const d = fakeDeps();
    await expect(createDispatchProcessor(d)({ ...job, data: { userId: JAKARTA } })).rejects.toThrow();
    expect(await createDispatchProcessor(d)(job)).toEqual({ users: 0, enqueued: {} });
  });
});
