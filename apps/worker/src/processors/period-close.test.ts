// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createPeriodCloseProcessor } from './period-close.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const SEPT = { id: 'p-sep', label: '2026-09', start: '2026-09-01', end: '2026-09-30' };
const AUG = { id: 'p-aug', label: '2026-08', start: '2026-08-01', end: '2026-08-31' };

describe('period-close processor', () => {
  it('proposes, then locks, every ended open period, oldest first', async () => {
    const db = fakeDb();
    const deps = fakeDeps({
      db: {
        ...db,
        periodClose: {
          ...db.periodClose,
          endedPeriods: async (...args) => {
            db.calls.push({ method: 'periodClose.endedPeriods', args });
            return Promise.resolve([AUG, SEPT] as never);
          },
        },
      },
    });
    const run = createPeriodCloseProcessor(deps);
    expect(await run({ id: `close.${USER}.2026-10-01`, data: { userId: USER }, attemptsMade: 0 })).toEqual({
      periods: 2,
      proposals: 4,
    });
    const now = deps.now();
    expect(db.calls).toEqual([
      { method: 'periodClose.endedPeriods', args: [USER, now] },
      { method: 'periodClose.propose', args: [USER, 'p-aug', now] },
      { method: 'periods.lock', args: [USER, 'p-aug'] },
      { method: 'periodClose.propose', args: [USER, 'p-sep', now] },
      { method: 'periods.lock', args: [USER, 'p-sep'] },
    ]);
  });

  it('does nothing without an ended period and rejects an invalid payload', async () => {
    const deps = fakeDeps();
    const run = createPeriodCloseProcessor(deps);
    expect(await run({ id: 'x', data: { userId: USER }, attemptsMade: 0 })).toEqual({ periods: 0, proposals: 0 });
    await expect(run({ id: 'x', data: {}, attemptsMade: 0 })).rejects.toThrow();
  });
});
