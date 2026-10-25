// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createMaintenanceProcessor } from './maintenance.ts';

const now = new Date('2026-10-18T20:30:00Z');
const job = (data: unknown) => ({ id: 'repeat:maintenance-daily:1', data, attemptsMade: 0 });

describe('maintenance processor', () => {
  it('rejects a payload that is not the empty maintenance payload, before touching the database', async () => {
    const db = fakeDb();
    const process = createMaintenanceProcessor(fakeDeps({ db }, now));
    await expect(process(job({ userId: 'x' }))).rejects.toThrow(/Unrecognized key/);
    expect(db.purgeCalls).toEqual([]);
  });

  it('fails the job when a purge fails, so BullMQ retries it', async () => {
    const db = fakeDb();
    const process = createMaintenanceProcessor(
      fakeDeps(
        {
          db: {
            ...db,
            maintenance: { ...db.maintenance, purgeExpiredAuth: () => Promise.reject(new Error('connection refused')) },
          },
        },
        now,
      ),
    );
    await expect(process(job({}))).rejects.toThrow('connection refused');
  });
});
