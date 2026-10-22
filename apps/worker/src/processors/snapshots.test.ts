// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createSnapshotsProcessor } from './snapshots.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const job = { id: 'snap', data: { userId: USER }, attemptsMade: 0 };

describe('snapshots processor', () => {
  it('records the user’s snapshot at the job’s clock and reports its date only', async () => {
    const now = new Date('2026-10-15T16:55:00Z');
    const db = fakeDb();
    db.portfolioSnapshots.record = (...args) => {
      db.calls.push({ method: 'portfolioSnapshots.record', args });
      return Promise.resolve({
        date: '2026-10-15' as LocalDate,
        valueBaseMinor: 61_420_000n,
        costBaseMinor: 53_931_000n,
        contributionsBaseMinor: 0n,
        breakdown: {},
      });
    };
    expect(await createSnapshotsProcessor(fakeDeps({ db }, now))(job)).toEqual({ snapshot: { date: '2026-10-15' } });
    expect(db.calls).toEqual([{ method: 'portfolioSnapshots.record', args: [USER, now] }]);
  });

  it('reports no snapshot for a user without investments and rejects a payload without a user', async () => {
    expect(await createSnapshotsProcessor(fakeDeps())(job)).toEqual({ snapshot: null });
    await expect(createSnapshotsProcessor(fakeDeps())({ ...job, data: {} })).rejects.toThrow();
  });
});
