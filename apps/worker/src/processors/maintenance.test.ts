// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../test/fakes.ts';
import { createMaintenanceProcessor } from './maintenance.ts';

const now = new Date('2026-10-18T20:30:00Z');
const job = (data: unknown) => ({ id: 'repeat:maintenance-daily:1', data, attemptsMade: 0 });

describe('maintenance processor', () => {
  it('purges expired auth rows as of the clock and returns the counts', async () => {
    const db = fakeDb({ verifications: 4, sessions: 7, invitations: 1 });
    const process = createMaintenanceProcessor({ db, now: () => now });
    expect(await process(job({}))).toEqual({ purged: { verifications: 4, sessions: 7, invitations: 1 } });
    expect(db.purgeCalls).toEqual([now]);
  });

  it('rejects a payload that is not the empty maintenance payload, before touching the database', async () => {
    const db = fakeDb();
    const process = createMaintenanceProcessor({ db, now: () => now });
    await expect(process(job({ userId: 'x' }))).rejects.toThrow(/Unrecognized key/);
    expect(db.purgeCalls).toEqual([]);
  });

  it('fails the job when the purge fails, so BullMQ retries it', async () => {
    const process = createMaintenanceProcessor({
      db: { maintenance: { purgeExpiredAuth: () => Promise.reject(new Error('connection refused')) } },
      now: () => now,
    });
    await expect(process(job({}))).rejects.toThrow('connection refused');
  });
});
